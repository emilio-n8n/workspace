import { createHmac, randomBytes } from "node:crypto";
import { recordAudit } from "@workspace/audit";
import { getServerEnv } from "@workspace/config";
import { schema as core, getDb } from "@workspace/database";
import type { Actor } from "@workspace/permissions";
import { and, desc, eq, sql } from "drizzle-orm";
import { meetLobby, meetRooms } from "./schema.ts";

export type MeetErrorCode = "not_found" | "forbidden" | "validation";

export class MeetError extends Error {
  readonly code: MeetErrorCode;
  constructor(code: MeetErrorCode, message: string) {
    super(message);
    this.name = "MeetError";
    this.code = code;
  }
}

export type RoomView = {
  slug: string;
  name: string;
  createdBy: string;
  createdAt: string;
  mine: boolean;
  /** Salle d'attente active : entrée sur admission de l'organisateur. */
  requireAdmission: boolean;
};

export type RoomToken =
  | { configured: false }
  | { configured: true; url: string; token: string; room: string; name: string };

/** Capacité de l'acteur à entrer dans la salle, vue par le client. */
export type LobbyStateView = "none" | "waiting" | "admitted" | "denied";

export type LobbyStatusView = {
  /** La salle utilise-t-elle la salle d'attente ? */
  required: boolean;
  /** L'acteur est-il l'organisateur de la salle ? */
  host: boolean;
  /** `admitted` = entrée autorisée (organisateur, salle libre ou admission accordée). */
  state: LobbyStateView;
  /** Nombre de personnes en attente d'admission. */
  waiting: number;
};

export type LobbyEntryView = {
  id: string;
  userId: string;
  userName: string;
  requestedAt: string;
};

const db = () => getDb();

function base64url(input: string): string {
  return Buffer.from(input, "utf8").toString("base64url");
}

/** Jeton d'accès LiveKit (JWT HS256) — signé côté serveur uniquement. */
export function signLiveKitToken(input: {
  apiKey: string;
  apiSecret: string;
  userId: string;
  userName: string;
  room: string;
  ttlSeconds?: number;
}): string {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "HS256", typ: "JWT" };
  const payload = {
    iss: input.apiKey,
    sub: input.userId,
    name: input.userName,
    video: {
      room: input.room,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
    },
    iat: now,
    exp: now + (input.ttlSeconds ?? 2 * 60 * 60),
  };
  const encoded = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const signature = createHmac("sha256", input.apiSecret).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

async function generateSlug(): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const candidate = randomBytes(5).toString("hex").slice(0, 9);
    const [existing] = await db()
      .select({ id: meetRooms.id })
      .from(meetRooms)
      .where(eq(meetRooms.slug, candidate))
      .limit(1);
    if (!existing) return candidate;
  }
  throw new MeetError("validation", "Génération du lien impossible, réessayez.");
}

function toRoomView(row: typeof meetRooms.$inferSelect, actor: Actor): RoomView {
  return {
    slug: row.slug,
    name: row.name,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    mine: row.createdBy === actor.userId,
    requireAdmission: row.requireAdmission,
  };
}

export async function createRoom(actor: Actor, name: string): Promise<RoomView> {
  const clean = name.trim();
  if (clean.length < 1 || clean.length > 120) {
    throw new MeetError("validation", "Le nom doit contenir entre 1 et 120 caractères.");
  }
  const slug = await generateSlug();
  const [created] = await db()
    .insert(meetRooms)
    .values({ orgId: actor.orgId, slug, name: clean, createdBy: actor.userId })
    .returning();
  if (!created) throw new MeetError("validation", "Création de la salle impossible.");

  await recordAudit({
    orgId: actor.orgId,
    actorUserId: actor.userId,
    action: "meet.room.create",
    resourceType: "room",
    resourceId: created.slug,
    result: "success",
  });

  return toRoomView(created, actor);
}

export async function listRooms(actor: Actor): Promise<RoomView[]> {
  const rows = await db()
    .select()
    .from(meetRooms)
    .where(eq(meetRooms.orgId, actor.orgId))
    .orderBy(desc(meetRooms.createdAt))
    .limit(200);
  return rows.map((row) => toRoomView(row, actor));
}

async function requireRoom(actor: Actor, slug: string) {
  const [row] = await db().select().from(meetRooms).where(eq(meetRooms.slug, slug)).limit(1);
  if (!row || row.orgId !== actor.orgId) {
    throw new MeetError("not_found", "Salle introuvable.");
  }
  return row;
}

export async function getRoom(actor: Actor, slug: string): Promise<RoomView> {
  const row = await requireRoom(actor, slug);
  return toRoomView(row, actor);
}

