import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadDotEnv, resetServerEnvCache } from "@workspace/config";

loadDotEnv(new URL("../../..", import.meta.url).pathname);

// Les tests d'intégration ne tournent JAMAIS sur autre chose que la base
// de test : sans TEST_DATABASE_URL explicite, on refuse d'exécuter.
if (!process.env.TEST_DATABASE_URL) {
  throw new Error(
    "TEST_DATABASE_URL est requis pour les tests d'intégration (la base de développement est protégée).",
  );
}
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;

// Stockage temporaire et limite d'upload réduite : les fichiers de test ne
// touchent jamais les données réelles, et le plafond se teste en quelques octets.
process.env.STORAGE_DRIVER = "local";
process.env.STORAGE_DIR = mkdtempSync(path.join(tmpdir(), "workspace-drive-"));
process.env.MAX_UPLOAD_BYTES = "1000";

resetServerEnvCache();
