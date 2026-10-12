import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { requireActor } from "@workspace/auth";
import { effectiveRole } from "@workspace/drive";
import { roleSatisfies } from "@workspace/permissions";
import { z } from "zod";
import {
  createDocument,
  getDocumentByFileId,
  listDocuments,
  listDocumentVersions,
  renameDocument,
  saveDocument,
} from "./index.ts";

const fileInput = z.object({ fileId: z.string().uuid() });

export const listDocumentsFn = createServerFn({ method: "GET" })
  .validator((input: unknown) =>
    z.object({ parentFolderId: z.string().uuid().nullable() }).parse(input),
  )
  .handler(async ({ data }) => {
    const { actor, userId } = await requireActor(getRequest().headers);
    const entries = await listDocuments(actor, { parentFolderId: data.parentFolderId });
    return entries.map((entry) => ({
      id: entry.id,
      name: entry.name,
      updatedAt: entry.updatedAt.toISOString(),
      isOwner: entry.ownerId === userId,
    }));
  });

export const createDocumentFn = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z
      .object({
        parentFolderId: z.string().uuid().nullable(),
        title: z.string().trim().min(1).max(255),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { actor } = await requireActor(getRequest().headers);
    const { entry, document } = await createDocument(actor, {
      parentFolderId: data.parentFolderId,
      title: data.title,
    });
    return { fileId: entry.id, documentId: document.id, title: document.title };
  });

export const getDocumentFn = createServerFn({ method: "GET" })
  .validator((input: unknown) => fileInput.parse(input))
  .handler(async ({ data }) => {
    const { actor } = await requireActor(getRequest().headers);
    const { entry, document, content, revision } = await getDocumentByFileId(actor, data.fileId);
    const role = await effectiveRole(actor, data.fileId);

    return {
      fileId: entry.id,
      title: document.title,
      // Contenu JSON ProseMirror : structure validée par le service, sûr à sérialiser.
      content: content as never,
      currentVersion: document.currentVersion,
      updatedAt: entry.updatedAt.toISOString(),
      // Jeton de révision à renvoyer en `baseUpdatedAt` lors de la sauvegarde.
      revision,
      canEdit: roleSatisfies(role, "write"),
    };
  });

export const saveDocumentFn = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z
      .object({
        fileId: z.string().uuid(),
        content: z.unknown(),
        mode: z.enum(["replace-latest", "append"]).default("replace-latest"),
        // Révision connue du client : vérifiée par le service pour l'autosave.
        baseUpdatedAt: z.string().min(1).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { actor } = await requireActor(getRequest().headers);
    return saveDocument(actor, data.fileId, {
      content: data.content,
      mode: data.mode,
      baseUpdatedAt: data.baseUpdatedAt,
    });
  });

export const renameDocumentFn = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z
      .object({
        fileId: z.string().uuid(),
        title: z.string().trim().min(1).max(255),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { actor } = await requireActor(getRequest().headers);
    const entry = await renameDocument(actor, data.fileId, data.title);
    return { title: entry.name };
  });

export const listDocumentVersionsFn = createServerFn({ method: "GET" })
  .validator((input: unknown) => fileInput.parse(input))
  .handler(async ({ data }) => {
    const { actor } = await requireActor(getRequest().headers);
    const versions = await listDocumentVersions(actor, data.fileId);
    return versions.map((version) => ({
      id: version.id,
      version: version.version,
      createdAt: version.createdAt.toISOString(),
    }));
  });
