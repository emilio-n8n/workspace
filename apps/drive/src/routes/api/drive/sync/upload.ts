import { createFileRoute } from "@tanstack/react-router";
import { getMaxUploadBytes, replaceContent, uploadFile } from "@workspace/drive";
import { z } from "zod";
import {
  authenticateSyncRequest,
  syncEntryJson,
  syncErrorResponse,
} from "../../../../server/sync-auth.ts";

const parentIdSchema = z.string().uuid();
const entryIdSchema = z.string().uuid();
const nameSchema = z.string().min(1).max(255);

/**
 * Envoi d'un fichier depuis le client de synchronisation.
 * - `entryId` fourni : remplace le contenu (nouvelle version Drive) ;
 * - sinon : crée un fichier dans `parentId`.
 */
export const Route = createFileRoute("/api/drive/sync/upload")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await authenticateSyncRequest(request, "drive:write");
        if (auth instanceof Response) return auth;

        const declared = Number(request.headers.get("content-length") ?? "0");
        if (declared > getMaxUploadBytes() + 1_000_000) {
          return Response.json(
            { error: "validation", message: "Fichier trop volumineux." },
            { status: 413 },
          );
        }

        let form: FormData;
        try {
          form = await request.formData();
        } catch {
          return Response.json(
            { error: "validation", message: "Corps multipart invalide." },
            { status: 400 },
          );
        }

        const file = form.get("file");
        if (!(file instanceof File)) {
          return Response.json(
            { error: "validation", message: "Fichier manquant." },
            { status: 400 },
          );
        }

        const rawEntryId = form.get("entryId");
        const rawParentId = form.get("parentId");
        const rawName = form.get("name");
        const rawContentType = form.get("contentType");

        const entryId =
          typeof rawEntryId === "string" && rawEntryId.length > 0
            ? entryIdSchema.safeParse(rawEntryId)
            : null;
        if (entryId && !entryId.success) {
          return Response.json(
            { error: "validation", message: "entryId invalide." },
            { status: 400 },
          );
        }

        const parentId =
          typeof rawParentId === "string" && rawParentId.length > 0
            ? parentIdSchema.safeParse(rawParentId)
            : null;
        if (parentId && !parentId.success) {
          return Response.json(
            { error: "validation", message: "parentId invalide." },
            { status: 400 },
          );
        }

        const name =
          typeof rawName === "string" && rawName.length > 0
            ? nameSchema.safeParse(rawName)
            : nameSchema.safeParse(file.name || "sans-nom");
        if (!name.success) {
          return Response.json(
            { error: "validation", message: "Nom de fichier invalide." },
            { status: 400 },
          );
        }

        const contentType =
          (typeof rawContentType === "string" && rawContentType.length > 0
            ? rawContentType
            : file.type) || undefined;

        try {
          const body = Buffer.from(await file.arrayBuffer());
          const result = entryId?.success
            ? await replaceContent(auth.actor, entryId.data, { contentType, body })
            : await uploadFile(auth.actor, {
                parentId: parentId?.success ? parentId.data : null,
                name: name.data,
                contentType,
                body,
              });

          return Response.json({ entry: syncEntryJson(result.entry) });
        } catch (error) {
          return syncErrorResponse(error);
        }
      },
    },
  },
});
