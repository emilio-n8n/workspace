import { createFileRoute } from "@tanstack/react-router";
import { NoOrganizationError, requireActor, UnauthorizedError } from "@workspace/auth";
import {
  MAX_SLIDE_IMAGE_BYTES,
  SlidesError,
  type SlidesErrorCode,
  uploadSlideImage,
} from "@workspace/slides";
import { z } from "zod";

/**
 * Upload d'une image de diapositive (multipart/form-data) :
 * `POST /api/slides/upload?fileId=<uuid>`, champ `file`.
 * L'autorisation (droit d'écriture) est vérifiée par le service Slides.
 */

const fileIdSchema = z.string().uuid();

/** Statut HTTP associé aux erreurs métier du service Slides. */
const SLIDES_ERROR_STATUS: Record<SlidesErrorCode, number> = {
  validation: 400,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
};

export const Route = createFileRoute("/api/slides/upload")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // Préflight : refuse un corps manifestement trop gros avant de le
        // bufferiser. `content-length` inclut l'enveloppe multipart → marge.
        const declared = Number(request.headers.get("content-length") ?? "0");
        if (declared > MAX_SLIDE_IMAGE_BYTES + 1_000_000) {
          return new Response("Image trop volumineuse", { status: 413 });
        }

        try {
          const { actor } = await requireActor(request.headers);

          const parsedFileId = fileIdSchema.safeParse(
            new URL(request.url).searchParams.get("fileId"),
          );
          if (!parsedFileId.success) {
            return Response.json(
              { error: "validation", message: "Identifiant de présentation invalide." },
              { status: 400 },
            );
          }

          const form = await request.formData();
          const file = form.get("file");
          if (!(file instanceof File)) {
            return Response.json(
              { error: "validation", message: "Fichier manquant." },
              { status: 400 },
            );
          }

          const body = Buffer.from(await file.arrayBuffer());
          const { mediaKey } = await uploadSlideImage(actor, parsedFileId.data, {
            contentType: file.type,
            body,
          });

          return Response.json({ mediaKey });
        } catch (error) {
          // Jamais de message non maîtrisé renvoyé au client : messages
          // français portés par le service, sinon réponse générique.
          if (error instanceof SlidesError) {
            return Response.json(
              { error: error.code, message: error.message },
              { status: SLIDES_ERROR_STATUS[error.code] },
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
            { error: "upload_failed", message: "Échec du téléversement de l'image." },
            { status: 500 },
          );
        }
      },
    },
  },
});
