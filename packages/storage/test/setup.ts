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
