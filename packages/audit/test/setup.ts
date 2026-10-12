import { loadDotEnv } from "@workspace/config";

// Charge le .env de la racine du dépôt, quels que soient le package et le cwd.
loadDotEnv(new URL("../../..", import.meta.url).pathname);

// Les tests d'intégration visent la base de test, jamais la base de dev.
if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}

// Les tests d'intégration ne tournent JAMAIS sur la base de développement.
if (!process.env.TEST_DATABASE_URL) {
  throw new Error(
    "TEST_DATABASE_URL est requis pour les tests d'intégration (la base de développement est protégée).",
  );
}
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
