import { createFileRoute } from "@tanstack/react-router";
import { requireActor } from "@workspace/auth";
import { exportDocument } from "@workspace/docs";

/** Export d'un document (Markdown ou HTML) — session requise, droits vérifiés. */
export const Route = createFileRoute("/api/docs/export/$fileId")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        try {
          const { actor } = await requireActor(request.headers);
          const url = new URL(request.url);
          const format = url.searchParams.get("format") === "html" ? "html" : "md";
          const result = await exportDocument(actor, params.fileId, format);

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
