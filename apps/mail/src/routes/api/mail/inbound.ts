import { createFileRoute } from "@tanstack/react-router";
import {
  createInboundMessage,
  isMailError,
  MAX_ATTACHMENTS,
  MAX_INBOUND_ATTACHMENT_BYTES,
  MAX_INBOUND_BODY_LENGTH,
  type MailError,
} from "@workspace/mail";
import { createRateLimiter } from "@workspace/ratelimit";

type InboundBody = {
  to?: string;
  from?: string;
  fromName?: string;
  subject?: string;
  body?: string;
  /** Identifiant du message chez le relais MX (idempotence). */
  messageId?: string;
  /** Pièces jointes en base64 (≤ 5, ≤ 5 Mo décodés chacune). */
  attachments?: { filename?: string; contentType?: string; contentBase64?: string }[];
};

/**
 * Marge au-dessus des limites du service pour les autres champs JSON (`to`,
 * `from`, objet, échappement) et l'encodage base64 des pièces jointes
 * (4 caractères pour 3 octets). Les limites réelles sont appliquées par
 * @workspace/mail, qui renvoie une MailError « validation ».
 */
const MAX_REQUEST_LENGTH =
  MAX_INBOUND_BODY_LENGTH +
  MAX_ATTACHMENTS * Math.ceil(MAX_INBOUND_ATTACHMENT_BYTES / 3) * 4 +
  64 * 1024;

/**
 * Garde-fou anti-abus (audit) : 30 ingestions par minute et par IP, vérifié
 * avant toute lecture du corps. Compteur en mémoire : mono-instance
 * (voir @workspace/ratelimit).
 */
const inboundLimiter = createRateLimiter({ windowMs: 60_000, max: 30 });

function statusForError(error: MailError): number {
  switch (error.code) {
    case "forbidden":
      return 403;
    case "not_found":
      return 404;
    case "conflict":
      return 409;
    default:
      return 400; // validation
  }
}

/** Ingestion du courrier entrant (MX → POST) : secret partagé, pas de session. */
export const Route = createFileRoute("/api/mail/inbound")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // L'IP vient du proxy (en-têtes normalisés) ; accès direct en dev : « local ».
        const ip =
          request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
          request.headers.get("x-real-ip") ??
          "local";
        const limit = inboundLimiter.check(`inbound:${ip}`);
        if (!limit.allowed) {
          return new Response("Trop de requêtes — réessayez dans un instant.", {
            status: 429,
            headers: { "retry-after": String(limit.retryAfterSeconds) },
          });
        }

        const raw = await request.text();
        if (raw.length > MAX_REQUEST_LENGTH) {
          return new Response("Corps trop volumineux (1 Mo maximum).", { status: 400 });
        }

        let payload: InboundBody;
        try {
          payload = JSON.parse(raw) as InboundBody;
        } catch {
          return new Response("JSON invalide", { status: 400 });
        }
        if (!payload.to || !payload.from) {
          return new Response("Champs requis : to, from", { status: 400 });
        }

        try {
          const created = await createInboundMessage(
            {
              to: payload.to,
              from: payload.from,
              fromName: payload.fromName,
              subject: payload.subject,
              body: payload.body,
              externalId: payload.messageId,
              attachments: payload.attachments,
            },
            request.headers.get("x-mail-secret"),
          );
          return Response.json({ ok: true, id: created.id });
        } catch (error) {
          if (isMailError(error)) {
            return new Response(error.message, { status: statusForError(error) });
          }
          return new Response("Ingestion refusée", { status: 500 });
        }
      },
    },
  },
});
