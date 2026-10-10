import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadDotEnv, resetServerEnvCache } from "@workspace/config";

loadDotEnv(new URL("../../..", import.meta.url).pathname);

// Base de test + stockage temporaire, jamais les données réelles.
if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}
process.env.STORAGE_DRIVER = "local";
process.env.STORAGE_DIR = mkdtempSync(path.join(tmpdir(), "workspace-drive-"));
process.env.MAX_UPLOAD_BYTES = "1000";

resetServerEnvCache();
