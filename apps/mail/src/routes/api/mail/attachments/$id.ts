import { createFileRoute } from "@tanstack/react-router";
import { requireActor } from "@workspace/auth";
import { getAttachment } from "@workspace/mail";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Nom ASCII de repli : ni saut de ligne ni guillemet dans l'en-tête HTTP. */
function asciiFilename(filename: string): string {
  const cleaned = filename.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_");
  return cleaned.length > 0 ? cleaned.slice(0, 200) : "piece-jointe";
}

/**
 * Téléchargement d'une pièce jointe (session requise). Le nom de fichier
 * vient de la base — jamais d'un en-tête client — et est assaini pour le
 * `content-disposition` ; les octets sont servis tels quels, sans cache.
 */
export const Route = createFileRoute("/api/mail/attachments/$id")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        if (!UUID_RE.test(params.id)) {
          return new Response("Introuvable", { status: 404 });
        }

        let actor: Awaited<ReturnType<typeof requireActor>>["actor"];
        try {
          ({ actor } = await requireActor(request.headers));
        } catch {
          return new Response("Authentification requise.", { status: 401 });
        }

        try {
          const attachment = await getAttachment(actor, params.id);
          return new Response(new Uint8Array(attachment.body), {
            headers: {
              "content-type": attachment.contentType,
              "content-length": String(attachment.body.length),
              "content-disposition": `attachment; filename="${asciiFilename(attachment.filename)}"; filename*=UTF-8''${encodeURIComponent(attachment.filename)}`,
              "cache-control": "private, no-store",
            },
          });
        } catch {
          return new Response("Introuvable", { status: 404 });
        }
      },
    },
  },
});
