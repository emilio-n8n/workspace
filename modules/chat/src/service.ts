import { randomUUID } from "node:crypto";
import { recordAudit } from "@workspace/audit";
import { schema as core, type Database, getDb, sortFr, withTransaction } from "@workspace/database";
import type { Actor } from "@workspace/permissions";
import { getStorage } from "@workspace/storage";
import { and, asc, desc, eq, gt, inArray, isNull, lt, ne, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import {
  CHANNEL_VISIBILITIES,
  type ChannelVisibility,
  type ChatChannelRow,
  chatAttachments,
  chatChannels,
  chatMembers,
  chatMessages,
  chatPins,
} from "./schema.ts";
import { activeTypingSignals, publishTyping, stopTyping, type TypingUser } from "./typing.ts";

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
  /** `public` (rejoignable) ou `private` (sur invitation) — toujours privé pour une discussion. */
  visibility: ChannelVisibility;
  /** Canal archivé : lisible, plus aucune écriture possible. */
  archived: boolean;
  /** Nombre de membres, créateur compris. */
  memberCount: number;
  /** Vrai si l'acteur a créé le canal (seul habilité à l'archiver et à y inviter). */
  managedByMe: boolean;
};

/** Membre d'un canal — la liste est visible par les membres, y compris privés. */
export type ChannelMemberView = {
  id: string;
  name: string;
  email: string;
  /** Vrai pour la personne qui a créé le canal. */
  creator: boolean;
};

/** Canal public de l'organisation que l'acteur peut rejoindre librement. */
export type JoinableChannelView = {
  id: string;
  name: string;
  memberCount: number;
  lastMessageAt: string | null;
};

/**
 * Frontière des non-lus : `cutoff` est le curseur effectif (dernier message lu,
 * jamais antérieur à l'adhésion) — tout message d'autrui postérieur est
 * « nouveau ». `unreadCount` est le compteur affiché dans la barre latérale,
 * calculé exactement sur la même borne.
 */
export type UnreadState = {
  cutoff: string | null;
  unreadCount: number;
};

/** Message épinglé, avec son auteur et la personne qui l'a épinglé. */
export type PinView = {
  id: string;
  messageId: string;
  body: string;
  createdAt: string;
  pinnedAt: string;
  authorId: string;
  authorName: string;
  pinnedByName: string;
  mine: boolean;
  attachments: AttachmentMeta[];
};

export type MessageView = {
  id: string;
  body: string;
  createdAt: string;
  authorId: string;
  authorName: string;
  mine: boolean;
  /** Métadonnées des pièces jointes — le binaire se télécharge via la route dédiée. */
  attachments: AttachmentMeta[];
};

export type OrgMemberView = {
  id: string;
  name: string;
  email: string;
};

/** Bornes des pièces jointes : 5 fichiers de 10 Mio au maximum. */
export const MAX_ATTACHMENTS = 5;
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const MAX_ATTACHMENT_FILENAME_LENGTH = 255;
const MAX_CONTENT_TYPE_LENGTH = 200;

/** Métadonnées d'une pièce jointe exposées à l'UI (jamais la clé de stockage). */
export type AttachmentMeta = {
  id: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
};

/** Jeton provisoire renvoyé par `uploadChatAttachment` puis transmis à `sendMessage`. */
export type AttachmentToken = {
  storageKey: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
};

export type AttachmentDownload = {
  filename: string;
  contentType: string;
  body: Buffer;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Garde-fou d'entrée : un identifiant mal formé doit devenir une erreur de
 * validation française, jamais une erreur SQL 22P02 remontée en 500.
 */
function assertUuid(value: unknown, label: string): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new ChatError("validation", `Identifiant « ${label} » invalide.`);
  }
  return value;
}

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

async function requireMembership(actor: Actor, channelId: string): Promise<ChatChannelRow> {
  assertUuid(channelId, "channelId");
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
  // Un canal privé n'existe tout simplement pas pour un non-membre : le refus
  // est indistinguable d'une Conversation inconnue.
  if (!membership) {
    throw new ChatError("forbidden", "Vous ne faites pas partie de cette conversation.");
  }
  return channel;
}

/**
 * Gestion du canal : réservée à la personne qui l'a créé (archivage,
 * invitations). Les lectures, envois et épingles restent ouvertes à tous les
 * membres — un `Actor` ne porte pas de rôle d'organisation.
 */