/** Active ou désactive la salle d'attente d'une salle (organisateur seulement). */
export async function setRoomAdmission(
  actor: Actor,
  slug: string,
  required: boolean,
): Promise<RoomView> {
  const row = await requireRoom(actor, slug);
  if (row.createdBy !== actor.userId) {
    throw new MeetError("forbidden", "Seul l'organisateur peut modifier la salle d'attente.");
  }

  // Entrée libre : les personnes déjà en attente sont admises d'office.
  if (!required) {
    await db()
      .update(meetLobby)
      .set({ state: "admitted", resolvedAt: sql`now()`, resolvedBy: actor.userId })
      .where(and(eq(meetLobby.roomId, row.id), eq(meetLobby.state, "waiting")));
  }

  const [updated] = await db()
    .update(meetRooms)
    .set({ requireAdmission: required })
    .where(eq(meetRooms.id, row.id))
    .returning();
  if (!updated) throw new MeetError("not_found", "Salle introuvable.");

  await recordAudit({
    orgId: actor.orgId,
    actorUserId: actor.userId,
    action: required ? "meet.room.admission_enable" : "meet.room.admission_disable",
    resourceType: "room",
    resourceId: row.slug,
    result: "success",
  });

  return toRoomView(updated, actor);
}

export async function deleteRoom(actor: Actor, slug: string): Promise<void> {
  const row = await requireRoom(actor, slug);
  if (row.createdBy !== actor.userId) {
    throw new MeetError("forbidden", "Seul le créateur peut supprimer cette salle.");
  }
  await db().delete(meetRooms).where(eq(meetRooms.id, row.id));

  await recordAudit({
    orgId: actor.orgId,
    actorUserId: actor.userId,
    action: "meet.room.delete",
    resourceType: "room",
    resourceId: row.slug,
    result: "success",
  });
}

/* ------------------------------------------------------------------ *
 * Salle d'attente (lobby) et admission
 * ------------------------------------------------------------------ */

async function countWaiting(roomId: string): Promise<number> {
  const [row] = await db()
    .select({ total: sql<number>`count(*)::int` })
    .from(meetLobby)
    .where(and(eq(meetLobby.roomId, roomId), eq(meetLobby.state, "waiting")));
  return row?.total ?? 0;
}

async function lobbyName(userId: string): Promise<string> {
  const [row] = await db()
    .select({ name: core.user.name })
    .from(core.user)
    .where(eq(core.user.id, userId))
    .limit(1);
  return row?.name ?? "Participant";
}

/**
 * Capacité d'entrée de l'acteur : l'organisateur et les salles sans admission
 * entrent directement, les autres attendent un accusé de réception explicite.
 */
async function lobbyStateFor(
  room: typeof meetRooms.$inferSelect,
  actor: Actor,
): Promise<LobbyStatusView> {
  const waiting = await countWaiting(room.id);
  const host = room.createdBy === actor.userId;
  if (!room.requireAdmission || host) {
    return { required: room.requireAdmission, host, state: "admitted", waiting };
  }

  const [entry] = await db()
    .select({ state: meetLobby.state })
    .from(meetLobby)
    .where(and(eq(meetLobby.roomId, room.id), eq(meetLobby.userId, actor.userId)))
    .limit(1);

  return { required: room.requireAdmission, host, state: entry?.state ?? "none", waiting };
}

export async function getLobbyStatus(actor: Actor, slug: string): Promise<LobbyStatusView> {
  const room = await requireRoom(actor, slug);
  return lobbyStateFor(room, actor);
}

function toEntryView(row: typeof meetLobby.$inferSelect, userName: string): LobbyEntryView {
  return {
    id: row.id,
    userId: row.userId,
    userName,
    requestedAt: row.requestedAt.toISOString(),
  };
}

async function requireHost(actor: Actor, room: typeof meetRooms.$inferSelect): Promise<void> {
  if (room.createdBy !== actor.userId) {
    throw new MeetError("forbidden", "Seul l'organisateur peut admettre les participants.");
  }
}

async function requireOrgMember(userId: string, orgId: string): Promise<void> {
  const [row] = await db()
    .select({ id: core.member.id })
    .from(core.member)
    .where(and(eq(core.member.organizationId, orgId), eq(core.member.userId, userId)))
    .limit(1);
  if (!row) throw new MeetError("not_found", "Participant introuvable dans cette organisation.");
}

/** Demande d'entrée : (ré)initialise la demande de l'acteur à « en attente ». */
export async function requestAdmission(actor: Actor, slug: string): Promise<LobbyStatusView> {
  const room = await requireRoom(actor, slug);
  if (!room.requireAdmission || room.createdBy === actor.userId) {
    return getLobbyStatus(actor, slug);
  }

  const [existing] = await db()
    .select({ state: meetLobby.state })
    .from(meetLobby)
    .where(and(eq(meetLobby.roomId, room.id), eq(meetLobby.userId, actor.userId)))
    .limit(1);
  if (existing?.state !== "admitted") {
    await db()
      .insert(meetLobby)
      .values({ roomId: room.id, userId: actor.userId, state: "waiting" })
      .onConflictDoUpdate({
        target: [meetLobby.roomId, meetLobby.userId],
        set: { state: "waiting", requestedAt: sql`now()`, resolvedAt: null, resolvedBy: null },
      });
  }

  await recordAudit({
    orgId: actor.orgId,
    actorUserId: actor.userId,
    action: "meet.lobby.request",
    resourceType: "room",
    resourceId: room.slug,
    result: "success",
  });

  return getLobbyStatus(actor, slug);
}

