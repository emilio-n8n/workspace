import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { requireActor } from "@workspace/auth";
import { z } from "zod";
import {
  archiveMessage,
  createLabel,
  deleteLabel,
  deleteMessage,
  ensureMailbox,
  getMessage,
  listFolders,
  listLabelCounts,
  listLabels,
  listMessages,
  listThreadMessages,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS,
  markThreadRead,
  restoreMessage,
  saveDraft,
  sendMail,
  setMessageLabels,
  toggleStar,
  trashMessage,
  unarchiveMessage,
  updateLabel,
  uploadMailAttachment,
} from "./index.ts";

export type {
  AttachmentMeta,
  AttachmentToken,
  FolderCounts,
  FolderKey,
  MailLabel,
  MessageDetail,
  MessageLabelRef,
  MessageSummary,
  ThreadSummary,
} from "./index.ts";

const folderSchema = z.enum(["inbox", "archive", "sent", "drafts", "trash"]);

const mailFields = z.object({
  id: z.string().uuid().optional(),
  to: z.array(z.string().max(255)).max(20),
  cc: z.array(z.string().max(255)).max(20),
  bcc: z.array(z.string().max(255)).max(20).optional(),
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
        /** Filtre par expéditeur (« De »). */
        from: z.string().max(200).optional(),
        /** Filtre par destinataire (« À »). */
        to: z.string().max(200).optional(),
        unreadOnly: z.boolean().optional(),
        starredOnly: z.boolean().optional(),
        /** Uniquement les messages portant une pièce jointe. */
        hasAttachment: z.boolean().optional(),
        /** Uniquement les messages portant ce libellé. */
        labelId: z.string().uuid().optional(),
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

/** Marque comme lus tous les messages d'une conversation. */
export const markThreadReadFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ messageId: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const { actor } = await requireActor(getRequest().headers);
    return markThreadRead(actor, data.messageId);
  });

export const listLabelsFn = createServerFn({ method: "GET" }).handler(async () => {
  const { actor } = await requireActor(getRequest().headers);
  return listLabels(actor);
});

export const listLabelCountsFn = createServerFn({ method: "GET" }).handler(async () => {
  const { actor } = await requireActor(getRequest().headers);
  return listLabelCounts(actor);
});

export const createLabelFn = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z
      .object({ name: z.string().min(1).max(40), color: z.string().min(1).max(20).optional() })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { actor } = await requireActor(getRequest().headers);
    return createLabel(actor, data);
  });

export const updateLabelFn = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        name: z.string().min(1).max(40).optional(),
        color: z.string().min(1).max(20).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { actor } = await requireActor(getRequest().headers);
    return updateLabel(actor, data);
  });

export const deleteLabelFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const { actor } = await requireActor(getRequest().headers);
    await deleteLabel(actor, data.id);
    return { ok: true };
  });

/** Applique l'ensemble exact des libellés d'un message (ajouts et retraits). */
export const setMessageLabelsFn = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z
      .object({
        messageId: z.string().uuid(),
        labelIds: z.array(z.string().uuid()).max(5),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { actor } = await requireActor(getRequest().headers);
    const labels = await setMessageLabels(actor, data.messageId, data.labelIds);
    return { labels };
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

/** Archive un message reçu ou envoyé (retrouvable dans « Archives »). */
export const archiveMessageFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ messageId: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const { actor } = await requireActor(getRequest().headers);
    await archiveMessage(actor, data.messageId);
    return { ok: true };
  });

/** Sort un message des archives et le rend à son dossier d'origine. */
export const unarchiveMessageFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ messageId: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const { actor } = await requireActor(getRequest().headers);
    await unarchiveMessage(actor, data.messageId);
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
