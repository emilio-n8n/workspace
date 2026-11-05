import { createFileRoute } from "@tanstack/react-router";
import { listSyncTree } from "@workspace/drive";
import {
  authenticateSyncRequest,
  syncEntryJson,
  syncErrorResponse,
} from "../../../../server/sync-auth.ts";

/**
 * Instantané de l'arborescence Drive visible par le jeton.
 * Le client compare cet instantané à son état local pour calculer ses actions.
 */
export const Route = createFileRoute("/api/drive/sync/tree")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await authenticateSyncRequest(request, "drive:read");
        if (auth instanceof Response) return auth;

        try {
          const entries = await listSyncTree(auth.actor);
          return Response.json({ entries: entries.map(syncEntryJson) });
        } catch (error) {
          return syncErrorResponse(error);
        }
      },
    },
  },
});
