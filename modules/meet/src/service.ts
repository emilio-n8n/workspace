import { createHmac, randomBytes } from "node:crypto";
import { recordAudit } from "@workspace/audit";
import { getServerEnv } from "@workspace/config";
import { schema as core, getDb } from "@workspace/database";
import type { Actor } from "@workspace/permissions";
import { desc, eq } from "drizzle-orm";
import { meetRooms } from "./schema.ts";

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
};

export type RoomToken =
  | { configured: false }
  | { configured: true; url: string; token: string; room: string; name: string };

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

  return {
    slug: created.slug,
    name: created.name,
    createdBy: created.createdBy,
    createdAt: created.createdAt.toISOString(),
    mine: created.createdBy === actor.userId,
  };
}

export async function listRooms(actor: Actor): Promise<RoomView[]> {
  const rows = await db()
    .select()
    .from(meetRooms)
    .where(eq(meetRooms.orgId, actor.orgId))
    .orderBy(desc(meetRooms.createdAt))
    .limit(200);
  return rows.map((row) => ({
    slug: row.slug,
    name: row.name,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    mine: row.createdBy === actor.userId,
  }));
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
  return {
    slug: row.slug,
    name: row.name,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    mine: row.createdBy === actor.userId,
  };
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

/** Jeton de connexion : `configured: false` si aucun serveur média (ADR-0011). */
export async function getRoomToken(actor: Actor, slug: string): Promise<RoomToken> {
  const room = await requireRoom(actor, slug);
  const env = getServerEnv();
  if (!env.LIVEKIT_URL || !env.LIVEKIT_API_KEY || !env.LIVEKIT_API_SECRET) {
    return { configured: false };
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
