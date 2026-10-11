import { createFileRoute } from "@tanstack/react-router";
import { requireActor } from "@workspace/auth";
import { exportSpreadsheetCsv } from "@workspace/sheets";

/** Export CSV d'un onglet (valeurs calculées) — session requise. */
export const Route = createFileRoute("/api/sheets/export/$fileId")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        try {
          const { actor } = await requireActor(request.headers);
          const url = new URL(request.url);
          const tabId = url.searchParams.get("tab");
          if (!tabId) return new Response("Onglet requis", { status: 400 });
          const result = await exportSpreadsheetCsv(actor, params.fileId, tabId);
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
