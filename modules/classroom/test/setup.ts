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

// Pièces jointes : stockage temporaire — les blobs de test ne touchent jamais
// les données réelles de l'instance.
process.env.STORAGE_DRIVER = "local";
process.env.STORAGE_DIR = mkdtempSync(path.join(tmpdir(), "workspace-classroom-"));

resetServerEnvCache();
