import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { requireActor } from "@workspace/auth";
import { z } from "zod";
import {
  createChannel,
  listChannels,
  listMessages,
  listOrgMembers,
  markRead,
  sendMessage,
  startDm,
} from "./index.ts";

export type { ChannelView, MessageView, OrgMemberView } from "./index.ts";

export const listChannelsFn = createServerFn({ method: "GET" }).handler(async () => {
  const { actor } = await requireActor(getRequest().headers);
  return listChannels(actor);
});

export const listOrgMembersFn = createServerFn({ method: "GET" }).handler(async () => {
  const { actor } = await requireActor(getRequest().headers);
  return listOrgMembers(actor);
});

export const createChannelFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ name: z.string().trim().min(1).max(80) }).parse(input))
  .handler(async ({ data }) => {
    const { actor } = await requireActor(getRequest().headers);
    return createChannel(actor, data.name);
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
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { actor } = await requireActor(getRequest().headers);
    return sendMessage(actor, data.channelId, data.body);
  });

export const markReadFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ channelId: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const { actor } = await requireActor(getRequest().headers);
    await markRead(actor, data.channelId);
    return { ok: true };
  });
