import { createFileRoute } from "@tanstack/react-router";
import { moveEntries, rename, trash } from "@workspace/drive";
import { z } from "zod";
import {
  authenticateSyncRequest,
  syncEntryJson,
  syncErrorResponse,
} from "../../../../server/sync-auth.ts";

const bodySchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("move"),
    entryId: z.string().uuid(),
    parentId: z.string().uuid().nullable(),
  }),
  z.object({
    action: z.literal("rename"),
    entryId: z.string().uuid(),
    name: z.string().min(1).max(255),
  }),
  z.object({
    action: z.literal("trash"),
    entryId: z.string().uuid(),
  }),
]);

/**
 * Opérations de structure demandées par le client : déplacement, renommage,
 * mise à la corbeille. Les droits sont revérifiés par le service Drive.
 */
export const Route = createFileRoute("/api/drive/sync/op")({
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
            { error: "validation", message: "Opération invalide." },
            { status: 400 },
          );
        }

        try {
          const op = parsed.data;
          if (op.action === "move") {
            const result = await moveEntries(auth.actor, {
              entryIds: [op.entryId],
              targetParentId: op.parentId,
            });
            const failure = result.failures[0];
            if (failure) {
              return Response.json(
                { error: "conflict", message: failure.message },
                { status: 409 },
              );
            }
            return Response.json({ ok: true });
          }

          if (op.action === "rename") {
            const entry = await rename(auth.actor, op.entryId, op.name);
            return Response.json({ ok: true, entry: syncEntryJson(entry) });
          }

          await trash(auth.actor, op.entryId);
          return Response.json({ ok: true });
        } catch (error) {
          return syncErrorResponse(error);
        }
      },
    },
  },
});
