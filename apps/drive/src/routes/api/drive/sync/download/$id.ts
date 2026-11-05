import { createFileRoute } from "@tanstack/react-router";
import { download } from "@workspace/drive";
import { authenticateSyncRequest, syncErrorResponse } from "../../../../../server/sync-auth.ts";

/**
 * Téléchargement binaire pour le client de synchronisation.
 * Toujours en pièce jointe (jamais `inline`) : le contenu utilisateur ne doit
 * pas être rendu sur l'origine de l'application.
 */
export const Route = createFileRoute("/api/drive/sync/download/$id")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const auth = await authenticateSyncRequest(request, "drive:read");
        if (auth instanceof Response) return auth;

        try {
          const { entry, body } = await download(auth.actor, params.id);
          const filename = encodeURIComponent(entry.name);

          return new Response(new Uint8Array(body), {
            headers: {
              "content-type": entry.mimeType ?? "application/octet-stream",
              "content-length": String(body.length),
              "content-disposition": `attachment; filename*=UTF-8''${filename}`,
              "cache-control": "private, no-store",
              "x-content-type-options": "nosniff",
              ...(entry.checksum ? { "x-workspace-checksum": entry.checksum } : {}),
            },
          });
        } catch (error) {
          return syncErrorResponse(error);
        }
      },
    },
  },
});
