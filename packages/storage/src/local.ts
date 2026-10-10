import { randomUUID } from "node:crypto";
import { createReadStream, promises as fs } from "node:fs";
import path from "node:path";
import type { ObjectStat, PutInput, StorageAdapter } from "./adapter.ts";
import { assertValidKey, InvalidStorageKeyError } from "./keys.ts";

/**
 * Stockage sur système de fichiers local (défaut auto-hébergé).
 * - écriture atomique (fichier temporaire + renommage) ;
 * - clés sanitizées, impossibilité de sortir du répertoire racine.
 */
export class LocalFsStorage implements StorageAdapter {
  readonly driver = "local" as const;
  private readonly root: string;

  constructor(root: string) {
    this.root = path.resolve(root);
  }

  private resolve(key: string): string {
    assertValidKey(key);
    const absolute = path.resolve(this.root, key);
    if (absolute !== this.root && !absolute.startsWith(this.root + path.sep)) {
      throw new InvalidStorageKeyError(`Clé hors du répertoire de stockage : ${key}`);
    }
    return absolute;
  }

  async put({ key, body }: PutInput): Promise<void> {
    const target = this.resolve(key);
    await fs.mkdir(path.dirname(target), { recursive: true });

    // Écriture atomique : temporaire dans le même répertoire puis rename.
    const temporary = `${target}.tmp-${randomUUID()}`;
    await fs.writeFile(temporary, body);
    await fs.rename(temporary, target);
  }

  async get(key: string): Promise<Buffer | null> {
    const target = this.resolve(key);
    try {
      return await fs.readFile(target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async getStream(key: string): Promise<import("node:fs").ReadStream | null> {
    const target = this.resolve(key);
    try {
      await fs.access(target);
    } catch {
      return null;
    }
    return createReadStream(target);
  }

  async stat(key: string): Promise<ObjectStat | null> {
    const target = this.resolve(key);
    try {
      const stats = await fs.stat(target);
      if (!stats.isFile()) return null;
      return { key, size: stats.size };
    } catch {
      return null;
    }
  }

  async delete(key: string): Promise<void> {
    const target = this.resolve(key);
    try {
      await fs.unlink(target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}
