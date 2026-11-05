import { createFileRoute } from "@tanstack/react-router";
import { requireActor } from "@workspace/auth";
import { download, isInlinePreviewSafe } from "@workspace/drive";

/** Téléchargement authentifié d'un fichier (session requise, droits vérifiés). */
export const Route = createFileRoute("/api/drive/download/$fileId")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        try {
          const { actor } = await requireActor(request.headers);
          const { entry, body } = await download(actor, params.fileId);
          // `?inline=1` : affichage direct dans le navigateur (visionneuse intégrée)
          // au lieu du téléchargement, avec un cache privé court. Le type MIME
          // venant du client, seuls les types sûrs sont rendus inline : HTML et
          // SVG restent des pièces jointes (pas de XSS stocké sur l'origine).
          const requestedInline = new URL(request.url).searchParams.get("inline") === "1";
          const inline = requestedInline && isInlinePreviewSafe(entry.mimeType);
          const disposition = inline ? "inline" : "attachment";
          const filename = encodeURIComponent(entry.name);

          return new Response(new Uint8Array(body), {
            headers: {
              "content-type": entry.mimeType ?? "application/octet-stream",
              "content-length": String(body.length),
              "content-disposition": `${disposition}; filename*=UTF-8''${filename}`,
              "cache-control": inline ? "private, max-age=300" : "private, no-store",
              "x-content-type-options": "nosniff",
            },
          });
        } catch {
          return new Response("Introuvable", { status: 404 });
        }
      },
    },
  },
});
