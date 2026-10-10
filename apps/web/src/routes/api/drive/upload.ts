import { createFileRoute } from "@tanstack/react-router";
import { uploadFile } from "@workspace/drive";
import { requireActor } from "../../../server/actor";

/**
 * Upload binaire (multipart/form-data) : champ `file` + `parentId` optionnel.
 * L'autorisation est vérifiée par le service Drive (aucune confiance dans le client).
 */
export const Route = createFileRoute("/api/drive/upload")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const { actor, userId } = await requireActor(request.headers);
          const form = await request.formData();

          const file = form.get("file");
          const parentRaw = form.get("parentId");
          const parentId = typeof parentRaw === "string" && parentRaw.length > 0 ? parentRaw : null;

          if (!(file instanceof File)) {
            return Response.json(
              { error: "validation", message: "Fichier manquant." },
              { status: 400 },
            );
          }

          const body = Buffer.from(await file.arrayBuffer());
          const { entry } = await uploadFile(actor, {
            parentId,
            name: file.name || "sans-nom",
            contentType: file.type || undefined,
            body,
          });

          return Response.json({
            entry: {
              id: entry.id,
              kind: entry.kind,
              name: entry.name,
              mimeType: entry.mimeType,
              sizeBytes: entry.sizeBytes,
              updatedAt: entry.updatedAt.toISOString(),
              isOwner: entry.ownerId === userId,
            },
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Erreur interne.";
          return Response.json({ error: "upload_failed", message }, { status: 400 });
        }
      },
    },
  },
});
