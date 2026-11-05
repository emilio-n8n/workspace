import { createFileRoute } from "@tanstack/react-router";
import { authenticateSyncRequest } from "../../../../server/sync-auth.ts";

/**
 * Identité du jeton de synchronisation.
 * Permet au client de vérifier les scopes avant de lancer une passe.
 */
export const Route = createFileRoute("/api/drive/sync/me")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await authenticateSyncRequest(request, "drive:read");
        if (auth instanceof Response) return auth;

        return Response.json({
          userId: auth.principal.userId,
          organizationId: auth.principal.orgId,
          scopes: auth.principal.scopes,
        });
      },
    },
  },
});
