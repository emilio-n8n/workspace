import { createFileRoute } from "@tanstack/react-router";
import { ensureFolder } from "@workspace/drive";
import { z } from "zod";
import {
  authenticateSyncRequest,
  syncEntryJson,
  syncErrorResponse,
} from "../../../../server/sync-auth.ts";

const bodySchema = z.object({
  parentId: z.string().uuid().nullable().optional(),
  name: z.string().min(1).max(255),
});

/**
 * Crée un dossier distant si nécessaire (idempotent).
 * Utilisé pour les dossiers locaux nouveaux et pour la racine distante.
 */
export const Route = createFileRoute("/api/drive/sync/folder")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await authenticateSyncRequest(request, "drive:write");
        if (auth instanceof Response) return auth;

        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return Response.json(
            { error: "validation", message: "Corps JSON invalide." },
            { status: 400 },
          );
        }

        const parsed = bodySchema.safeParse(body);
        if (!parsed.success) {
          return Response.json(
            { error: "validation", message: "parentId ou name invalide." },
            { status: 400 },
          );
        }

        try {
          const entry = await ensureFolder(auth.actor, {
            parentId: parsed.data.parentId ?? null,
            name: parsed.data.name,
          });
          return Response.json({ entry: syncEntryJson(entry) });
        } catch (error) {
          return syncErrorResponse(error);
        }
      },
    },
  },
});
