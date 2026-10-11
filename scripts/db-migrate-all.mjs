#!/usr/bin/env node
/**
 * Migrations séquentielles de toutes les bases du monorepo.
 *
 * Pourquoi ce script : tous les modules partagent le même registre drizzle
 * (`drizzle.__drizzle_migrations`) dans une base donnée. Exécutées en
 * parallèle (turbo), deux migrations concurrentes du registre peuvent se
 * sauter mutuellement. L'ordre est donc fixe : schéma cœur, puis les
 * modules ; `drive` avant les modules qui référencent ses fichiers.
 */
import { execSync } from "node:child_process";

const ORDER = [
  "@workspace/database",
  "@workspace/drive",
  "@workspace/docs",
  "@workspace/tasks",
  "@workspace/calendar",
  "@workspace/forms",
  "@workspace/sheets",
  "@workspace/slides",
  "@workspace/mail",
  "@workspace/chat",
  "@workspace/meet",
  "@workspace/sites",
  "@workspace/classroom",
];

for (const pkg of ORDER) {
  process.stdout.write(`\n▶ ${pkg}\n`);
  execSync(`pnpm --filter ${pkg} db:migrate`, { stdio: "inherit" });
}

console.log("\nToutes les migrations sont appliquées (ordre déterministe).");
