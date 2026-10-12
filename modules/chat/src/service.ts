import { schema as core, type Database, getDb, withTransaction } from "@workspace/database";
import type { Actor } from "@workspace/permissions";
import { and, asc, desc, eq, gt, inArray, isNull, lt, ne, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { chatChannels, chatMembers, chatMessages } from "./schema.ts";

export type ChatErrorCode = "not_found" | "forbidden" | "validation";

export class ChatError extends Error {
  readonly code: ChatErrorCode;
  constructor(code: ChatErrorCode, message: string) {
    super(message);
    this.name = "ChatError";
    this.code = code;
  }
}

export type ChannelView = {
  id: string;
  kind: "channel" | "dm";
  name: string;
  unreadCount: number;
  lastMessageAt: string | null;
};

export type MessageView = {
  id: string;
  body: string;
  createdAt: string;
  authorId: string;
  authorName: string;
  mine: boolean;
};

export type OrgMemberView = {
  id: string;
  name: string;
  email: string;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const db = () => getDb();

/** Les champs `sql` bruts reviennent en texte : normalise vers ISO 8601. */
function toIsoString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/** Violation d'unicité PostgreSQL (23505), y compris à travers DrizzleQueryError. */
function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current !== null && typeof current === "object"; depth += 1) {
    if ("code" in current && (current as { code?: unknown }).code === "23505") return true;
    current = "cause" in current ? (current as { cause?: unknown }).cause : undefined;
  }
  return false;
}

/**
 * Curseur de lecture : jamais en arrière (GREATEST) et daté par l'horloge de la
 * base (`now()`), pas par celle de l'application.
 */
function touchReadCursor(executor: Database, channelId: string, userId: string) {
  return executor
    .update(chatMembers)
    .set({
      lastReadAt: sql`greatest(coalesce(${chatMembers.lastReadAt}, to_timestamp(0)), now())`,
    })
    .where(and(eq(chatMembers.channelId, channelId), eq(chatMembers.userId, userId)));
}

async function requireMembership(
  actor: Actor,
  channelId: string,
): Promise<{ id: string; orgId: string; kind: string; name: string | null }> {
  const [channel] = await db()
    .select()
    .from(chatChannels)
    .where(eq(chatChannels.id, channelId))
    .limit(1);
  if (!channel || channel.orgId !== actor.orgId) {
    throw new ChatError("not_found", "Conversation introuvable.");
  }
  const [membership] = await db()
    .select({ id: chatMembers.id })
    .from(chatMembers)
    .where(and(eq(chatMembers.channelId, channelId), eq(chatMembers.userId, actor.userId)))
    .limit(1);
  if (!membership) {
    throw new ChatError("forbidden", "Vous ne faites pas partie de cette conversation.");
  }
  return channel;
}

function channelName(
  channel: { kind: string; name: string | null },
  other: { name: string } | null,
): string {
  if (channel.kind === "dm") {
    return other ? other.name : "Discussion";
  }
  return channel.name ?? "Canal";
}

function dmKeyFor(a: string, b: string): string {
  return [a, b].sort().join(":");
}

/**
 * Rattrapage : discussions directes créées avant `dm_key`. Balayage des canaux
 * de l'auteur (membre des deux côtés, exactement deux participants, clé nulle).
 */
async function findLegacyDm(actor: Actor, otherUserId: string): Promise<string | null> {
  const mine = alias(chatMembers, "legacy_mine");
  const theirs = alias(chatMembers, "legacy_theirs");
  const [row] = await db()
    .select({ id: chatChannels.id })
    .from(chatChannels)
    .innerJoin(mine, and(eq(mine.channelId, chatChannels.id), eq(mine.userId, actor.userId)))
    .innerJoin(theirs, and(eq(theirs.channelId, chatChannels.id), eq(theirs.userId, otherUserId)))
    .where(
      and(
        eq(chatChannels.kind, "dm"),
        eq(chatChannels.orgId, actor.orgId),
        isNull(chatChannels.dmKey),
        sql`(SELECT count(*) FROM ${chatMembers} WHERE ${chatMembers.channelId} = ${chatChannels.id}) = 2`,
      ),
    )
    .orderBy(asc(chatChannels.createdAt))
    .limit(1);
  return row?.id ?? null;
}

