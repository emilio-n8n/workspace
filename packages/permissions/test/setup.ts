import { loadDotEnv } from "@workspace/config";

// Charge le .env de la racine du dépôt, quels que soient le package et le cwd.
loadDotEnv(new URL("../../..", import.meta.url).pathname);

// Les tests d'intégration visent la base de test, jamais la base de dev.
if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}
