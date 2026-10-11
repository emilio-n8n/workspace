import { createFileRoute } from "@tanstack/react-router";
import { requireActor } from "@workspace/auth";
import { exportResponsesCsv } from "@workspace/forms";

/** Export CSV des réponses — session requise, droits vérifiés côté service. */
export const Route = createFileRoute("/api/forms/export/$fileId")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        try {
          const { actor } = await requireActor(request.headers);
          const result = await exportResponsesCsv(actor, params.fileId);
          return new Response(result.body, {
            headers: {
              "content-type": result.contentType,
              "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(result.name)}`,
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
