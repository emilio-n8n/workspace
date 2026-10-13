#!/usr/bin/env node
/**
 * Backfill des registres de migrations par package.
 *
 * Depuis l'ajout de `migrations: { table: … }` par module, drizzle utilise un
 * registre par package. Les bases existantes ont leurs historiques dans
 * l'ancien registre partagé `drizzle.__drizzle_migrations` : ce script copie
 * les lignes correspondant aux fichiers SQL de chaque package vers son
 * registre dédié, pour qu'une migration suivante soit un no-op au lieu de
 * rejouer tout l'historique.
 *
 * Idempotent. À lancer une fois sur chaque base existante (dev, test).
 */
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

const PACKAGES = [
  ["packages/database", "database"],
  ["modules/drive", "drive"],
  ["modules/docs", "docs"],
  ["modules/tasks", "tasks"],
  ["modules/calendar", "calendar"],
  ["modules/forms", "forms"],
  ["modules/sheets", "sheets"],
  ["modules/slides", "slides"],
  ["modules/mail", "mail"],
  ["modules/chat", "chat"],
  ["modules/meet", "meet"],
  ["modules/sites", "sites"],
  ["modules/classroom", "classroom"],
];

const dsns = process.argv.slice(2);
const url = dsns[0] ?? process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL requis (ou passer l'URL en argument).");
  process.exit(1);
}

const psql = (sql) =>
  execSync(`psql ${JSON.stringify(url)} -v ON_ERROR_STOP=1 -tAc ${JSON.stringify(sql)}`)
    .toString()
    .trim();

psql(`CREATE SCHEMA IF NOT EXISTS drizzle`);

let total = 0;
for (const [dir, short] of PACKAGES) {
  const journalPath = `${dir}/drizzle/meta/_journal.json`;
  if (!existsSync(journalPath)) continue;
  const journal = JSON.parse(readFileSync(journalPath, "utf8"));
  const table = `drizzle.__drizzle_migrations_${short}`;
  psql(
    `CREATE TABLE IF NOT EXISTS ${table} (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint)`,
  );
  let inserted = 0;
  for (const entry of journal.entries) {
    const sqlPath = `${dir}/drizzle/${entry.tag}.sql`;
    if (!existsSync(sqlPath)) continue;
    const hash = createHash("sha256").update(readFileSync(sqlPath)).digest("hex");
    const exists = psql(`SELECT 1 FROM ${table} WHERE hash = '${hash}' LIMIT 1`);
    if (exists) continue;
    // La ligne d'origine (si elle existe dans le registre partagé) porte le when
    // exact du journal ; sinon on insère le when du journal.
    psql(`INSERT INTO ${table} (hash, created_at) VALUES ('${hash}', ${entry.when})`);
    inserted += 1;
  }
  total += inserted;
  console.log(`${short}: ${journal.entries.length} migration(s), ${inserted} backfillée(s)`);
}
console.log(`Backfill terminé (${total} ligne(s)).`);
