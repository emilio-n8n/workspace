import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { requireActor } from "@workspace/auth";
import { getServerEnv } from "@workspace/config";
import { getDb, schema } from "@workspace/database";
import { effectiveRole } from "@workspace/drive";
import { roleSatisfies } from "@workspace/permissions";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { COLLAB_TOKEN_TTL_MS, signCollabToken } from "./collab-token.ts";
import {
  addComment,
  createDocument,
  DocsError,
  deleteComment,
  getDocumentByFileId,
  getDocumentVersion,
  listComments,
  listDocuments,
  listDocumentVersions,
  renameDocument,
  resolveComment,
  restoreDocumentVersion,
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
    const { actor, userId } = await requireActor(getRequest().headers);
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
      // Les commentaires s'ouvrent dès le rôle « commenter » (les viewers lisent).
      canComment: roleSatisfies(role, "comment"),
      // Identité du lecteur : l'UI en déduit les commentaires supprimables.
      viewerId: userId,
      isOwner: roleSatisfies(role, "manage"),
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
      // Auteur de la version : l'UI affiche un identifiant court (pas de join).
      createdBy: version.createdBy,
    }));
  });

export const getDocumentVersionFn = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z
      .object({
        fileId: z.string().uuid(),
        version: z.number().int().min(1),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { actor } = await requireActor(getRequest().headers);
    const version = await getDocumentVersion(actor, data.fileId, data.version);
    return {
      version: version.version,
      // Contenu JSON ProseMirror : structure validée par le service, sûr à sérialiser.
      content: version.content as never,
      createdAt: version.createdAt,
      createdBy: version.createdBy,
    };
  });

export const restoreDocumentVersionFn = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z
      .object({
        fileId: z.string().uuid(),
        version: z.number().int().min(1),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { actor } = await requireActor(getRequest().headers);
    return restoreDocumentVersion(actor, data.fileId, data.version);
  });

const commentInput = z.object({
  fileId: z.string().uuid(),
  body: z.string().trim().min(1).max(4000),
  quote: z.string().trim().max(500).optional(),
});

export const addCommentFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => commentInput.parse(input))
  .handler(async ({ data }) => {
    const { actor } = await requireActor(getRequest().headers);
    return addComment(actor, data.fileId, { body: data.body, quote: data.quote ?? null });
  });

export const listCommentsFn = createServerFn({ method: "GET" })
  .validator((input: unknown) => fileInput.parse(input))
  .handler(async ({ data }) => {
    const { actor } = await requireActor(getRequest().headers);
    return listComments(actor, data.fileId);
  });

export const resolveCommentFn = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z
      .object({
        fileId: z.string().uuid(),
        commentId: z.string().uuid(),
        resolved: z.boolean(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { actor } = await requireActor(getRequest().headers);
    return resolveComment(actor, data.fileId, data.commentId, data.resolved);
  });

export const deleteCommentFn = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z.object({ fileId: z.string().uuid(), commentId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data }) => {
    const { actor } = await requireActor(getRequest().headers);
    await deleteComment(actor, data.fileId, data.commentId);
    return { ok: true as const };
  });

/** Résultat de `getCollabTokenFn`. */
export type CollabTokenResult = {
  /** URL du serveur de collaboration, ou `null` si l'instance n'en a pas. */
  url: string | null;
  /** Jeton signé, valable {@link COLLAB_TOKEN_TTL_MS}. */
  token: string;
};

/**
 * Jeton d'accès au serveur de collaboration temps réel (Yjs).
 *
 * L'URL `null` signale au client que la collaboration est désactivée : il
 * conserve l'autosave existant. Le jeton lie l'utilisateur au document avec
 * son droit d'écriture effectif ; la vérification et l'application des droits
 * se font côté serveur de collaboration, sans accès à la base.
 */
export const getCollabTokenFn = createServerFn({ method: "GET" })
  .validator((input: unknown) => fileInput.parse(input))
  .handler(async ({ data }): Promise<CollabTokenResult> => {
    const { actor, userId } = await requireActor(getRequest().headers);
    // Existence du document et appartenance à l'organisation d'abord.
    const { entry } = await getDocumentByFileId(actor, data.fileId);

    const role = await effectiveRole(actor, data.fileId);
    if (!role) {
      throw new DocsError("forbidden", "Permission insuffisante pour collaborer sur ce document.");
    }
    const canWrite = roleSatisfies(role, "write");

    const secret = getServerEnv().SESSION_SECRET;
    if (!secret) {
      throw new Error("SESSION_SECRET est requis pour signer les jetons de collaboration.");
    }

    const [viewer] = await getDb()
      .select({ name: schema.user.name })
      .from(schema.user)
      .where(eq(schema.user.id, userId))
      .limit(1);

    const token = signCollabToken(
      {
        fileId: entry.id,
        userId,
        name: viewer?.name ?? "Utilisateur",
        canWrite,
        exp: Date.now() + COLLAB_TOKEN_TTL_MS,
      },
      secret,
    );

    return { url: getServerEnv().COLLAB_URL ?? null, token };
  });
