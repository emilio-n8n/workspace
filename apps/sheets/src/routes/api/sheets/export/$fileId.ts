import { createFileRoute } from "@tanstack/react-router";
import { requireActor } from "@workspace/auth";

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
          // Import dynamique : le barrel serveur (schéma/service → database)
          // ne doit JAMAIS entrer dans le bundle client — en dev, Vite
          // externalise node:fs et la page entière plante à l'accès.
          const { exportSpreadsheetCsv } = await import("@workspace/sheets");
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
