#!/usr/bin/env node
/**
 * Migrations séquentielles de toutes les bases du monorepo.
 *
 * Chaque module a son propre registre drizzle
 * (`drizzle.__drizzle_migrations_<module>`) : drizzle n'applique que les
 * migrations plus récentes que la dernière inscrite dans le registre, si bien
 * qu'un registre partagé faisait sauter les migrations d'un module plus
 * anciennes que celles d'un autre. Le cœur a `drizzle.__drizzle_migrations_database`.
 *
 * Bases existantes : avant de migrer un package, les entrées
 * déjà inscrites dans l'ancien registre partagé (même hash SQL) sont recopiées
 * dans son registre, pour ne pas rejouer ce qui est déjà appliqué.
 * L'ordre reste fixe : cœur, puis `drive` avant les modules qui le référencent.
 */
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const require = createRequire(join(root, "packages/database/package.json"));
const pg = require("pg");

const PACKAGES = [
  ["database", "packages/database"],
  ["drive", "modules/drive"],
  ["docs", "modules/docs"],
  ["tasks", "modules/tasks"],
  ["calendar", "modules/calendar"],
  ["forms", "modules/forms"],
  ["sheets", "modules/sheets"],
  ["slides", "modules/slides"],
  ["mail", "modules/mail"],
  ["chat", "modules/chat"],
  ["meet", "modules/meet"],
  ["sites", "modules/sites"],
  ["classroom", "modules/classroom"],
];

function migrate(pkg) {
  process.stdout.write(`\n▶ ${pkg}\n`);
  execSync(`pnpm --filter ${pkg} db:migrate`, { stdio: "inherit" });
}

async function backfillRegistry(client, module, path) {
  const dir = join(root, path, "drizzle");
  const hashes = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .map((f) =>
      createHash("sha256")
        .update(readFileSync(join(dir, f)).toString())
        .digest("hex"),
    );
  const table = `drizzle."__drizzle_migrations_${module}"`;
  await client.query("CREATE SCHEMA IF NOT EXISTS drizzle");
  await client.query(
    `CREATE TABLE IF NOT EXISTS ${table} (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint)`,
  );
  const shared = await client.query("SELECT to_regclass('drizzle.__drizzle_migrations') AS t");
  if (!shared.rows[0].t || hashes.length === 0) return;
  await client.query(
    `INSERT INTO ${table} (hash, created_at)
     SELECT s.hash, s.created_at FROM drizzle.__drizzle_migrations s
     WHERE s.hash = ANY($1) AND NOT EXISTS (SELECT 1 FROM ${table} m WHERE m.hash = s.hash)
     ORDER BY s.created_at`,
    [hashes],
  );
}

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL manquant.");
  process.exit(1);
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  for (const [module, path] of PACKAGES) {
    await backfillRegistry(client, module, path);
    migrate(`@workspace/${module}`);
  }
} finally {
  await client.end();
}

console.log("\nToutes les migrations sont appliquées (ordre déterministe).");
