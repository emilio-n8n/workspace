import { type Database, getDb } from "./client.ts";

/**
 * Exécute une opération dans une transaction.
 * Le cast disparaîtra quand le schéma typé sera rattaché au client.
 */
export async function withTransaction<T>(fn: (tx: Database) => Promise<T>): Promise<T> {
  return getDb().transaction(async (tx) => fn(tx as unknown as Database));
}
