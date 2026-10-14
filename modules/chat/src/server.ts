import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { requireActor } from "@workspace/auth";
import { z } from "zod";
import {
  addChannelMember,
  archiveChannel,
  createChannel,
  getUnreadState,
  joinChannel,
  listChannelMembers,
  listChannels,
  listJoinableChannels,
  listMessages,
  listOrgMembers,
  listPins,
  listTypingUsers,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS,
  markRead,
  notifyTyping,
  pinMessage,
  restoreChannel,
  sendMessage,
  startDm,
  unpinMessage,
  uploadChatAttachment,
} from "./index.ts";

export type {
  AttachmentMeta,
  AttachmentToken,
  ChannelMemberView,
  ChannelView,
  ChannelVisibility,
  JoinableChannelView,
  MessageView,
  OrgMemberView,
  PinView,
  TypingUser,
  UnreadState,
} from "./index.ts";

const channelIdSchema = z.string().uuid();
const visibilitySchema = z.enum(["public", "private"]);

/** Jeton renvoyé par uploadChatAttachmentFn, rejoué tel quel à l'envoi. */
const attachmentTokenSchema = z.object({
  storageKey: z.string().min(1).max(512),
  filename: z.string().min(1).max(255),
  contentType: z.string().min(1).max(200),
  sizeBytes: z.number().int().nonnegative(),
});

/** Base64 d'une pièce jointe de 10 Mio (4 caractères pour 3 octets). */
const MAX_ATTACHMENT_BASE64_LENGTH = Math.ceil(MAX_ATTACHMENT_BYTES / 3) * 4;

export const listChannelsFn = createServerFn({ method: "GET" }).handler(async () => {
  const { actor } = await requireActor(getRequest().headers);
  return listChannels(actor);
});

export const listOrgMembersFn = createServerFn({ method: "GET" }).handler(async () => {
  const { actor } = await requireActor(getRequest().headers);
  return listOrgMembers(actor);
});

export const createChannelFn = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z
      .object({ name: z.string().trim().min(1).max(80), visibility: visibilitySchema.optional() })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { actor } = await requireActor(getRequest().headers);
    return createChannel(actor, data.name, data.visibility ?? "public");
  });

export const archiveChannelFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ channelId: channelIdSchema }).parse(input))
  .handler(async ({ data }) => {
    const { actor } = await requireActor(getRequest().headers);
    await archiveChannel(actor, data.channelId);
    return { ok: true };
  });

export const restoreChannelFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ channelId: channelIdSchema }).parse(input))
  .handler(async ({ data }) => {
    const { actor } = await requireActor(getRequest().headers);
    await restoreChannel(actor, data.channelId);
    return { ok: true };
  });

/** Membres d'un canal — visibles par les membres, canaux privés compris. */
export const listChannelMembersFn = createServerFn({ method: "GET" })
  .validator((input: unknown) => z.object({ channelId: channelIdSchema }).parse(input))
  .handler(async ({ data }) => {
    const { actor } = await requireActor(getRequest().headers);
    return listChannelMembers(actor, data.channelId);
  });

/** Invitation directe à un canal — réservée à la personne qui l'a créé. */
export const addChannelMemberFn = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z.object({ channelId: channelIdSchema, userId: z.string().min(1).max(64) }).parse(input),
  )
  .handler(async ({ data }) => {
    const { actor } = await requireActor(getRequest().headers);
    return addChannelMember(actor, data.channelId, data.userId);
  });

export const joinChannelFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ channelId: channelIdSchema }).parse(input))
  .handler(async ({ data }) => {
    const { actor } = await requireActor(getRequest().headers);
    return joinChannel(actor, data.channelId);
  });

/** Canaux publics de l'organisation que l'acteur peut encore rejoindre. */
export const listJoinableChannelsFn = createServerFn({ method: "GET" }).handler(async () => {
  const { actor } = await requireActor(getRequest().headers);
  return listJoinableChannels(actor);
});

