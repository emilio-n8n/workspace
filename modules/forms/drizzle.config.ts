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
  strict: true,
  verbose: true,
});