/** Personnes en attente d'admission (organisateur seulement). */
export async function listLobby(actor: Actor, slug: string): Promise<LobbyEntryView[]> {
  const room = await requireRoom(actor, slug);
  await requireHost(actor, room);

  const rows = await db()
    .select({
      id: meetLobby.id,
      userId: meetLobby.userId,
      requestedAt: meetLobby.requestedAt,
      userName: core.user.name,
    })
    .from(meetLobby)
    .innerJoin(core.user, eq(core.user.id, meetLobby.userId))
    .where(and(eq(meetLobby.roomId, room.id), eq(meetLobby.state, "waiting")))
    .orderBy(meetLobby.requestedAt)
    .limit(200);

  return rows.map((row) => ({
    id: row.id,
    userId: row.userId,
    userName: row.userName ?? "Participant",
    requestedAt: row.requestedAt.toISOString(),
  }));
}

async function resolveLobbyEntry(
  actor: Actor,
  slug: string,
  userId: string,
  state: "admitted" | "denied",
): Promise<LobbyEntryView> {
  const room = await requireRoom(actor, slug);
  await requireHost(actor, room);
  await requireOrgMember(userId, room.orgId);

  const [existing] = await db()
    .select()
    .from(meetLobby)
    .where(and(eq(meetLobby.roomId, room.id), eq(meetLobby.userId, userId)))
    .limit(1);

  const write = existing
    ? db()
        .update(meetLobby)
        .set({ state, resolvedAt: sql`now()`, resolvedBy: actor.userId })
        .where(eq(meetLobby.id, existing.id))
        .returning()
    : db()
        .insert(meetLobby)
        .values({
          roomId: room.id,
          userId,
          state,
          resolvedAt: sql`now()`,
          resolvedBy: actor.userId,
        })
        .returning();

  const [saved] = await write;
  if (!saved) throw new MeetError("validation", "Mise à jour de la salle d'attente impossible.");

  await recordAudit({
    orgId: actor.orgId,
    actorUserId: actor.userId,
    action: state === "admitted" ? "meet.lobby.admit" : "meet.lobby.deny",
    resourceType: "room",
    resourceId: room.slug,
    result: "success",
    metadata: { targetUserId: userId },
  });

  return toEntryView(saved, await lobbyName(userId));
}

export function admitParticipant(
  actor: Actor,
  slug: string,
  userId: string,
): Promise<LobbyEntryView> {
  return resolveLobbyEntry(actor, slug, userId, "admitted");
}

export function denyParticipant(
  actor: Actor,
  slug: string,
  userId: string,
): Promise<LobbyEntryView> {
  return resolveLobbyEntry(actor, slug, userId, "denied");
}

/** Retire la demande d'entrée en cours (l'acteur quitte la salle d'attente). */
export async function withdrawAdmission(actor: Actor, slug: string): Promise<void> {
  const room = await requireRoom(actor, slug);
  await db()
    .delete(meetLobby)
    .where(and(eq(meetLobby.roomId, room.id), eq(meetLobby.userId, actor.userId)));
}

/** Jeton de connexion : `configured: false` si aucun serveur média (ADR-0011). */
export async function getRoomToken(actor: Actor, slug: string): Promise<RoomToken> {
  const room = await requireRoom(actor, slug);
  const env = getServerEnv();
  if (!env.LIVEKIT_URL || !env.LIVEKIT_API_KEY || !env.LIVEKIT_API_SECRET) {
    return { configured: false };
  }
  if (room.requireAdmission && room.createdBy !== actor.userId) {
    const status = await lobbyStateFor(room, actor);
    if (status.state !== "admitted") {
      throw new MeetError(
        "forbidden",
        "L'organisateur doit vous admettre dans la salle avant que vous puissiez la rejoindre.",
      );
    }
  }

  const [user] = await db()
    .select({ name: core.user.name })
    .from(core.user)
    .where(eq(core.user.id, actor.userId))
    .limit(1);

  const token = signLiveKitToken({
    apiKey: env.LIVEKIT_API_KEY,
    apiSecret: env.LIVEKIT_API_SECRET,
    userId: actor.userId,
    userName: user?.name ?? "Participant",
    room: `workspace-${room.slug}`,
  });

  return {
    configured: true,
    url: env.LIVEKIT_URL,
    token,
    room: `workspace-${room.slug}`,
    name: room.name,
  };
}