export const startDmFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ userId: z.string().min(1) }).parse(input))
  .handler(async ({ data }) => {
    const { actor } = await requireActor(getRequest().headers);
    return startDm(actor, data.userId);
  });

export const listMessagesFn = createServerFn({ method: "GET" })
  .validator((input: unknown) =>
    z
      .object({
        channelId: z.string().uuid(),
        before: z.string().optional(),
        beforeId: z.string().uuid().optional(),
        limit: z.number().int().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { actor } = await requireActor(getRequest().headers);
    return listMessages(actor, data.channelId, {
      before: data.before,
      beforeId: data.beforeId,
      limit: data.limit,
    });
  });

export const sendMessageFn = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z
      .object({
        channelId: z.string().uuid(),
        body: z.string().trim().min(1).max(4000),
        /** Jetons d'upload (uploadChatAttachmentFn) à rattacher au message. */
        attachments: z.array(attachmentTokenSchema).max(MAX_ATTACHMENTS).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { actor } = await requireActor(getRequest().headers);
    return sendMessage(actor, data.channelId, data.body, data.attachments ?? []);
  });

/**
 * Téléversement d'une pièce jointe du compositeur : le binaire circule en
 * base64 (les server functions sont du JSON), puis devient un jeton provisoire
 * rattaché au message au moment de l'envoi.
 */
export const uploadChatAttachmentFn = createServerFn({ method: "POST" })
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
    return uploadChatAttachment(actor, {
      filename: data.filename,
      contentType: data.contentType,
      body: Buffer.from(data.contentBase64, "base64"),
    });
  });

export const markReadFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ channelId: channelIdSchema }).parse(input))
  .handler(async ({ data }) => {
    const { actor } = await requireActor(getRequest().headers);
    await markRead(actor, data.channelId);
    return { ok: true };
  });

/**
 * Frontière des non-lus : à appeler AVANT `markReadFn`, sinon le curseur a déjà
 * avancé et le séparateur n'a plus rien à séparer.
 */
export const getUnreadStateFn = createServerFn({ method: "GET" })
  .validator((input: unknown) => z.object({ channelId: channelIdSchema }).parse(input))
  .handler(async ({ data }) => {
    const { actor } = await requireActor(getRequest().headers);
    return getUnreadState(actor, data.channelId);
  });

/**
 * Indicateur de frappe : diffusé aux autres membres connectés par le flux
 * SSE du canal (`event: typing`). `typing: false` signale l'arrêt.
 */
export const notifyTypingFn = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z.object({ channelId: channelIdSchema, typing: z.boolean().optional() }).parse(input),
  )
  .handler(async ({ data }) => {
    const { actor } = await requireActor(getRequest().headers);
    await notifyTyping(actor, data.channelId, data.typing ?? true);
    return { ok: true };
  });

/** Repli du flux SSE : personnes en train d'écrire, soi-même exclue. */
export const listTypingUsersFn = createServerFn({ method: "GET" })
  .validator((input: unknown) => z.object({ channelId: channelIdSchema }).parse(input))
  .handler(async ({ data }) => {
    const { actor } = await requireActor(getRequest().headers);
    return listTypingUsers(actor, data.channelId);
  });

export const listPinsFn = createServerFn({ method: "GET" })
  .validator((input: unknown) => z.object({ channelId: channelIdSchema }).parse(input))
  .handler(async ({ data }) => {
    const { actor } = await requireActor(getRequest().headers);
    return listPins(actor, data.channelId);
  });

export const pinMessageFn = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z.object({ channelId: channelIdSchema, messageId: channelIdSchema }).parse(input),
  )
  .handler(async ({ data }) => {
    const { actor } = await requireActor(getRequest().headers);
    await pinMessage(actor, data.channelId, data.messageId);
    return { ok: true };
  });

export const unpinMessageFn = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z.object({ channelId: channelIdSchema, messageId: channelIdSchema }).parse(input),
  )
  .handler(async ({ data }) => {
    const { actor } = await requireActor(getRequest().headers);
    await unpinMessage(actor, data.channelId, data.messageId);
    return { ok: true };
  });