// ---------------------------------------------------------------------------
// Canaux et discussions
// ---------------------------------------------------------------------------

export async function createChannel(actor: Actor, name: string): Promise<{ id: string }> {
  const clean = name.trim().replace(/^#/, "");
  if (clean.length < 1 || clean.length > 80) {
    throw new ChatError("validation", "Le nom du canal doit contenir entre 1 et 80 caractères.");
  }
  // Noms dupliqués autorisés : aucune contrainte d'unicité sur `name`.
  return withTransaction(async (tx) => {
    const [channel] = await tx
      .insert(chatChannels)
      .values({ orgId: actor.orgId, kind: "channel", name: clean, createdBy: actor.userId })
      .returning({ id: chatChannels.id });
    if (!channel) throw new ChatError("validation", "Création du canal impossible.");
    await tx.insert(chatMembers).values({ channelId: channel.id, userId: actor.userId });
    return { id: channel.id };
  });
}

/** Discussion directe : retourne la conversation existante ou en crée une. */
export async function startDm(actor: Actor, otherUserId: string): Promise<{ id: string }> {
  if (otherUserId === actor.userId) {
    throw new ChatError("validation", "Impossible de démarrer une discussion avec soi-même.");
  }
  const [otherMembership] = await db()
    .select({ id: core.member.id })
    .from(core.member)
    .where(and(eq(core.member.organizationId, actor.orgId), eq(core.member.userId, otherUserId)))
    .limit(1);
  if (!otherMembership) {
    throw new ChatError("validation", "Ce membre ne fait pas partie de l'organisation.");
  }

  const dmKey = dmKeyFor(actor.userId, otherUserId);
  const [existing] = await db()
    .select({ id: chatChannels.id })
    .from(chatChannels)
    .where(eq(chatChannels.dmKey, dmKey))
    .limit(1);
  if (existing) return { id: existing.id };

  const legacyId = await findLegacyDm(actor, otherUserId);
  if (legacyId) {
    try {
      await db()
        .update(chatChannels)
        .set({ dmKey })
        .where(and(eq(chatChannels.id, legacyId), isNull(chatChannels.dmKey)));
    } catch {
      // Course bénigne : une requête concurrente a renseigné la clé.
    }
    return { id: legacyId };
  }

  try {
    return await withTransaction(async (tx) => {
      const [created] = await tx
        .insert(chatChannels)
        .values({ orgId: actor.orgId, kind: "dm", name: null, createdBy: actor.userId, dmKey })
        .returning({ id: chatChannels.id });
      if (!created) throw new ChatError("validation", "Création de la discussion impossible.");
      await tx.insert(chatMembers).values([
        { channelId: created.id, userId: actor.userId },
        { channelId: created.id, userId: otherUserId },
      ]);
      return { id: created.id };
    });
  } catch (error) {
    // Course entre deux appels : l'index unique a tranché, on relit la gagnante.
    if (isUniqueViolation(error)) {
      const [raced] = await db()
        .select({ id: chatChannels.id })
        .from(chatChannels)
        .where(eq(chatChannels.dmKey, dmKey))
        .limit(1);
      if (raced) return { id: raced.id };
    }
    throw error;
  }
}

/**
 * Conversations de l'acteur avec compteurs de non-lus — une requête agrégée
 * pour tous les canaux (dernier message et non-lus en sous-requêtes SQL), puis
 * une requête pour les noms des correspondants des discussions directes.
 */
export async function listChannels(actor: Actor): Promise<ChannelView[]> {
  const unreadCutoff = sql`greatest(coalesce(${chatMembers.lastReadAt}, to_timestamp(0)), ${chatMembers.createdAt})`;
  const rows = await db()
    .select({
      id: chatChannels.id,
      kind: chatChannels.kind,
      name: chatChannels.name,
      lastMessageAt: sql<string | Date | null>`(
        SELECT max(${chatMessages.createdAt})
        FROM ${chatMessages}
        WHERE ${chatMessages.channelId} = ${chatChannels.id}
      )`,
      unreadCount: sql<number>`(
        SELECT count(*)
        FROM ${chatMessages}
        WHERE ${chatMessages.channelId} = ${chatChannels.id}
          AND ${chatMessages.authorId} <> ${actor.userId}
          AND ${chatMessages.createdAt} > ${unreadCutoff}
      )`.mapWith(Number),
    })
    .from(chatChannels)
    .innerJoin(
      chatMembers,
      and(eq(chatMembers.channelId, chatChannels.id), eq(chatMembers.userId, actor.userId)),
    )
    .where(eq(chatChannels.orgId, actor.orgId));

  const dmIds = rows.filter((row) => row.kind === "dm").map((row) => row.id);
  const counterpartNames = new Map<string, string>();
  if (dmIds.length > 0) {
    const counterparts = await db()
      .select({ channelId: chatMembers.channelId, name: core.user.name })
      .from(chatMembers)
      .innerJoin(core.user, eq(core.user.id, chatMembers.userId))
      .where(and(inArray(chatMembers.channelId, dmIds), ne(chatMembers.userId, actor.userId)));
    for (const counterpart of counterparts) {
      if (!counterpartNames.has(counterpart.channelId)) {
        counterpartNames.set(counterpart.channelId, counterpart.name);
      }
    }
  }

  const views: ChannelView[] = rows.map((row) => {
    const isDm = row.kind === "dm";
    const other = isDm ? { name: counterpartNames.get(row.id) ?? "Discussion" } : null;
    return {
      id: row.id,
      kind: isDm ? "dm" : "channel",
      name: channelName(row, other),
      unreadCount: row.unreadCount,
      lastMessageAt: toIsoString(row.lastMessageAt),
    };
  });

  return views.sort((a, b) => {
    if (a.lastMessageAt && b.lastMessageAt) return a.lastMessageAt < b.lastMessageAt ? 1 : -1;
    if (a.lastMessageAt) return -1;
    if (b.lastMessageAt) return 1;
    return a.name.localeCompare(b.name, "fr");
  });
}

export async function listOrgMembers(actor: Actor): Promise<OrgMemberView[]> {
  return db()
    .select({ id: core.user.id, name: core.user.name, email: core.user.email })
    .from(core.user)
    .innerJoin(
      core.member,
      and(eq(core.member.userId, core.user.id), eq(core.member.organizationId, actor.orgId)),
    )
    .where(ne(core.user.id, actor.userId))
    .orderBy(asc(core.user.name))
    .limit(200);
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

/**
 * Messages d'un canal. Deux sens de pagination :
 * - `before`/`beforeId` remonte l'historique (les plus récents d'abord, retournés
 *   en ordre croissant), plafonné à 100 ;
 * - `since`/`sinceId` (flux temps réel) renvoie les plus **anciens** messages
 *   postérieurs au curseur `(created_at, id)`, plafonné à 200. `since` a la
 *   priorité sur `before` si les deux sont fournis.
 * Le départage par identifiant tranche les ex æquo (même microseconde). Le
 * curseur ISO étant à la milliseconde, un message de la même milliseconde que
 * le curseur peut être rediffusé (au pire une fois) : jamais de saut, le client
 * déduplique par identifiant.
 */
export async function listMessages(
  actor: Actor,
  channelId: string,
  input: {
    before?: string;
    beforeId?: string;
    since?: string;
    sinceId?: string;
    limit?: number;
  } = {},
): Promise<MessageView[]> {
  await requireMembership(actor, channelId);

  let before: Date | null = null;
  if (input.before !== undefined) {
    before = new Date(input.before);
    if (Number.isNaN(before.getTime())) {
      throw new ChatError("validation", "Paramètre « before » invalide.");
    }
  }
  let since: Date | null = null;
  if (input.since !== undefined) {
    since = new Date(input.since);
    if (Number.isNaN(since.getTime())) {
      throw new ChatError("validation", "Paramètre « since » invalide.");
    }
  }
  if (input.beforeId !== undefined && !UUID_PATTERN.test(input.beforeId)) {
    throw new ChatError("validation", "Paramètre « beforeId » invalide.");
  }
  if (input.sinceId !== undefined && !UUID_PATTERN.test(input.sinceId)) {
    throw new ChatError("validation", "Paramètre « sinceId » invalide.");
  }

  const limit = Math.max(1, Math.min(input.limit ?? 50, since ? 200 : 100));

  const conditions = [eq(chatMessages.channelId, channelId)];
  if (since) {
    // Flux temps réel : on part du curseur vers l'avant, en gardant les plus
    // anciens nouveaux messages (le tri croissant précède la limite).
    if (input.sinceId) {
      conditions.push(
        sql`(${chatMessages.createdAt}, ${chatMessages.id}) > (${since.toISOString()}::timestamptz, ${input.sinceId}::uuid)`,
      );
    } else {
      // Compatibilité : sans sinceId, curseur temporel seul (les messages à la
      // même microseconde que le curseur sont ignorés).
      conditions.push(gt(chatMessages.createdAt, since));
    }
  } else if (before && input.beforeId) {
    // Départage d'égalité : (created_at, id) < (curseur, curseur) — même ordre
    // décroissant que le tri, sans quoi des messages à la milliseconde près
    // pouvaient être sautés ou répétés.
    conditions.push(
      sql`(${chatMessages.createdAt}, ${chatMessages.id}) < (${before.toISOString()}::timestamptz, ${input.beforeId}::uuid)`,
    );
  } else if (before) {
    // Compatibilité : sans beforeId, on retombe sur le curseur temporel seul.
    conditions.push(lt(chatMessages.createdAt, before));
  }

  const query = db()
    .select({
      id: chatMessages.id,
      body: chatMessages.body,
      createdAt: chatMessages.createdAt,
      authorId: chatMessages.authorId,
      authorName: core.user.name,
    })
    .from(chatMessages)
    .innerJoin(core.user, eq(core.user.id, chatMessages.authorId))
    .where(and(...conditions));

  // Le tri croissant (`since`) rend déjà la page dans l'ordre d'affichage ; le
  // tri décroissant (`before`) doit être inversé pour repartir du plus ancien.
  const rows = since
    ? await query.orderBy(asc(chatMessages.createdAt), asc(chatMessages.id)).limit(limit)
    : (
        await query.orderBy(desc(chatMessages.createdAt), desc(chatMessages.id)).limit(limit)
      ).reverse();

  return rows.map((row) => ({
    id: row.id,
    body: row.body,
    createdAt: row.createdAt.toISOString(),
    authorId: row.authorId,
    authorName: row.authorName,
    mine: row.authorId === actor.userId,
  }));
}

export async function sendMessage(
  actor: Actor,
  channelId: string,
  body: string,
): Promise<MessageView> {
  await requireMembership(actor, channelId);
  const clean = body.trim();
  if (clean.length < 1 || clean.length > 4000) {
    throw new ChatError("validation", "Le message doit contenir entre 1 et 4000 caractères.");
  }

  const created = await withTransaction(async (tx) => {
    const [message] = await tx
      .insert(chatMessages)
      .values({ channelId, authorId: actor.userId, body: clean })
      .returning();
    if (!message) throw new ChatError("validation", "Envoi impossible.");
    await touchReadCursor(tx, channelId, actor.userId);
    return message;
  });

  const [author] = await db()
    .select({ name: core.user.name })
    .from(core.user)
    .where(eq(core.user.id, actor.userId))
    .limit(1);

  return {
    id: created.id,
    body: created.body,
    createdAt: created.createdAt.toISOString(),
    authorId: actor.userId,
    authorName: author?.name ?? "",
    mine: true,
  };
}

export async function markRead(actor: Actor, channelId: string): Promise<void> {
  await requireMembership(actor, channelId);
  await touchReadCursor(db(), channelId, actor.userId);
}
