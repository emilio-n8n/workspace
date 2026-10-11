import { createFileRoute } from "@tanstack/react-router";
import { accessShareLink } from "@workspace/drive";
import { getStorage } from "@workspace/storage";

/**
 * Téléchargement public via lien de partage (jeton de capacité, aucune session).
 * Toute révocation ou expiration prend effet immédiatement.
 */
export const Route = createFileRoute("/api/drive/shared/$token")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const access = await accessShareLink(params.token);
        if (!access || access.entry.kind !== "file" || !access.entry.storageKey) {
          return new Response("Introuvable", { status: 404 });
        }

        const body = await getStorage().get(access.entry.storageKey);
        if (!body) return new Response("Introuvable", { status: 404 });

        return new Response(new Uint8Array(body), {
          headers: {
            "content-type": access.entry.mimeType ?? "application/octet-stream",
            "content-length": String(body.length),
            "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(access.entry.name)}`,
            "cache-control": "private, no-store",
          },
        });
      },
    },
  },
});
