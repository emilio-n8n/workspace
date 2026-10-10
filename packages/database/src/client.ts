import { getServerEnv } from "@workspace/config";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema/index.ts";

/**
 * Connexion PostgreSQL paresseuse : le pool n'est créé qu'au premier accès,
 * ce qui permet aux outils (CLI, drizzle-kit) et au build d'importer ce
 * package sans configuration complète.
 */
export type Database = NodePgDatabase<typeof schema>;

let pool: Pool | undefined;
let database: Database | undefined;

export function getPool(): Pool {
  if (!pool) {
    const env = getServerEnv();
    pool = new Pool({ connectionString: env.DATABASE_URL, max: 10 });
  }
  return pool;
}

export function getDb(): Database {
  if (!database) {
    database = drizzle(getPool(), { schema });
  }
  return database;
}

/** Ferme le pool (arrêt propre, tests). */
export async function closeDb(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = undefined;
    database = undefined;
  }
}
