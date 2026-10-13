import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { requireActor } from "@workspace/auth";
import { z } from "zod";
import {
  deleteMessage,
  ensureMailbox,
  getMessage,
  listFolders,
  listMessages,
  listThreadMessages,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS,
  restoreMessage,
  saveDraft,
  sendMail,
  toggleStar,
  trashMessage,
  uploadMailAttachment,
} from "./index.ts";

export type {
  AttachmentMeta,
  AttachmentToken,
  FolderCounts,
  FolderKey,
  MessageDetail,
  MessageSummary,
  ThreadSummary,
} from "./index.ts";

const folderSchema = z.enum(["inbox", "sent", "drafts", "trash"]);

const mailFields = z.object({
  id: z.string().uuid().optional(),
  to: z.array(z.string().max(255)).max(20),
  cc: z.array(z.string().max(255)).max(20),
  subject: z.string().max(500),
  body: z.string().max(100_000),
});

/** Jeton renvoyé par uploadMailAttachmentFn, rejoué tel quel à l'envoi. */
const attachmentTokenSchema = z.object({
  storageKey: z.string().min(1).max(512),
  filename: z.string().min(1).max(255),
  contentType: z.string().min(1).max(200),
  sizeBytes: z.number().int().nonnegative(),
});

const sendMailFields = mailFields.extend({
  attachments: z.array(attachmentTokenSchema).max(MAX_ATTACHMENTS).optional(),
});

/** Base64 d'une pièce jointe de 10 Mio (4 caractères pour 3 octets). */
const MAX_ATTACHMENT_BASE64_LENGTH = Math.ceil(MAX_ATTACHMENT_BYTES / 3) * 4;

export const getMailboxFn = createServerFn({ method: "GET" }).handler(async () => {
  const { actor } = await requireActor(getRequest().headers);
  return ensureMailbox(actor);
});

export const listFoldersFn = createServerFn({ method: "GET" }).handler(async () => {
  const { actor } = await requireActor(getRequest().headers);
  return listFolders(actor);
});

export const listMessagesFn = createServerFn({ method: "GET" })
  .validator((input: unknown) =>
    z
      .object({
        folder: folderSchema.optional(),
        query: z.string().max(200).optional(),
        unreadOnly: z.boolean().optional(),
        starredOnly: z.boolean().optional(),
        /** true → résumés de fils de discussion au lieu des messages plats. */
        threaded: z.boolean().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { actor } = await requireActor(getRequest().headers);
    return listMessages(actor, data);
  });

export const listThreadMessagesFn = createServerFn({ method: "GET" })
  .validator((input: unknown) => z.object({ messageId: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const { actor } = await requireActor(getRequest().headers);
    return listThreadMessages(actor, data.messageId);
  });

export const getMessageFn = createServerFn({ method: "GET" })
  .validator((input: unknown) => z.object({ messageId: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const { actor } = await requireActor(getRequest().headers);
    return getMessage(actor, data.messageId);
  });

export const toggleStarFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ messageId: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const { actor } = await requireActor(getRequest().headers);
    return toggleStar(actor, data.messageId);
  });

export const saveDraftFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => mailFields.parse(input))
  .handler(async ({ data }) => {
    const { actor } = await requireActor(getRequest().headers);
    return saveDraft(actor, data);
  });

export const sendMailFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => sendMailFields.parse(input))
  .handler(async ({ data }) => {
    const { actor } = await requireActor(getRequest().headers);
    return sendMail(actor, data);
  });

/**
 * Téléversement d'une pièce jointe du compositeur : le binaire circule en
 * base64 (les server functions sont du JSON), puis devient un jeton provisoire
 * rattaché au message au moment de l'envoi.
 */
export const uploadMailAttachmentFn = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z
      .object({
        filename: z.string().min(1).max(255),
        contentType: z.string().min(1).max(200),
        contentBase64: z
          .string()
          .min(1)
          .max(MAX_ATTACHMENT_BASE64_LENGTH)
          .regex(/^[A-Za-z0-9+/]*={0,2}$/),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { actor } = await requireActor(getRequest().headers);
    return uploadMailAttachment(actor, {
      filename: data.filename,
      contentType: data.contentType,
      body: Buffer.from(data.contentBase64, "base64"),
    });
  });

export const trashMessageFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ messageId: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const { actor } = await requireActor(getRequest().headers);
    await trashMessage(actor, data.messageId);
    return { ok: true };
  });

export const restoreMessageFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ messageId: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const { actor } = await requireActor(getRequest().headers);
    await restoreMessage(actor, data.messageId);
    return { ok: true };
  });

export const deleteMessageFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ messageId: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const { actor } = await requireActor(getRequest().headers);
    await deleteMessage(actor, data.messageId);
    return { ok: true };
  });
