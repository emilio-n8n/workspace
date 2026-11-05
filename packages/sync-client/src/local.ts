import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { cp, mkdir, readdir, rename, rm, stat, utimes } from "node:fs/promises";
import { dirname, extname, join, sep } from "node:path";
import { trashDir } from "./config.ts";
import type { LocalEntry, SyncState } from "./types.ts";

/** Convertit un chemin natif en chemin POSIX relatif. */
export function toPosix(path: string): string {
  return path.split(sep).join("/");
}

/** Normalise un chemin relatif : pas de slash initial/final, séparateurs POSIX. */
export function normalizeRelative(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\/+/, "").replace(/\/+$/, "");
}

function escapeRegex(value: string): string {
  return value.replace(/[.+^${}()|[\]\\]/g, "\\$&");
}

/** Convertit un glob simple (`*`, `**`, `?`) en expression régulière. */
function globToRegExp(pattern: string): RegExp {
  let output = "";
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    if (char === "*") {
      if (pattern[index + 1] === "*") {
        output += ".*";
        index += 1;
      } else {
        output += "[^/]*";
      }
    } else if (char === "?") {
      output += "[^/]";
    } else {
      output += escapeRegex(char ?? "");
    }
  }
  return new RegExp(`^${output}$`);
}

/**
 * Vrai si le chemin relatif doit être ignoré.
 * - `.workspace-sync` est toujours ignoré (état, corbeille, verrou) ;
 * - un motif sans `/` matche n'importe quel segment (`node_modules`, `*.tmp`) ;
 * - un motif avec `/` matche le chemin complet et ses descendants.
 */
export function isIgnored(relativePath: string, patterns: readonly string[]): boolean {
  const path = normalizeRelative(relativePath);
  if (path.split("/").includes(".workspace-sync")) return true;

  for (const rawPattern of patterns) {
    const pattern = normalizeRelative(rawPattern.replace(/^\.\//, "").replace(/\/+$/, ""));
    if (!pattern) continue;
    const regex = globToRegExp(pattern);

    if (pattern.includes("/")) {
      if (regex.test(path) || path.startsWith(`${pattern}/`)) return true;
      continue;
    }

    if (path.split("/").some((segment) => regex.test(segment))) return true;
  }

  return false;
}

/** Parcourt un dossier local et retourne les entrées relatives (hors liens symboliques). */
export async function walkLocal(
  root: string,
  patterns: readonly string[] = [],
): Promise<Map<string, LocalEntry>> {
  const entries = new Map<string, LocalEntry>();

  async function visit(directory: string, relativeDirectory: string): Promise<void> {
    const dirents = await readdir(directory, { withFileTypes: true });
    for (const dirent of dirents) {
      const relativePath = relativeDirectory ? `${relativeDirectory}/${dirent.name}` : dirent.name;
      if (isIgnored(relativePath, patterns)) continue;
      if (dirent.isSymbolicLink()) continue;

      const absolutePath = join(directory, dirent.name);
      const info = await stat(absolutePath);

      if (dirent.isDirectory()) {
        entries.set(relativePath, {
          path: relativePath,
          kind: "folder",
          absolutePath,
          size: 0,
          mtimeMs: info.mtimeMs,
        });
        await visit(absolutePath, relativePath);
      } else if (dirent.isFile()) {
        entries.set(relativePath, {
          path: relativePath,
          kind: "file",
          absolutePath,
          size: info.size,
          mtimeMs: info.mtimeMs,
        });
      }
    }
  }

  await visit(root, "");
  return entries;
}

/** Empreinte SHA-256 d'un fichier, en flux (pas de fichier entier en mémoire). */
export function checksumFile(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

/**
 * Calcule les empreintes des fichiers locaux.
 * Optimisation : si mtime et taille n'ont pas bougé depuis le dernier état,
 * l'empreinte précédente est réutilisée (pas de relecture du fichier).
 */
export async function enrichChecksums(
  local: Map<string, LocalEntry>,
  state: SyncState,
): Promise<void> {
  for (const entry of local.values()) {
    if (entry.kind !== "file") continue;
    const previous = state.entries[entry.path];
    if (
      previous?.kind === "file" &&
      previous.localMtimeMs === entry.mtimeMs &&
      previous.localSize === entry.size &&
      previous.checksum
    ) {
      entry.checksum = previous.checksum;
    } else {
      entry.checksum = await checksumFile(entry.absolutePath);
    }
  }
}

export async function ensureLocalDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}

/** Applique la date distante au fichier local (best effort). */
export async function setLocalMtime(path: string, isoDate: string): Promise<void> {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return;
  try {
    await utimes(path, date, date);
  } catch {
    // La date n'est qu'un confort : une erreur ne doit pas faire échouer la synchro.
  }
}

/**
 * Déplace un élément local vers la corbeille du client (jamais de suppression
 * définitive) : `.workspace-sync/trash/<horodatage>/<chemin>`.
 */
export async function moveToTrash(
  root: string,
  relativePath: string,
  _reason: string,
): Promise<string> {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const source = join(root, relativePath);
  const destination = join(trashDir(root), stamp, relativePath);
  await mkdir(dirname(destination), { recursive: true });

  try {
    await rename(source, destination);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "EXDEV") throw error;
    await cp(source, destination, { recursive: true, force: true });
    await rm(source, { recursive: true, force: true });
  }

  return destination;
}

function sanitizeDevice(device: string): string {
  return device.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "device";
}

/** Nom d'une copie de conflit, à côté du fichier d'origine. */
export function conflictPath(relativePath: string, device: string, now: Date): string {
  const extension = extname(relativePath);
  const base = extension ? relativePath.slice(0, -extension.length) : relativePath;
  const stamp = now.toISOString().replace(/[-:]/g, "").slice(0, 15);
  return `${base}.conflict-${sanitizeDevice(device)}-${stamp}${extension}`;
}

const MIME_TYPES: Record<string, string> = {
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".json": "application/json",
  ".csv": "text/csv",
  ".html": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
  ".ts": "text/typescript",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".zip": "application/zip",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

export function mimeTypeFor(path: string): string {
  return MIME_TYPES[extname(path).toLowerCase()] ?? "application/octet-stream";
}
