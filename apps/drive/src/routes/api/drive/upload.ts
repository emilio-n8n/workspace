import { createFileRoute } from "@tanstack/react-router";
import { NoOrganizationError, requireActor, UnauthorizedError } from "@workspace/auth";
import { DriveError, type DriveErrorCode, getMaxUploadBytes, uploadFile } from "@workspace/drive";
import { z } from "zod";

/**
 * Upload binaire (multipart/form-data) : champ `file` + `parentId` optionnel.
 * L'autorisation est vérifiée par le service Drive (aucune confiance dans le client).
 */

const parentIdSchema = z.string().uuid();

/** Statut HTTP associé aux erreurs métier du service Drive. */
const DRIVE_ERROR_STATUS: Record<DriveErrorCode, number> = {
  validation: 400,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  quota: 507,
};

export const Route = createFileRoute("/api/drive/upload")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // Préflight : refuse un corps manifestement trop gros avant de le bufferiser.
        // `content-length` inclut l'enveloppe multipart → marge de 1 Mo.
        const declared = Number(request.headers.get("content-length") ?? "0");
        if (declared > getMaxUploadBytes() + 1_000_000) {
          return new Response("Fichier trop volumineux", { status: 413 });
        }

        try {
          const { actor, userId } = await requireActor(request.headers);
          const form = await request.formData();

          const file = form.get("file");
          const parentRaw = form.get("parentId");
          let parentId: string | null = null;
          if (typeof parentRaw === "string" && parentRaw.length > 0) {
            const parsed = parentIdSchema.safeParse(parentRaw);
            if (!parsed.success) {
              return Response.json(
                { error: "validation", message: "Identifiant de dossier invalide." },
                { status: 400 },
              );
            }
            parentId = parsed.data;
          }

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
          // Jamais de message non maîtrisé renvoyé au client : messages français
          // portés par le service, sinon réponse générique.
          if (error instanceof DriveError) {
            return Response.json(
              { error: error.code, message: error.message },
              { status: DRIVE_ERROR_STATUS[error.code] },
            );
          }
          if (error instanceof UnauthorizedError) {
            return Response.json(
              { error: "unauthorized", message: error.message },
              { status: 401 },
            );
          }
          if (error instanceof NoOrganizationError) {
            return Response.json(
              { error: "no_organization", message: error.message },
              { status: 403 },
            );
          }
          return Response.json(
            { error: "upload_failed", message: "Échec du téléversement du fichier." },
            { status: 500 },
          );
        }
      },
    },
  },
});
