import { defineConfig } from "drizzle-kit";

/**
 * Configuration drizzle-kit.
 * `DATABASE_URL` doit être présent dans l'environnement au moment de la commande
 * (voir la racine du dépôt : `set -a && source .env && set +a`).
 */
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/index.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
  strict: true,
  verbose: true,
});
