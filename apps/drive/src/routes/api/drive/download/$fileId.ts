import { createFileRoute } from "@tanstack/react-router";
import { requireActor } from "@workspace/auth";
import { download } from "@workspace/drive";

/** Téléchargement authentifié d'un fichier (session requise, droits vérifiés). */
export const Route = createFileRoute("/api/drive/download/$fileId")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        try {
          const { actor } = await requireActor(request.headers);
          const { entry, body } = await download(actor, params.fileId);
          // `?inline=1` : affichage direct dans le navigateur (visionneuse intégrée)
          // au lieu du téléchargement, avec un cache privé court.
          const inline = new URL(request.url).searchParams.get("inline") === "1";
          const disposition = inline ? "inline" : "attachment";
          const filename = encodeURIComponent(entry.name);

          return new Response(new Uint8Array(body), {
            headers: {
              "content-type": entry.mimeType ?? "application/octet-stream",
              "content-length": String(body.length),
              "content-disposition": `${disposition}; filename*=UTF-8''${filename}`,
              "cache-control": inline ? "private, max-age=300" : "private, no-store",
            },
          });
        } catch {
          return new Response("Introuvable", { status: 404 });
        }
      },
    },
  },
});
