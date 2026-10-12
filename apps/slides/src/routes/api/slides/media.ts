import { createFileRoute } from "@tanstack/react-router";
import { requireActor } from "@workspace/auth";
import { getSlideImage } from "@workspace/slides";

/**
 * Lecture d'une image de diapositive :
 * `GET /api/slides/media?fileId=<uuid>&key=<clé encodée>`.
 * La clé contient des `/` : elle passe en paramètre de requête plutôt qu'en
 * segment de chemin. Le service borne la clé à la présentation demandée
 * (anti-IDOR) ; toute erreur devient un 404 volontairement muet.
 */
export const Route = createFileRoute("/api/slides/media")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const { actor } = await requireActor(request.headers);
          const search = new URL(request.url).searchParams;
          const fileId = search.get("fileId") ?? "";
          const key = search.get("key") ?? "";

          const { contentType, body } = await getSlideImage(actor, fileId, key);
          return new Response(new Uint8Array(body), {
            headers: {
              "content-type": contentType,
              "content-length": String(body.length),
              "cache-control": "private, max-age=3600",
            },
          });
        } catch {
          return new Response("Introuvable", { status: 404 });
        }
      },
    },
  },
});