async function requireChannelManager(actor: Actor, channelId: string): Promise<ChatChannelRow> {
  const channel = await requireMembership(actor, channelId);
  if (channel.createdBy !== actor.userId) {
    throw new ChatError(
      "forbidden",
      "Seule la personne qui a créé le canal peut gérer ses membres et son archivage.",
    );
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

export async function createChannel(
  actor: Actor,
  name: string,
  visibility: ChannelVisibility = "public",
): Promise<{ id: string }> {
  const clean = name.trim().replace(/^#/, "");
  if (clean.length < 1 || clean.length > 80) {
    throw new ChatError("validation", "Le nom du canal doit contenir entre 1 et 80 caractères.");
  }
  if (!CHANNEL_VISIBILITIES.includes(visibility)) {
    throw new ChatError("validation", "Visibilité du canal inconnue.");
  }
  // Noms dupliqués autorisés : aucune contrainte d'unicité sur `name`.
  const channel = await withTransaction(async (tx) => {
    const [row] = await tx
      .insert(chatChannels)
      .values({
        orgId: actor.orgId,
        kind: "channel",
        name: clean,
        visibility,
        createdBy: actor.userId,
      })
      .returning({ id: chatChannels.id });
    if (!row) throw new ChatError("validation", "Création du canal impossible.");
    await tx.insert(chatMembers).values({ channelId: row.id, userId: actor.userId });
    return { id: row.id };
  });

  await recordAudit({
    orgId: actor.orgId,
    actorUserId: actor.userId,
    action: "chat.channel.create",
    resourceType: "channel",
    resourceId: channel.id,
    result: "success",
    // Une création publique reste sans métadonnée ; une création privée porte la
    // visibilité, fait marquant pour l'organisation.
    metadata: visibility === "private" ? { visibility: "private" } : null,
  });

  return channel;
}

/**
 * Archive un canal : l'historique reste lisible par les membres, mais plus aucun
 * message ni épingle ne peut y être ajouté. Idempotent (archiver deux fois ne
 * journalise qu'une fois) et réservé à la personne qui a créé le canal.
 */
export async function archiveChannel(actor: Actor, channelId: string): Promise<void> {
  const channel = await requireChannelManager(actor, channelId);
  if (channel.kind !== "channel") {
    throw new ChatError("validation", "Une discussion directe ne peut pas être archivée.");
  }
  if (channel.archivedAt) return;
  // Horloge de la base, comme partout ailleurs dans le module.
  await db()
    .update(chatChannels)
    .set({ archivedAt: sql`now()` })
    .where(eq(chatChannels.id, channelId));
  await recordAudit({
    orgId: actor.orgId,
    actorUserId: actor.userId,
    action: "chat.channel.archive",
    resourceType: "channel",
    resourceId: channelId,
    result: "success",
  });
}

/** Désarchive un canal — mêmes droits que l'archivage. */
export async function restoreChannel(actor: Actor, channelId: string): Promise<void> {
  const channel = await requireChannelManager(actor, channelId);
  if (!channel.archivedAt) return;
  await db().update(chatChannels).set({ archivedAt: null }).where(eq(chatChannels.id, channelId));
  await recordAudit({
    orgId: actor.orgId,
    actorUserId: actor.userId,
    action: "chat.channel.restore",
    resourceType: "channel",
    resourceId: channelId,
    result: "success",
  });
}

/**
 * Membres d'un canal — visible par les membres, y compris pour un canal privé
 * (c'est tout l'intérêt de la liste : savoir avec qui l'on parle).
 */
export async function listChannelMembers(
  actor: Actor,
  channelId: string,
): Promise<ChannelMemberView[]> {
  await requireMembership(actor, channelId);
  const rows = await db()
    .select({
      id: core.user.id,
      name: core.user.name,
      email: core.user.email,
      creator: chatChannels.createdBy,
    })
    .from(chatMembers)
    .innerJoin(core.user, eq(core.user.id, chatMembers.userId))
    .innerJoin(chatChannels, eq(chatChannels.id, chatMembers.channelId))
    .where(eq(chatMembers.channelId, channelId))
    .orderBy(asc(core.user.name));
  return sortFr(rows, (row) => row.name).map((row) => ({
    id: row.id,
    name: row.name,
    email: row.email,
    creator: row.creator === row.id,
  }));
}

/** Vrai si la cible appartient à l'organisation de l'acteur. */
async function isOrgMember(actor: Actor, userId: string): Promise<boolean> {
  const [row] = await db()
    .select({ id: core.member.id })
    .from(core.member)
    .where(and(eq(core.member.organizationId, actor.orgId), eq(core.member.userId, userId)))
    .limit(1);
  return Boolean(row);
}

/**
 * Ajoute un membre de l'organisation à un canal (invitation directe) — seul
 * moyen d'entrer dans un canal privé. Réservé à la personne qui a créé le canal,
 * idempotent : un membre déjà présent ne déclenche ni écriture ni audit.
 */
export async function addChannelMember(
  actor: Actor,
  channelId: string,
  userId: string,
): Promise<{ added: boolean }> {
  const channel = await requireChannelManager(actor, channelId);
  if (channel.kind !== "channel") {
    throw new ChatError("validation", "Une discussion directe ne peut pas inviter de membre.");
  }
  if (channel.archivedAt) {
    throw new ChatError("forbidden", "Ce canal est archivé : il n'accepte plus de nouveau membre.");
  }
  if (userId === actor.userId) {
    throw new ChatError("validation", "Vous faites déjà partie de ce canal.");
  }
  if (!(await isOrgMember(actor, userId))) {
    throw new ChatError("validation", "Ce membre ne fait pas partie de l'organisation.");
  }
  const [existing] = await db()
    .select({ id: chatMembers.id })
    .from(chatMembers)
    .where(and(eq(chatMembers.channelId, channelId), eq(chatMembers.userId, userId)))
    .limit(1);
  if (existing) return { added: false };

  await db().insert(chatMembers).values({ channelId, userId });
  await recordAudit({
    orgId: actor.orgId,
    actorUserId: actor.userId,
    action: "chat.channel.member.add",
    resourceType: "channel",
    resourceId: channelId,
    result: "success",
    metadata: { userId },
  });
  return { added: true };
}

/**
 * Rejoindre un canal public de son organisation. Un canal privé exige une
 * invitation (voir `addChannelMember`) ; le refus le dit explicitement pour ne
 * pas laisser croire à un canal inexistant.
 */
export async function joinChannel(actor: Actor, channelId: string): Promise<{ joined: boolean }> {
  assertUuid(channelId, "channelId");
  const [channel] = await db()
    .select()
    .from(chatChannels)
    .where(and(eq(chatChannels.id, channelId), eq(chatChannels.orgId, actor.orgId)))
    .limit(1);
  if (!channel) throw new ChatError("not_found", "Canal introuvable.");
  if (channel.kind !== "channel") {
    throw new ChatError("validation", "Une discussion directe ne se rejoint pas.");
  }
  if (channel.visibility !== "public") {
    throw new ChatError(
      "forbidden",
      "Canal privé : demandez à une personne du canal de vous y ajouter.",
    );
  }
  if (channel.archivedAt) {
    throw new ChatError("forbidden", "Ce canal est archivé : il n'accepte plus de membre.");
  }
  const [existing] = await db()
    .select({ id: chatMembers.id })
    .from(chatMembers)
    .where(and(eq(chatMembers.channelId, channelId), eq(chatMembers.userId, actor.userId)))
    .limit(1);
  if (existing) return { joined: false };

  await db().insert(chatMembers).values({ channelId, userId: actor.userId });
  await recordAudit({
    orgId: actor.orgId,
    actorUserId: actor.userId,
    action: "chat.channel.join",
    resourceType: "channel",
    resourceId: channelId,
    result: "success",
  });
  return { joined: true };
}

/**
 * Canaux publics de l'organisation que l'acteur ne rejoint pas encore — la
 * « découverte ». Les canaux privés n'apparaissent jamais ici.
 */
export async function listJoinableChannels(actor: Actor): Promise<JoinableChannelView[]> {
  // Jointure externe + regroupement : l'effectif vient de l'agrégat, pas d'une
  // sous-requête corrélée dans la liste de sélection.
  const rows = await db()
    .select({
      id: chatChannels.id,
      name: chatChannels.name,
      lastMessageAt: sql<string | Date | null>`(
        SELECT max(${chatMessages.createdAt})
        FROM ${chatMessages}
        WHERE ${chatMessages.channelId} = ${chatChannels.id}
      )`,
      memberCount: sql<number>`count(distinct ${chatMembers.userId})`.mapWith(Number),
    })
    .from(chatChannels)
    .leftJoin(chatMembers, eq(chatMembers.channelId, chatChannels.id))
    .where(
      and(
        eq(chatChannels.orgId, actor.orgId),
        eq(chatChannels.kind, "channel"),
        eq(chatChannels.visibility, "public"),
        isNull(chatChannels.archivedAt),
        sql`NOT EXISTS (
          SELECT 1 FROM ${chatMembers}
          WHERE ${chatMembers.channelId} = ${chatChannels.id}
            AND ${chatMembers.userId} = ${actor.userId}
        )`,
      ),
    )
    .groupBy(chatChannels.id)
    .limit(50);

  const views = rows.map((row) => ({
    id: row.id,
    name: row.name ?? "Canal",
    memberCount: row.memberCount,
    lastMessageAt: toIsoString(row.lastMessageAt),
  }));
  return views.sort((a, b) => {
    if (a.lastMessageAt && b.lastMessageAt) return a.lastMessageAt < b.lastMessageAt ? 1 : -1;
    if (a.lastMessageAt) return -1;
    if (b.lastMessageAt) return 1;
    return a.name.localeCompare(b.name, "fr");
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
  // Déjà démarrée : aucune mutation, aucun événement d'audit (l'UI appelle
  // `startDm` à chaque ouverture d'une discussion).
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
    await recordAudit({
      orgId: actor.orgId,
      actorUserId: actor.userId,
      action: "chat.dm.start",
      resourceType: "dm",
      resourceId: legacyId,
      result: "success",
    });
    return { id: legacyId };
  }

  try {
    const created = await withTransaction(async (tx) => {
      const [dm] = await tx
        .insert(chatChannels)
        .values({ orgId: actor.orgId, kind: "dm", name: null, createdBy: actor.userId, dmKey })
        .returning({ id: chatChannels.id });
      if (!dm) throw new ChatError("validation", "Création de la discussion impossible.");
      await tx.insert(chatMembers).values([
        { channelId: dm.id, userId: actor.userId },
        { channelId: dm.id, userId: otherUserId },
      ]);
      return { id: dm.id };
    });

    await recordAudit({
      orgId: actor.orgId,
      actorUserId: actor.userId,
      action: "chat.dm.start",
      resourceType: "dm",
      resourceId: created.id,
      result: "success",
    });

    return created;
  } catch (error) {
    // Course entre deux appels : l'index unique a tranché, on relit la gagnante.
    // L'appel gagnant a déjà journalisé la création, pas celui-ci.
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
 * une requête pour les noms des correspondants des discussions directes et une
 * pour les effectifs. Les canaux archivés sont inclus (la barre latérale les
 * range à part) mais triés en dernier.
 */
export async function listChannels(actor: Actor): Promise<ChannelView[]> {
  const unreadCutoff = sql`greatest(coalesce(${chatMembers.lastReadAt}, to_timestamp(0)), ${chatMembers.createdAt})`;
  const rows = await db()
    .select({
      id: chatChannels.id,
      kind: chatChannels.kind,
      name: chatChannels.name,
      visibility: chatChannels.visibility,
      archivedAt: chatChannels.archivedAt,
      createdBy: chatChannels.createdBy,
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

  const memberCounts = new Map<string, number>();
  if (rows.length > 0) {
    const counts = await db()
      .select({ channelId: chatMembers.channelId, total: sql<number>`count(*)`.mapWith(Number) })
      .from(chatMembers)
      .where(
        inArray(
          chatMembers.channelId,
          rows.map((row) => row.id),
        ),
      )
      .groupBy(chatMembers.channelId);
    for (const row of counts) memberCounts.set(row.channelId, row.total);
  }

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
      visibility: isDm || row.visibility === "private" ? "private" : "public",
      archived: row.archivedAt !== null,
      memberCount: memberCounts.get(row.id) ?? 1,
      managedByMe: row.createdBy === actor.userId,
    };
  });

  return views.sort((a, b) => {
    // Les canaux archivés passent toujours en dernier.
    if (a.archived !== b.archived) return a.archived ? 1 : -1;
    if (a.lastMessageAt && b.lastMessageAt) return a.lastMessageAt < b.lastMessageAt ? 1 : -1;
    if (a.lastMessageAt) return -1;
    if (b.lastMessageAt) return 1;
    return a.name.localeCompare(b.name, "fr");
  });
}

/**
 * Frontière des non-lus pour une conversation : le curseur effectif (`cutoff`)
 * et le nombre de messages d'autrui postérieurs. Le curseur est exactement
 * celui du compteur de la barre latérale (`GREATEST(last_read_at, adhésion)`),
 * pour que le séparateur tombe au même endroit que ce que compte la pastille.
 */
export async function getUnreadState(actor: Actor, channelId: string): Promise<UnreadState> {
  await requireMembership(actor, channelId);
  const [membership] = await db()
    .select({ lastReadAt: chatMembers.lastReadAt, joinedAt: chatMembers.createdAt })
    .from(chatMembers)
    .where(and(eq(chatMembers.channelId, channelId), eq(chatMembers.userId, actor.userId)))
    .limit(1);
  if (!membership) throw new ChatError("not_found", "Conversation introuvable.");

  // Le curseur ne recule jamais sous la date d'adhésion : l'historique ancien
  // n'est pas « non lu ». Aucune horloge applicative n'intervient — la borne
  // vient de la base, comme les comparaisons qui suivent.
  const joinedAt = toIsoString(membership.joinedAt) ?? new Date(0).toISOString();
  const lastRead = toIsoString(membership.lastReadAt);
  const cutoff = lastRead !== null && lastRead > joinedAt ? new Date(lastRead) : new Date(joinedAt);

  const [row] = await db()
    .select({ total: sql<number>`count(*)`.mapWith(Number) })
    .from(chatMessages)
    .where(
      and(
        eq(chatMessages.channelId, channelId),
        ne(chatMessages.authorId, actor.userId),
        gt(chatMessages.createdAt, cutoff),
      ),
    );
  return { cutoff: cutoff.toISOString(), unreadCount: row?.total ?? 0 };
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
// Pièces jointes — validation commune (upload, envoi, lecture)
// ---------------------------------------------------------------------------

function assertAttachmentFilename(value: unknown): string {
  if (typeof value !== "string") {
    throw new ChatError("validation", "Nom de fichier invalide.");
  }
  const filename = value.trim();
  if (filename.length === 0 || filename.length > MAX_ATTACHMENT_FILENAME_LENGTH) {
    throw new ChatError(
      "validation",
      `Nom de fichier invalide (1 à ${MAX_ATTACHMENT_FILENAME_LENGTH} caractères).`,
    );
  }
  if (/[/\\]/.test(filename) || filename.includes("\0")) {
    throw new ChatError(
      "validation",
      "Le nom du fichier ne peut pas contenir de séparateur de chemin.",
    );
  }
  return filename;
}

function assertContentType(value: unknown): string {
  if (typeof value !== "string") {
    throw new ChatError("validation", "Type de contenu invalide.");
  }
  const contentType = value.trim();
  if (contentType.length === 0 || contentType.length > MAX_CONTENT_TYPE_LENGTH) {
    throw new ChatError(
      "validation",
      `Type de contenu invalide (1 à ${MAX_CONTENT_TYPE_LENGTH} caractères).`,
    );
  }
  return contentType;
}

/**
 * Valide les jetons d'upload avant rattachement : bornés à 5, chacun préfixé
 * par `chat/<orgId>/` — un jeton d'une autre organisation ne passe jamais.
 */
function assertAttachmentTokens(actor: Actor, attachments: AttachmentToken[]): AttachmentToken[] {
  if (attachments.length > MAX_ATTACHMENTS) {
    throw new ChatError("validation", `${MAX_ATTACHMENTS} pièces jointes au maximum.`);
  }
  const prefix = `chat/${actor.orgId}/`;
  return attachments.map((attachment) => {
    if (!attachment.storageKey.startsWith(prefix)) {
      throw new ChatError("validation", "Clé de pièce jointe invalide.");
    }
    if (
      !Number.isInteger(attachment.sizeBytes) ||
      attachment.sizeBytes < 0 ||
      attachment.sizeBytes > MAX_ATTACHMENT_BYTES
    ) {
      throw new ChatError("validation", "Taille de pièce jointe invalide.");
    }
    return {
      storageKey: attachment.storageKey,
      filename: assertAttachmentFilename(attachment.filename),
      contentType: assertContentType(attachment.contentType),
      sizeBytes: attachment.sizeBytes,
    };
  });
}

/** Métadonnées des pièces jointes de plusieurs messages (une seule requête). */
async function attachmentsByMessage(messageIds: string[]): Promise<Map<string, AttachmentMeta[]>> {
  const result = new Map<string, AttachmentMeta[]>();
  if (messageIds.length === 0) return result;
  const rows = await db()
    .select()
    .from(chatAttachments)
    .where(inArray(chatAttachments.messageId, messageIds))
    .orderBy(asc(chatAttachments.createdAt), asc(chatAttachments.id));
  for (const row of rows) {
    const list = result.get(row.messageId) ?? [];
    list.push({
      id: row.id,
      filename: row.filename,
      contentType: row.contentType,
      sizeBytes: row.sizeBytes,
    });
    result.set(row.messageId, list);
  }
  return result;
}

/**
 * Téléverse une pièce jointe et renvoie un jeton provisoire (non encore lié à
 * un message) : `sendMessage` le rattache au message envoyé. Les métadonnées
 * (nom, type, taille) sont portées par le jeton ; le binaire vit dans le
 * stockage sous `chat/<orgId>/<uuid>`.
 */
export async function uploadChatAttachment(
  actor: Actor,
  input: { filename: string; contentType: string; body: Buffer },
): Promise<AttachmentToken> {
  const filename = assertAttachmentFilename(input.filename);
  const contentType = assertContentType(input.contentType);
  if (input.body.length > MAX_ATTACHMENT_BYTES) {
    throw new ChatError(
      "validation",
      `Pièce jointe trop volumineuse (${MAX_ATTACHMENT_BYTES / (1024 * 1024)} Mo maximum).`,
    );
  }
  const storageKey = `chat/${actor.orgId}/${randomUUID()}`;
  await getStorage().put({ key: storageKey, body: input.body, contentType });
  return { storageKey, filename, contentType, sizeBytes: input.body.length };
}

/** Pièce jointe d'un message d'un canal dont l'acteur est membre — jamais celle d'un autre. */
async function requireReadableAttachment(actor: Actor, attachmentId: string) {
  const [row] = await db()
    .select({ attachment: chatAttachments })
    .from(chatAttachments)
    .innerJoin(chatMessages, eq(chatMessages.id, chatAttachments.messageId))
    .innerJoin(chatChannels, eq(chatChannels.id, chatMessages.channelId))
    .innerJoin(
      chatMembers,
      and(eq(chatMembers.channelId, chatMessages.channelId), eq(chatMembers.userId, actor.userId)),
    )
    .where(and(eq(chatAttachments.id, attachmentId), eq(chatChannels.orgId, actor.orgId)))
    .limit(1);
  if (!row) throw new ChatError("not_found", "Pièce jointe introuvable.");
  return row.attachment;
}

/** Téléchargement d'une pièce jointe — réservé aux membres du canal du message. */
export async function getAttachment(
  actor: Actor,
  attachmentId: string,
): Promise<AttachmentDownload> {
  const attachment = await requireReadableAttachment(actor, attachmentId);
  const body = await getStorage().get(attachment.storageKey);
  if (!body) throw new ChatError("not_found", "Pièce jointe introuvable.");
  return { filename: attachment.filename, contentType: attachment.contentType, body };
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

  // Pièces jointes en une seule requête pour toute la page (pas de N+1).
  const attachments = await attachmentsByMessage(rows.map((row) => row.id));

  return rows.map((row) => ({
    id: row.id,
    body: row.body,
    createdAt: row.createdAt.toISOString(),
    authorId: row.authorId,
    authorName: row.authorName,
    mine: row.authorId === actor.userId,
    attachments: attachments.get(row.id) ?? [],
  }));
}

/**
 * Envoi d'un message — volontairement NON audité en général : le volume d'un
 * fil noierait le journal. Exception notable et à faible volume : un envoi
 * porteur de pièces jointes émet `chat.attachment.send` (une ligne par envoi,
 * avec le nombre de fichiers) — les messages sans pièce jointe restent muets.
 */
export async function sendMessage(
  actor: Actor,
  channelId: string,
  body: string,
  attachments: AttachmentToken[] = [],
): Promise<MessageView> {
  const channel = await requireMembership(actor, channelId);
  if (channel.archivedAt) {
    throw new ChatError(
      "forbidden",
      "Ce canal est archivé : l'envoi de messages est désactivé. Son historique reste consultable.",
    );
  }
  const clean = body.trim();
  if (clean.length < 1 || clean.length > 4000) {
    throw new ChatError("validation", "Le message doit contenir entre 1 et 4000 caractères.");
  }
  const tokens = assertAttachmentTokens(actor, attachments);

  const { created, attached } = await withTransaction(async (tx) => {
    const [message] = await tx
      .insert(chatMessages)
      .values({ channelId, authorId: actor.userId, body: clean })
      .returning();
    if (!message) throw new ChatError("validation", "Envoi impossible.");
    // Les pièces jointes sont rattachées dans la même transaction que le
    // message : pas de message sans ses fichiers, pas de fichiers orphelins.
    const rows =
      tokens.length > 0
        ? await tx
            .insert(chatAttachments)
            .values(
              tokens.map((attachment) => ({
                messageId: message.id,
                storageKey: attachment.storageKey,
                filename: attachment.filename,
                contentType: attachment.contentType,
                sizeBytes: attachment.sizeBytes,
              })),
            )
            .returning({
              id: chatAttachments.id,
              filename: chatAttachments.filename,
              contentType: chatAttachments.contentType,
              sizeBytes: chatAttachments.sizeBytes,
            })
        : [];
    await touchReadCursor(tx, channelId, actor.userId);
    return { created: message, attached: rows };
  });

  if (tokens.length > 0) {
    await recordAudit({
      orgId: actor.orgId,
      actorUserId: actor.userId,
      action: "chat.attachment.send",
      resourceType: "message",
      resourceId: created.id,
      result: "success",
      metadata: { count: attached.length },
    });
  }

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
    attachments: attached,
  };
}

/**
 * Modification en place d'un message par son auteur : le corps est remplacé,
 * les pièces jointes restent attachées. Un canal archivé reste en lecture
 * seule, et le message d'autrui n'est jamais modifiable. Pas d'audit : même
 * volume qu'un envoi, le journal se noierait.
 */
export async function editMessage(
  actor: Actor,
  channelId: string,
  messageId: string,
  body: string,
): Promise<MessageView> {
  const channel = await requireMembership(actor, channelId);
  if (channel.archivedAt) {
    throw new ChatError(
      "forbidden",
      "Ce canal est archivé : la modification de messages est désactivée.",
    );
  }
  assertUuid(messageId, "messageId");
  const clean = body.trim();
  if (clean.length < 1 || clean.length > 4000) {
    throw new ChatError("validation", "Le message doit contenir entre 1 et 4000 caractères.");
  }

  const [existing] = await db()
    .select({ authorId: chatMessages.authorId, authorName: core.user.name })
    .from(chatMessages)
    .innerJoin(core.user, eq(core.user.id, chatMessages.authorId))
    .where(and(eq(chatMessages.id, messageId), eq(chatMessages.channelId, channelId)))
    .limit(1);
  if (!existing) {
    throw new ChatError("not_found", "Message introuvable.");
  }
  if (existing.authorId !== actor.userId) {
    throw new ChatError("forbidden", "Seul l'auteur peut modifier son message.");
  }

  const [updated] = await db()
    .update(chatMessages)
    .set({ body: clean })
    .where(eq(chatMessages.id, messageId))
    .returning({ body: chatMessages.body, createdAt: chatMessages.createdAt });
  if (!updated) {
    throw new ChatError("not_found", "Message introuvable.");
  }

  const attachments = await attachmentsByMessage([messageId]);
  return {
    id: messageId,
    body: updated.body,
    createdAt: updated.createdAt.toISOString(),
    authorId: actor.userId,
    authorName: existing.authorName,
    mine: true,
    attachments: attachments.get(messageId) ?? [],
  };
}

export async function markRead(actor: Actor, channelId: string): Promise<void> {
  await requireMembership(actor, channelId);
  await touchReadCursor(db(), channelId, actor.userId);
}

// ---------------------------------------------------------------------------
// Indicateur « en train d'écrire »
// ---------------------------------------------------------------------------

/**
 * Signale que l'acteur est en train d'écrire dans une conversation dont il
 * est membre. `typing: false` signale l'arrêt (message envoyé, canal
 * quitté).
 *
 * Aucune écriture en base et aucun audit : un indicateur de frappe est un
 * état éphémère, pas une donnée métier — le journal
 * d'audit se noierait.
 */
export async function notifyTyping(
  actor: Actor,
  channelId: string,
  typing: boolean = true,
): Promise<void> {
  await requireMembership(actor, channelId);
  if (!typing) {
    stopTyping(channelId, actor.userId);
    return;
  }
  const [author] = await db()
    .select({ name: core.user.name })
    .from(core.user)
    .where(eq(core.user.id, actor.userId))
    .limit(1);
  publishTyping({
    channelId,
    userId: actor.userId,
    name: author?.name ?? "Quelqu'un",
    at: Date.now(),
  });
}

/**
 * Personnes en train d'écrire dans une conversation, soi-même exclu (on
 * ne s'annonce pas à soi-même). Sert de repli au flux SSE indisponible :
 * même source d'information, latence d'interrogation.
 */
export async function listTypingUsers(actor: Actor, channelId: string): Promise<TypingUser[]> {
  await requireMembership(actor, channelId);
  return activeTypingSignals(channelId)
    .filter((signal) => signal.userId !== actor.userId)
    .map((signal) => ({ userId: signal.userId, name: signal.name, at: signal.at }))
    .sort((a, b) => a.name.localeCompare(b.name, "fr"));
}

// ---------------------------------------------------------------------------
// Épingles
// ---------------------------------------------------------------------------

/** Borne de la liste des épingles : au-delà, le canal est un mur d'épingles. */
const MAX_PINS = 200;

/**
 * Épingle un message du canal. Idempotent (une seule épingle par message) ;
 * interdit dans un canal archivé, comme l'envoi. Ouvert à tout membre : une
 * épingle est une marque de collaboration, pas une décision de gestion.
 */
export async function pinMessage(
  actor: Actor,
  channelId: string,
  messageId: string,
): Promise<void> {
  const channel = await requireMembership(actor, channelId);
  if (channel.archivedAt) {
    throw new ChatError("forbidden", "Ce canal est archivé : les épingles sont désactivées.");
  }
  assertUuid(messageId, "messageId");
  const [message] = await db()
    .select({ id: chatMessages.id })
    .from(chatMessages)
    .where(and(eq(chatMessages.id, messageId), eq(chatMessages.channelId, channelId)))
    .limit(1);
  if (!message) throw new ChatError("not_found", "Message introuvable dans cette conversation.");

  const [existing] = await db()
    .select({ id: chatPins.id })
    .from(chatPins)
    .where(and(eq(chatPins.channelId, channelId), eq(chatPins.messageId, messageId)))
    .limit(1);
  // Déjà épinglé : aucune mutation, aucun audit (un double clic ne coûte rien).
  if (existing) return;

  await db().insert(chatPins).values({ channelId, messageId, pinnedBy: actor.userId });
  await recordAudit({
    orgId: actor.orgId,
    actorUserId: actor.userId,
    action: "chat.pin.create",
    resourceType: "message",
    resourceId: messageId,
    result: "success",
  });
}

/** Retire l'épingle d'un message — ouvert à tout membre du canal. */
export async function unpinMessage(
  actor: Actor,
  channelId: string,
  messageId: string,
): Promise<void> {
  await requireMembership(actor, channelId);
  assertUuid(messageId, "messageId");
  const removed = await db()
    .delete(chatPins)
    .where(and(eq(chatPins.channelId, channelId), eq(chatPins.messageId, messageId)))
    .returning({ id: chatPins.id });
  if (removed.length === 0) return;

  await recordAudit({
    orgId: actor.orgId,
    actorUserId: actor.userId,
    action: "chat.pin.remove",
    resourceType: "message",
    resourceId: messageId,
    result: "success",
  });
}

/**
 * Épingles d'une conversation, de la plus récente à la plus ancienne, avec le
 * message complet (auteur, corps, pièces jointes) — le panneau doit se suffire
 * à lui-même, sans seconde requête par épingle.
 */
export async function listPins(actor: Actor, channelId: string): Promise<PinView[]> {
  await requireMembership(actor, channelId);
  const author = alias(core.user, "pin_author");
  const pinner = alias(core.user, "pin_pinner");
  const rows = await db()
    .select({
      id: chatPins.id,
      messageId: chatPins.messageId,
      pinnedAt: chatPins.createdAt,
      pinnedByName: pinner.name,
      body: chatMessages.body,
      createdAt: chatMessages.createdAt,
      authorId: chatMessages.authorId,
      authorName: author.name,
    })
    .from(chatPins)
    .innerJoin(chatMessages, eq(chatMessages.id, chatPins.messageId))
    .innerJoin(author, eq(author.id, chatMessages.authorId))
    .innerJoin(pinner, eq(pinner.id, chatPins.pinnedBy))
    .where(eq(chatPins.channelId, channelId))
    .orderBy(desc(chatPins.createdAt), desc(chatPins.messageId))
    .limit(MAX_PINS);

  const attachments = await attachmentsByMessage(rows.map((row) => row.messageId));
  return rows.map((row) => ({
    id: row.id,
    messageId: row.messageId,
    body: row.body,
    createdAt: row.createdAt.toISOString(),
    pinnedAt: row.pinnedAt.toISOString(),
    authorId: row.authorId,
    authorName: row.authorName,
    pinnedByName: row.pinnedByName,
    mine: row.authorId === actor.userId,
    attachments: attachments.get(row.messageId) ?? [],
  }));
}
