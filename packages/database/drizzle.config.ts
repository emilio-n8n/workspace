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
  // Registre de migrations PROPRE à ce package : le registre partagé
  // provoquait des sauts de migrations quand les horodatages de génération
  // s'entrecroisaient entre modules (prouvé en CI sur base vierge).
  migrations: { schema: "drizzle", table: "__drizzle_migrations_database" },
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
  strict: true,
  verbose: true,
});
