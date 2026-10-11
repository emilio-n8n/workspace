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

// Secret du webhook d'ingestion : sans secret configuré, aucun test d'ingestion
// avec un secret valide ne peut tourner.
process.env.MAIL_WEBHOOK_SECRET = process.env.MAIL_WEBHOOK_SECRET || "test-webhook-secret";

resetServerEnvCache();
