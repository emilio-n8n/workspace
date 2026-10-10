import path from "node:path";
import { fileURLToPath } from "node:url";
import { getServerEnv } from "@workspace/config";
import type { StorageAdapter } from "./adapter.ts";
import { LocalFsStorage } from "./local.ts";
import { S3Storage } from "./s3";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

let cached: StorageAdapter | undefined;

/**
 * Retourne l'adaptateur de stockage configuré (singleton paresseux).
 * - `local` : répertoire `STORAGE_DIR` (relatif à la racine du monorepo) ;
 * - `s3` : endpoint S3-compatible configuré par variables d'environnement.
 */
export function getStorage(): StorageAdapter {
  if (cached) return cached;

  const env = getServerEnv();

  if (env.STORAGE_DRIVER === "s3") {
    cached = new S3Storage({
      endpoint: env.S3_ENDPOINT ?? "",
      bucket: env.S3_BUCKET ?? "",
      region: env.S3_REGION ?? "us-east-1",
      accessKeyId: env.S3_ACCESS_KEY ?? "",
      secretAccessKey: env.S3_SECRET_KEY ?? "",
    });
  } else {
    cached = new LocalFsStorage(path.resolve(repoRoot, env.STORAGE_DIR));
  }

  return cached;
}

/** Réservé aux tests : réinitialise le singleton. */
export function resetStorage(): void {
  cached = undefined;
}
