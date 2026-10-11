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
  restoreMessage,
  saveDraft,
  sendMail,
  toggleStar,
  trashMessage,
} from "./index.ts";

export type { FolderCounts, FolderKey, MessageDetail, MessageSummary } from "./index.ts";

const folderSchema = z.enum(["inbox", "sent", "drafts", "trash"]);

const mailFields = z.object({
  id: z.string().uuid().optional(),
  to: z.array(z.string().max(255)).max(20),
  cc: z.array(z.string().max(255)).max(20),
  subject: z.string().max(500),
  body: z.string().max(100_000),
});

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
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { actor } = await requireActor(getRequest().headers);
    return listMessages(actor, data);
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
  .validator((input: unknown) => mailFields.parse(input))
  .handler(async ({ data }) => {
    const { actor } = await requireActor(getRequest().headers);
    return sendMail(actor, data);
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
