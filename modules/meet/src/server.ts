import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { requireActor } from "@workspace/auth";
import { z } from "zod";
import {
  admitParticipant,
  createRoom,
  deleteRoom,
  denyParticipant,
  getLobbyStatus,
  getRoom,
  getRoomToken,
  listLobby,
  listRooms,
  requestAdmission,
  setRoomAdmission,
  withdrawAdmission,
} from "./index.ts";

export type {
  LobbyEntryView,
  LobbyStateView,
  LobbyStatusView,
  RoomToken,
  RoomView,
} from "./index.ts";

const slugSchema = z.object({ slug: z.string().min(1).max(64) });
const targetSchema = slugSchema.extend({ userId: z.string().min(1).max(64) });

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
  .validator((input: unknown) => slugSchema.parse(input))
  .handler(async ({ data }) => {
    const { actor } = await requireActor(getRequest().headers);
    return getRoom(actor, data.slug);
  });

export const getRoomTokenFn = createServerFn({ method: "GET" })
  .validator((input: unknown) => slugSchema.parse(input))
  .handler(async ({ data }) => {
    const { actor } = await requireActor(getRequest().headers);
    return getRoomToken(actor, data.slug);
  });

export const deleteRoomFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => slugSchema.parse(input))
  .handler(async ({ data }) => {
    const { actor } = await requireActor(getRequest().headers);
    await deleteRoom(actor, data.slug);
    return { ok: true };
  });

export const setRoomAdmissionFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => slugSchema.extend({ required: z.boolean() }).parse(input))
  .handler(async ({ data }) => {
    const { actor } = await requireActor(getRequest().headers);
    return setRoomAdmission(actor, data.slug, data.required);
  });

/* --------------------------- salle d'attente --------------------------- */

export const lobbyStatusFn = createServerFn({ method: "GET" })
  .validator((input: unknown) => slugSchema.parse(input))
  .handler(async ({ data }) => {
    const { actor } = await requireActor(getRequest().headers);
    return getLobbyStatus(actor, data.slug);
  });

export const lobbyRequestFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => slugSchema.parse(input))
  .handler(async ({ data }) => {
    const { actor } = await requireActor(getRequest().headers);
    return requestAdmission(actor, data.slug);
  });

export const lobbyWithdrawFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => slugSchema.parse(input))
  .handler(async ({ data }) => {
    const { actor } = await requireActor(getRequest().headers);
    await withdrawAdmission(actor, data.slug);
    return { ok: true };
  });

export const lobbyListFn = createServerFn({ method: "GET" })
  .validator((input: unknown) => slugSchema.parse(input))
  .handler(async ({ data }) => {
    const { actor } = await requireActor(getRequest().headers);
    return listLobby(actor, data.slug);
  });

export const lobbyAdmitFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => targetSchema.parse(input))
  .handler(async ({ data }) => {
    const { actor } = await requireActor(getRequest().headers);
    return admitParticipant(actor, data.slug, data.userId);
  });

export const lobbyDenyFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => targetSchema.parse(input))
  .handler(async ({ data }) => {
    const { actor } = await requireActor(getRequest().headers);
    return denyParticipant(actor, data.slug, data.userId);
  });
