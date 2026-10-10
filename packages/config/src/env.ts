import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { z } from "zod";

/**
 * Schéma de configuration de l'instance.
 *
 * Les valeurs sont fournies par variables d'environnement. La validation est
 * paresseuse (au premier accès), afin que le build ne dépende pas de la
 * présence des secrets, mais que tout accès serveur échoue vite et clairement
 * si la configuration est incomplète.
 */
const serverEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  /** URL publique de l'instance (liens d'invitation, partage). */
  PUBLIC_URL: z.string().url().default("http://localhost:3000"),

  /** Connexion PostgreSQL du développement/exécution. */
  DATABASE_URL: z.string().url(),
  /** Connexion PostgreSQL des tests d'intégration. */
  TEST_DATABASE_URL: z.string().url().optional(),

  /** Secret de signature des sessions (≥ 32 caractères). Requis en production. */
  SESSION_SECRET: z.string().min(32).optional(),

  /** Stockage des binaires : répertoire local ou S3-compatible. */
  STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
  STORAGE_DIR: z.string().default("./data/storage"),
  S3_ENDPOINT: z.string().url().optional(),
  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().optional(),
  S3_ACCESS_KEY: z.string().optional(),
  S3_SECRET_KEY: z.string().optional(),

  /** Longueur maximale d'upload acceptée (octets). */
  MAX_UPLOAD_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(100 * 1024 * 1024),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

let cached: ServerEnv | null = null;

function formatIssues(issues: ReadonlyArray<{ path: PropertyKey[]; message: string }>): string {
  return issues
    .map((issue) => ` - ${issue.path.join(".") || "(racine)"} : ${issue.message}`)
    .join("\n");
}

/**
 * Charge le premier fichier `.env` trouvé en remontant depuis `fromDir`
 * (la racine du dépôt en pratique), sans écraser les variables déjà
 * définies dans l'environnement du processus.
 */
export function loadDotEnv(fromDir: string = process.cwd()): string | null {
  let dir = resolve(fromDir);
  for (;;) {
    const candidate = join(dir, ".env");
    if (existsSync(candidate)) {
      applyDotEnv(readFileSync(candidate, "utf8"));
      return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function applyDotEnv(raw: string): void {
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

/**
 * Retourne la configuration validée (mise en cache après le premier succès).
 * Jette une erreur explicite si une variable requise manque ou est invalide.
 */
export function getServerEnv(source: NodeJS.ProcessEnv = process.env): ServerEnv {
  if (cached) return cached;

  const parsed = serverEnvSchema.safeParse(source);
  if (!parsed.success) {
    throw new Error(
      `Configuration d'instance invalide — variables d'environnement manquantes ou incorrectes :\n${formatIssues(parsed.error.issues)}\n` +
        "Vérifiez votre fichier .env à la racine du dépôt (voir .env.example).",
    );
  }

  const env = parsed.data;

  if (env.NODE_ENV === "production" && !env.SESSION_SECRET) {
    throw new Error(
      "Configuration invalide : SESSION_SECRET est requis en production (32 caractères minimum).",
    );
  }

  if (env.STORAGE_DRIVER === "s3") {
    const missing = (
      ["S3_ENDPOINT", "S3_BUCKET", "S3_ACCESS_KEY", "S3_SECRET_KEY"] as const
    ).filter((key) => !env[key]);
    if (missing.length > 0) {
      throw new Error(`Configuration invalide : STORAGE_DRIVER=s3 exige ${missing.join(", ")}.`);
    }
  }

  cached = env;
  return env;
}

/** Réservé aux tests : force une nouvelle validation au prochain accès. */
export function resetServerEnvCache(): void {
  cached = null;
}

export function isProduction(): boolean {
  return getServerEnv().NODE_ENV === "production";
}
