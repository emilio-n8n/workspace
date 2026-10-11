import { createFileRoute } from "@tanstack/react-router";
import {
  createInboundMessage,
  isMailError,
  MAX_INBOUND_BODY_LENGTH,
  type MailError,
} from "@workspace/mail";

type InboundBody = {
  to?: string;
  from?: string;
  fromName?: string;
  subject?: string;
  body?: string;
  /** Identifiant du message chez le relais MX (idempotence). */
  messageId?: string;
};

/**
 * Marge au-dessus de la limite du corps pour les autres champs JSON
 * (`to`, `from`, objet, échappement). La limite réelle du corps est appliquée
 * par @workspace/mail, qui renvoie une MailError « validation ».
 */
const MAX_REQUEST_LENGTH = MAX_INBOUND_BODY_LENGTH + 64 * 1024;

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
