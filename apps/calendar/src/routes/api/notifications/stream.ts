import { createFileRoute } from "@tanstack/react-router";
import { requireActor } from "@workspace/auth";
import { subscribeToNotifications } from "@workspace/notifications";

/**
 * Flux temps réel des notifications `GET /api/notifications/stream`.
 *
 * Server-Sent Events : session obligatoire (401 sinon), puis chaque évènement
 * du bus en mémoire du couple (organisation active, utilisateur) est diffusé
 * aussitôt sous `data: {"type":"notification"}` — le client recharge alors la
 * liste via la server fn habituelle. Un commentaire `: ping` part toutes les
 * ~25 s pour garder la connexion ouverte. À l'abandon de la requête
 * (`request.signal`), l'abonnement est retiré et le flux est fermé.
 */

/** Cadence du battement de cœur : ~25 s, sous les timeouts proxy usuels. */
const HEARTBEAT_MS = 25_000;

export const Route = createFileRoute("/api/notifications/stream")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        let actor: Awaited<ReturnType<typeof requireActor>>["actor"];
        try {
          ({ actor } = await requireActor(request.headers));
        } catch {
          return new Response("Authentification requise.", { status: 401 });
        }

        const encoder = new TextEncoder();
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            let closed = false;
            let unsubscribe: (() => void) | null = null;
            let heartbeat: ReturnType<typeof setInterval> | null = null;

            const cleanup = () => {
              if (closed) return;
              closed = true;
              if (heartbeat !== null) clearInterval(heartbeat);
              unsubscribe?.();
              request.signal.removeEventListener("abort", cleanup);
              try {
                controller.close();
              } catch {
                // Flux déjà fermé ou annulé côté client : rien à faire.
              }
            };

            const send = (chunk: string) => {
              if (closed) return;
              try {
                controller.enqueue(encoder.encode(chunk));
              } catch {
                cleanup();
              }
            };

            // Premier octet immédiat : les en-têtes partent et le client se
            // sait connecté sans attendre un premier évènement.
            send(": connected\n\n");

            unsubscribe = subscribeToNotifications(
              { orgId: actor.orgId, userId: actor.userId },
              () => send(`data: ${JSON.stringify({ type: "notification" })}\n\n`),
            );
            heartbeat = setInterval(() => send(": ping\n\n"), HEARTBEAT_MS);
            request.signal.addEventListener("abort", cleanup, { once: true });
          },
        });

        return new Response(stream, {
          headers: {
            "content-type": "text/event-stream",
            "cache-control": "no-store",
            connection: "keep-alive",
          },
        });
      },
    },
  },
});
