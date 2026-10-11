import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadDotEnv, resetServerEnvCache } from "@workspace/config";

loadDotEnv(new URL("../../..", import.meta.url).pathname);

// Les tests de stockage visent un répertoire temporaire, jamais les données réelles.
process.env.STORAGE_DRIVER = "local";
process.env.STORAGE_DIR =
  process.env.TEST_STORAGE_DIR ?? mkdtempSync(path.join(tmpdir(), "workspace-storage-"));
resetServerEnvCache();

// Les tests d'intégration ne tournent JAMAIS sur la base de développement.
if (!process.env.TEST_DATABASE_URL) {
  throw new Error(
    "TEST_DATABASE_URL est requis pour les tests d'intégration (la base de développement est protégée).",
  );
}
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
