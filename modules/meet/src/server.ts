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
  joinRoom,
  leaveRoom,
  listChatMessages,
  listLobby,
  listParticipants,
  listRaisedHands,
  listRooms,
  lowerParticipantHand,
  markChatRead,
  removeParticipant,
  requestAdmission,
  sendChatMessage,
  setHandRaised,
  setParticipantMuted,
  setParticipantRole,
  setRoomAdmission,
  withdrawAdmission,
} from "./index.ts";

export type {
  ChatHistoryView,
  ChatMessageView,
  LobbyEntryView,
  LobbyStateView,
  LobbyStatusView,
  ParticipantView,
  RoomToken,
  RoomView,
  RosterView,
} from "./index.ts";

const slugSchema = z.object({ slug: z.string().min(1).max(64) });
const targetSchema = slugSchema.extend({ userId: z.string().min(1).max(64) });

/** Longueur maximale d'un message de chat (miroir de CHAT_MAX_LENGTH). */
const CHAT_BODY_MAX = 2000;

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

/* ----------------------------- participants ----------------------------- */

export const rosterFn = createServerFn({ method: "GET" })
  .validator((input: unknown) => slugSchema.parse(input))
  .handler(async ({ data }) => {
    const { actor } = await requireActor(getRequest().headers);
    return listParticipants(actor, data.slug);
  });

export const handsFn = createServerFn({ method: "GET" })
  .validator((input: unknown) => slugSchema.parse(input))
  .handler(async ({ data }) => {
    const { actor } = await requireActor(getRequest().headers);
    return listRaisedHands(actor, data.slug);
  });

export const joinRoomFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => slugSchema.parse(input))
  .handler(async ({ data }) => {
    const { actor } = await requireActor(getRequest().headers);
    await joinRoom(actor, data.slug);
    return { ok: true };
  });

export const leaveRoomFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => slugSchema.parse(input))
  .handler(async ({ data }) => {
    const { actor } = await requireActor(getRequest().headers);
    await leaveRoom(actor, data.slug);
    return { ok: true };
  });

export const setParticipantMutedFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => targetSchema.extend({ muted: z.boolean() }).parse(input))
  .handler(async ({ data }) => {
    const { actor } = await requireActor(getRequest().headers);
    return setParticipantMuted(actor, data.slug, data.userId, data.muted);
  });

export const removeParticipantFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => targetSchema.parse(input))
  .handler(async ({ data }) => {
    const { actor } = await requireActor(getRequest().headers);
    return removeParticipant(actor, data.slug, data.userId);
  });

export const setParticipantRoleFn = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    targetSchema.extend({ role: z.enum(["moderator", "participant"]) }).parse(input),
  )
  .handler(async ({ data }) => {
    const { actor } = await requireActor(getRequest().headers);
    return setParticipantRole(actor, data.slug, data.userId, data.role);
  });

export const setHandRaisedFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => slugSchema.extend({ raised: z.boolean() }).parse(input))
  .handler(async ({ data }) => {
    const { actor } = await requireActor(getRequest().headers);
    return setHandRaised(actor, data.slug, data.raised);
  });

export const lowerHandFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => targetSchema.parse(input))
  .handler(async ({ data }) => {
    const { actor } = await requireActor(getRequest().headers);
    return lowerParticipantHand(actor, data.slug, data.userId);
  });

/* -------------------------------- chat -------------------------------- */

export const chatMessagesFn = createServerFn({ method: "GET" })
  .validator((input: unknown) => slugSchema.parse(input))
  .handler(async ({ data }) => {
    const { actor } = await requireActor(getRequest().headers);
    return listChatMessages(actor, data.slug);
  });

export const chatSendFn = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z
      .object({ slug: z.string().min(1).max(64), body: z.string().trim().max(CHAT_BODY_MAX) })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { actor } = await requireActor(getRequest().headers);
    return sendChatMessage(actor, data.slug, data.body);
  });

export const chatMarkReadFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => slugSchema.parse(input))
  .handler(async ({ data }) => {
    const { actor } = await requireActor(getRequest().headers);
    return markChatRead(actor, data.slug);
  });
