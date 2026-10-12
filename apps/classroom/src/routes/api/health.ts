import { createFileRoute } from "@tanstack/react-router";
import { getDb } from "@workspace/database";
import { sql } from "drizzle-orm";

/** Version applicative exposée par la sonde (la CI pourra l'injecter au build). */
const VERSION = "0.1.0";

/** Nom de l'application, reporté aux moniteurs de disponibilité. */
const APP_NAME = "classroom";

/**
 * Sonde de santé `GET /api/health` pour les moniteurs de disponibilité
 * (robots d'uptime, répartiteurs de charge, vérifications de déploiement Vercel).
 *
 * Répond 200 tant que le processus est vivant et 503 uniquement lorsque le
 * ping SQL échoue. Aucun secret ni variable d'environnement n'est exposé et
 * la réponse n'est jamais mise en cache.
 */
export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: async () => {
        const startedAt = performance.now();

        let database: { status: "ok" | "error"; latencyMs: number };
        try {
          await getDb().execute(sql`select 1`);
          database = { status: "ok", latencyMs: Math.round(performance.now() - startedAt) };
        } catch {
          database = { status: "error", latencyMs: Math.round(performance.now() - startedAt) };
        }

        return Response.json(
          {
            status: database.status === "ok" ? "ok" : "degraded",
            app: APP_NAME,
            version: VERSION,
            uptimeSeconds: Math.round(process.uptime() * 10) / 10,
            checks: { database },
          },
          {
            status: database.status === "ok" ? 200 : 503,
            headers: { "cache-control": "no-store" },
          },
        );
      },
    },
  },
});
