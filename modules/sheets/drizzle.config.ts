import { defineConfig } from "drizzle-kit";

/**
 * Migrations propres au module Docs.
 * `DATABASE_URL` doit être présent dans l'environnement au moment de la commande.
 */
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
  // Registre propre au module : drizzle n'applique que les migrations plus
  // récentes que la dernière du registre, un registre partagé en sauterait.
  migrations: { table: "__drizzle_migrations_sheets", schema: "drizzle" },
  strict: true,
  verbose: true,
});
