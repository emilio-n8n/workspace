import { createFileRoute } from "@tanstack/react-router";
import { requireActor } from "@workspace/auth";
import {
  activeTypingSignals,
  ChatError,
  listMessages,
  type MessageView,
  type TypingSignal,
} from "@workspace/chat";

/**
 * Flux temps réel `GET /api/chat/stream?channelId=<uuid>&since=<iso>&sinceId=<uuid>`.
 *
 * Server-Sent Events : session obligatoire (401 sinon), puis un tick toutes les
 * 1,5 s qui diffuse les nouveaux messages du canal sous `event: messages`
 * (lots de 100 au plus, curseur `(created_at, id)` avancé à chaque lot) et les
 * indicateurs de frappe sous `event: typing` (instantané des membres en train
 * d'écrire, soi-même exclu). Un commentaire `: keep-alive` part après ~15 s sans
 * nouveauté. À l'abandon de la requête (`request.signal`), la boucle s'arrête et
 * le flux est fermé.
 */

const TICK_MS = 1500;
/** 10 ticks de 1,5 s ≈ 15 s sans nouveauté → commentaire keep-alive. */
const KEEP_ALIVE_TICKS = 10;
/** Taille maximale d'un lot : bornée pour ne jamais accumuler en mémoire. */
const BATCH_LIMIT = 100;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const encoder = new TextEncoder();

/** Instantané des personnes en train d'écrire, soi-même exclu. */
function typingSnapshot(channelId: string, viewerId: string): TypingSignal[] {
  return activeTypingSignals(channelId).filter((signal) => signal.userId !== viewerId);
}

/** Clé d'égalité de l'instantané : on ne rediffuse que ce qui change. */
function typingKey(signals: TypingSignal[]): string {
  return signals
    .map((signal) => `${signal.userId}:${signal.name}`)
    .sort()
    .join("|");
}

/** Sommeil annulable : se résout immédiatement si la requête est abandonnée. */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(finish, ms);
    function finish() {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    }
    signal.addEventListener("abort", finish, { once: true });
  });
}

export const Route = createFileRoute("/api/chat/stream")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const params = new URL(request.url).searchParams;
        const channelId = params.get("channelId") ?? "";
        const since = params.get("since") ?? undefined;
        const sinceId = params.get("sinceId") ?? undefined;

        if (!UUID_PATTERN.test(channelId)) {
          return new Response("Paramètre « channelId » invalide.", { status: 400 });
        }
        if (since !== undefined && Number.isNaN(new Date(since).getTime())) {
          return new Response("Paramètre « since » invalide.", { status: 400 });
        }
        if (sinceId !== undefined && !UUID_PATTERN.test(sinceId)) {
          return new Response("Paramètre « sinceId » invalide.", { status: 400 });
        }

        const auth = await requireActor(request.headers).catch(() => null);
        if (!auth) return new Response("Authentification requise.", { status: 401 });
        const { actor } = auth;

        const stream = new ReadableStream<Uint8Array>({
          async start(controller) {
            let cursor = since;
            let cursorId = sinceId;
            let idleTicks = 0;
            let lastTypingKey = "";
            try {
              while (!request.signal.aborted) {
                await sleep(TICK_MS, request.signal);
                if (request.signal.aborted) break;

                // Indicateurs de frappe : diffusés uniquement quand l'instantané
                // change, sinon le flux bruiterait à chaque tick.
                const typers = typingSnapshot(channelId, actor.userId);
                const currentTypingKey = typingKey(typers);
                if (currentTypingKey !== lastTypingKey) {
                  lastTypingKey = currentTypingKey;
                  controller.enqueue(
                    encoder.encode(`event: typing\ndata: ${JSON.stringify(typers)}\n\n`),
                  );
                }

                let rows: MessageView[];
                try {
                  rows = await listMessages(actor, channelId, {
                    since: cursor,
                    sinceId: cursorId,
                    limit: BATCH_LIMIT,
                  });
                } catch (error) {
                  if (request.signal.aborted) break;
                  const message =
                    error instanceof ChatError ? error.message : "Diffusion interrompue.";
                  controller.enqueue(
                    encoder.encode(`event: error\ndata: ${JSON.stringify({ message })}\n\n`),
                  );
                  break;
                }

                if (rows.length === 0) {
                  idleTicks += 1;
                  if (idleTicks >= KEEP_ALIVE_TICKS) {
                    if (request.signal.aborted) break;
                    controller.enqueue(encoder.encode(": keep-alive\n\n"));
                    idleTicks = 0;
                  }
                  continue;
                }

                if (request.signal.aborted) break;
                controller.enqueue(
                  encoder.encode(`event: messages\ndata: ${JSON.stringify(rows)}\n\n`),
                );
                const last = rows[rows.length - 1];
                if (last) {
                  cursor = last.createdAt;
                  cursorId = last.id;
                }
                idleTicks = 0;
              }
            } catch {
              // Enqueue impossible (flux annulé côté client) : on ferme proprement.
            } finally {
              try {
                controller.close();
              } catch {
                // Flux déjà fermé ou annulé : rien à faire.
              }
            }
          },
        });

        return new Response(stream, {
          headers: {
            "content-type": "text/event-stream",
            "cache-control": "no-cache, no-transform",
            connection: "keep-alive",
          },
        });
      },
    },
  },
});
