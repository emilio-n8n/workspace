import { createFileRoute } from "@tanstack/react-router";
import { download } from "@workspace/drive";
import { requireActor } from "../../../../server/actor";

/** Téléchargement authentifié d'un fichier (session requise, droits vérifiés). */
export const Route = createFileRoute("/api/drive/download/$fileId")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        try {
          const { actor } = await requireActor(request.headers);
          const { entry, body } = await download(actor, params.fileId);

          return new Response(new Uint8Array(body), {
            headers: {
              "content-type": entry.mimeType ?? "application/octet-stream",
              "content-length": String(body.length),
              "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(entry.name)}`,
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
