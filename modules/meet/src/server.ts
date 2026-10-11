import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { requireActor } from "@workspace/auth";
import { z } from "zod";
import { createRoom, deleteRoom, getRoom, getRoomToken, listRooms } from "./index.ts";

export type { RoomToken, RoomView } from "./index.ts";

export const listRoomsFn = createServerFn({ method: "GET" }).handler(async () => {
  const { actor } = await requireActor(getRequest().headers);
  return listRooms(actor);
});

export const createRoomFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ name: z.string().trim().min(1).max(120) }).parse(input))
  .handler(async ({ data }) => {
    const { actor } = await requireActor(getRequest().headers);
    return createRoom(actor, data.name);
  });

export const getRoomFn = createServerFn({ method: "GET" })
  .validator((input: unknown) => z.object({ slug: z.string().min(1).max(64) }).parse(input))
  .handler(async ({ data }) => {
    const { actor } = await requireActor(getRequest().headers);
    return getRoom(actor, data.slug);
  });

export const getRoomTokenFn = createServerFn({ method: "GET" })
  .validator((input: unknown) => z.object({ slug: z.string().min(1).max(64) }).parse(input))
  .handler(async ({ data }) => {
    const { actor } = await requireActor(getRequest().headers);
    return getRoomToken(actor, data.slug);
  });

export const deleteRoomFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ slug: z.string().min(1).max(64) }).parse(input))
  .handler(async ({ data }) => {
    const { actor } = await requireActor(getRequest().headers);
    await deleteRoom(actor, data.slug);
    return { ok: true };
  });
