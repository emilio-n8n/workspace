import { createHash, timingSafeEqual } from "node:crypto";
import { getServerEnv } from "@workspace/config";
import { schema as core, getDb, withTransaction } from "@workspace/database";
import type { Actor } from "@workspace/permissions";
import { and, asc, desc, eq, ilike, isNull, or, sql } from "drizzle-orm";
import { type MailMailboxRow, type MailMessageRow, mailMailboxes, mailMessages } from "./schema.ts";

export type MailErrorCode = "not_found" | "forbidden" | "validation" | "conflict";

export class MailError extends Error {
  readonly code: MailErrorCode;
  constructor(code: MailErrorCode, message: string) {
    super(message);
    this.name = "MailError";
    this.code = code;
  }
}

/** Garde de type stable pour les appelants (routes, tests). */
export function isMailError(error: unknown): error is MailError {
  return error instanceof MailError;
}

export type FolderKey = "inbox" | "sent" | "drafts" | "trash";
const FOLDERS: FolderKey[] = ["inbox", "sent", "drafts", "trash"];

export type MailboxView = { id: string; address: string };

export type MessageSummary = {
  id: string;
  folder: FolderKey;
  fromAddress: string;
  fromName: string | null;
  toAddresses: string[];
  subject: string;
  snippet: string;
  read: boolean;
  starred: boolean;
  sendError: string | null;
  createdAt: string;
  sentAt: string | null;
};

export type MessageDetail = MessageSummary & {
  body: string;
  ccAddresses: string[];
};

/** Fil de discussion résumé : regroupement des messages d'une même clé. */
export type ThreadSummary = {
  threadKey: string;
  subject: string;
  messageCount: number;
  unreadCount: number;
  latest: MessageSummary;
};

export type ListMessagesInput = {
  folder?: FolderKey;
  query?: string;
  unreadOnly?: boolean;
  starredOnly?: boolean;
};

export type FolderCounts = Record<FolderKey, { total: number; unread: number }>;

const db = () => getDb();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Bornes de saisie — tout dépassement est refusé, jamais tronqué. */
export const MAX_SUBJECT_LENGTH = 500;
export const MAX_BODY_LENGTH = 100_000;
/** Corps maximal d'un message entrant (webhook MX) : 1 Mio. */
export const MAX_INBOUND_BODY_LENGTH = 1024 * 1024;

const MAX_RECIPIENTS = 20;
const MAX_SEARCH_QUERY_LENGTH = 100;
const MAX_LIST_RESULTS = 200;
/** Adresses dérivées testées avant insertion : local, local2 … local30. */
const MAX_MAILBOX_ADDRESS_ATTEMPTS = 30;
const MAX_UNIQUE_VIOLATION_RETRIES = 5;

function normalizeAddress(value: string): string {
  return value.trim().toLowerCase();
}

function assertEmails(values: string[], label: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of values) {
    const email = normalizeAddress(raw);
    if (email.length === 0 || seen.has(email)) continue;
    if (!EMAIL_RE.test(email)) {
      throw new MailError("validation", `${label} invalide : ${raw}`);
    }
    seen.add(email);
    result.push(email);
  }
  return result;
}

/** L'union to + cc (dédupliquée) est bornée, pas chaque liste séparément. */
function assertRecipientUnion(to: string[], cc: string[]): void {
  const distinct = new Set([...to, ...cc]);
  if (distinct.size > MAX_RECIPIENTS) {
    throw new MailError("validation", `${MAX_RECIPIENTS} destinataires au maximum.`);
  }
}

function assertSubject(value: string): string {
  const subject = value.trim();
  if (subject.length > MAX_SUBJECT_LENGTH) {
    throw new MailError(
      "validation",
      `L'objet ne peut pas dépasser ${MAX_SUBJECT_LENGTH} caractères.`,
    );
  }
  return subject;
}

function assertBodyLength(value: string, max: number, message: string): string {
  if (value.length > max) {
    throw new MailError("validation", message);
  }
  return value;
}

/**
 * Clé de fil d'une conversation : objet normalisé — minuscules, préfixes de
 * réponse/transfert retirés (« re: », « re : », « fwd: », « fw: », « tr: »,
 * éventuellement répétés), espaces réduits puis rognés. Un objet vide (ou
 * réduit à un préfixe) n'a pas de fil : null.
 */
export function computeThreadKey(subject: string): string | null {
  const normalized = subject
    .toLowerCase()
    .replace(/^(\s*(re|fwd|fw|tr)\s*:\s*)+/, "")
    .replace(/\s+/g, " ")
    .trim();
  return normalized.length > 0 ? normalized : null;
}

function isUniqueViolation(error: unknown): boolean {
  const candidate = error as { code?: string; cause?: { code?: string } };
  return candidate?.code === "23505" || candidate?.cause?.code === "23505";
}

/** Réessaie l'opération en cas de violation d'unicité PostgreSQL (code 23505). */
async function withUniqueViolationRetry<T>(operation: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_UNIQUE_VIOLATION_RETRIES; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      lastError = error;
    }
  }
  throw lastError;
}

/** Échappe les jokers LIKE/ILIKE (%, _ et \) pour une recherche littérale. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

// ---------------------------------------------------------------------------
// Boîte
// ---------------------------------------------------------------------------

function buildLocalPart(email: string): string {
  const local = (email.split("@")[0] ?? "boite")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9._-]/g, "");
  return local.length > 0 ? local.slice(0, 40) : "boite";
}

function mailboxView(row: MailMailboxRow): MailboxView {
  return { id: row.id, address: row.address };
}

async function findMailbox(orgId: string, userId: string): Promise<MailMailboxRow | undefined> {
  const [row] = await db()
    .select()
    .from(mailMailboxes)
    .where(and(eq(mailMailboxes.orgId, orgId), eq(mailMailboxes.userId, userId)))
    .limit(1);
  return row;
}

async function isAddressTaken(address: string): Promise<boolean> {
  const [row] = await db()
    .select({ id: mailMailboxes.id })
    .from(mailMailboxes)
    .where(eq(mailMailboxes.address, address))
    .limit(1);
  return row !== undefined;
}

/** Boîte de l'acteur (créée à la première utilisation). */
export async function ensureMailbox(actor: Actor): Promise<MailboxView> {
  const existing = await findMailbox(actor.orgId, actor.userId);
  if (existing) return mailboxView(existing);

  const [user] = await db()
    .select({ email: core.user.email })
    .from(core.user)
    .where(eq(core.user.id, actor.userId))
    .limit(1);

  const env = getServerEnv();
  const domain = env.MAIL_DOMAIN ?? new URL(env.PUBLIC_URL).hostname;
  const local = buildLocalPart(user?.email ?? "");

  return withUniqueViolationRetry(async () => {
    // Un appel concurrent a pu créer la boîte entre-temps.
    const concurrent = await findMailbox(actor.orgId, actor.userId);
    if (concurrent) return mailboxView(concurrent);

    for (let attempt = 1; attempt <= MAX_MAILBOX_ADDRESS_ATTEMPTS; attempt += 1) {
      const address = attempt === 1 ? `${local}@${domain}` : `${local}${attempt}@${domain}`;
      if (await isAddressTaken(address)) continue;

      const [created] = await db()
        .insert(mailMailboxes)
        .values({ orgId: actor.orgId, userId: actor.userId, address })
        .onConflictDoNothing()
        .returning();
      if (created) return mailboxView(created);

      // Insertion ignorée : boîte déjà créée par un appel concurrent du même
      // acteur, ou adresse prise entre-temps par un autre acteur (on passe à
      // la variante suivante).
      const raced = await findMailbox(actor.orgId, actor.userId);
      if (raced) return mailboxView(raced);
    }
    throw new MailError("conflict", "Aucune adresse de boîte disponible.");
  });
}

async function requireMailbox(actor: Actor): Promise<MailMailboxRow> {
  const [row] = await db()
    .select()
    .from(mailMailboxes)
    .where(and(eq(mailMailboxes.orgId, actor.orgId), eq(mailMailboxes.userId, actor.userId)))
    .limit(1);
  if (!row) throw new MailError("not_found", "Boîte introuvable — ouvrez Mail d'abord.");
  return row;
}

async function requireOwnedMessage(actor: Actor, messageId: string) {
  const mailbox = await requireMailbox(actor);
  const [message] = await db()
    .select()
    .from(mailMessages)
    .where(and(eq(mailMessages.id, messageId), eq(mailMessages.mailboxId, mailbox.id)))
    .limit(1);
  if (!message) throw new MailError("not_found", "Message introuvable.");
  return { mailbox, message };
}

type MessageSummaryRow = Pick<
  MailMessageRow,
  | "id"
  | "folder"
  | "fromAddress"
  | "fromName"
  | "toAddresses"
  | "subject"
  | "readAt"
  | "starred"
  | "sendError"
  | "createdAt"
  | "sentAt"
>;

function toSummary(row: MessageSummaryRow, snippet: string): MessageSummary {
  return {
    id: row.id,
    folder: row.folder as FolderKey,
    fromAddress: row.fromAddress,
    fromName: row.fromName,
    toAddresses: row.toAddresses,
    subject: row.subject,
    snippet: snippet.replace(/\s+/g, " ").slice(0, 160),
    read: row.readAt !== null,
    starred: row.starred,
    sendError: row.sendError,
    createdAt: row.createdAt.toISOString(),
    sentAt: row.sentAt?.toISOString() ?? null,
  };
}

function toDetail(row: MailMessageRow): MessageDetail {
  return {
    ...toSummary(row, row.body),
    body: row.body,
    ccAddresses: row.ccAddresses,
  };
}

// ---------------------------------------------------------------------------
// Lecture
// ---------------------------------------------------------------------------

export async function listFolders(actor: Actor): Promise<FolderCounts> {
  const mailbox = await ensureMailbox(actor);
  const rows = await db()
    .select({
      folder: mailMessages.folder,
      total: sql<number>`count(*)`.mapWith(Number),
      unread: sql<number>`count(*) filter (where ${mailMessages.readAt} is null)`.mapWith(Number),
    })
    .from(mailMessages)
    .where(eq(mailMessages.mailboxId, mailbox.id))
    .groupBy(mailMessages.folder);

  const counts = {} as FolderCounts;
  for (const folder of FOLDERS) {
    counts[folder] = { total: 0, unread: 0 };
  }
  for (const row of rows) {
    const folder = row.folder as FolderKey;
    if (!FOLDERS.includes(folder)) continue;
    counts[folder] = {
      total: row.total,
      // Le non-lu n'a de sens que pour la boîte de réception.
      unread: folder === "inbox" ? row.unread : 0,
    };
  }
  return counts;
}

/** Conditions communes aux listes plates et filaires (dossier + filtres). */
function listConditions(mailboxId: string, folder: FolderKey, input: ListMessagesInput) {
  const conditions = [eq(mailMessages.mailboxId, mailboxId), eq(mailMessages.folder, folder)];
  const query = input.query?.trim().slice(0, MAX_SEARCH_QUERY_LENGTH);
  if (query && query.length > 0) {
    const pattern = `%${escapeLike(query)}%`;
    const search = or(
      ilike(mailMessages.subject, pattern),
      ilike(mailMessages.fromAddress, pattern),
      ilike(mailMessages.body, pattern),
    );
    if (search) conditions.push(search);
  }
  if (input.unreadOnly) conditions.push(isNull(mailMessages.readAt));
  if (input.starredOnly) conditions.push(eq(mailMessages.starred, true));
  return conditions;
}

/** Colonnes d'un résumé de liste — le corps complet ne quitte jamais la base. */
const summarySelection = {
  id: mailMessages.id,
  folder: mailMessages.folder,
  fromAddress: mailMessages.fromAddress,
  fromName: mailMessages.fromName,
  toAddresses: mailMessages.toAddresses,
  subject: mailMessages.subject,
  readAt: mailMessages.readAt,
  starred: mailMessages.starred,
  sendError: mailMessages.sendError,
  createdAt: mailMessages.createdAt,
  sentAt: mailMessages.sentAt,
  snippet: sql<string>`left(${mailMessages.body}, 200)`,
};

/**
 * Regroupe des résumés triés par created_at décroissant en fils : le premier
 * message rencontré pour une clé est le plus récent, et la Map conserve l'ordre
 * d'insertion — les fils sortent donc triés par dernier message. Un threadKey
 * null devient un fil singleton portant l'id du message comme clé. La limite
 * s'applique aux fils, pas aux messages.
 */
function toThreadSummaries(
  rows: (MessageSummaryRow & { threadKey: string | null; snippet: string })[],
): ThreadSummary[] {
  const threads = new Map<string, ThreadSummary>();
  for (const row of rows) {
    const key = row.threadKey ?? row.id;
    const thread = threads.get(key);
    if (thread) {
      thread.messageCount += 1;
      if (row.readAt === null) thread.unreadCount += 1;
      continue;
    }
    threads.set(key, {
      threadKey: key,
      subject: row.subject,
      messageCount: 1,
      unreadCount: row.readAt === null ? 1 : 0,
      latest: toSummary(row, row.snippet),
    });
  }
  return [...threads.values()].slice(0, MAX_LIST_RESULTS);
}

export function listMessages(
  actor: Actor,
  input: ListMessagesInput & { threaded: true },
): Promise<ThreadSummary[]>;
export function listMessages(
  actor: Actor,
  input?: ListMessagesInput & { threaded?: false },
): Promise<MessageSummary[]>;
export function listMessages(
  actor: Actor,
  input?: ListMessagesInput & { threaded?: boolean },
): Promise<MessageSummary[] | ThreadSummary[]>;
export async function listMessages(
  actor: Actor,
  input: ListMessagesInput & { threaded?: boolean } = {},
): Promise<MessageSummary[] | ThreadSummary[]> {
  const mailbox = await ensureMailbox(actor);
  const folder = input.folder ?? "inbox";
  const conditions = listConditions(mailbox.id, folder, input);

  if (input.threaded) {
    // Les compteurs par fil doivent être exacts : on lit les résumés du dossier
    // (sans le corps complet), puis on regroupe en mémoire.
    const rows = await db()
      .select({ ...summarySelection, threadKey: mailMessages.threadKey })
      .from(mailMessages)
      .where(and(...conditions))
      .orderBy(desc(mailMessages.createdAt), desc(mailMessages.id));
    return toThreadSummaries(rows);
  }

  const rows = await db()
    .select(summarySelection)
    .from(mailMessages)
    .where(and(...conditions))
    .orderBy(desc(mailMessages.createdAt))
    .limit(MAX_LIST_RESULTS);
  return rows.map((row) => toSummary(row, row.snippet));
}

/**
 * Tous les messages d'un fil (même boîte, même dossier, même threadKey), du
 * plus ancien au plus récent, corps inclus. Un message sans clé de fil est son
 * propre fil : la liste ne contient que lui. Lecture pure, sans marquage lu.
 */
export async function listThreadMessages(
  actor: Actor,
  messageId: string,
): Promise<MessageDetail[]> {
  const { mailbox, message } = await requireOwnedMessage(actor, messageId);
  if (message.threadKey === null) return [toDetail(message)];

  const rows = await db()
    .select()
    .from(mailMessages)
    .where(
      and(
        eq(mailMessages.mailboxId, mailbox.id),
        eq(mailMessages.folder, message.folder),
        eq(mailMessages.threadKey, message.threadKey),
      ),
    )
    .orderBy(asc(mailMessages.createdAt), asc(mailMessages.id));
  return rows.map(toDetail);
}

export async function getMessage(actor: Actor, messageId: string): Promise<MessageDetail> {
  const { message } = await requireOwnedMessage(actor, messageId);
  if (message.folder === "inbox" && message.readAt === null) {
    await db()
      .update(mailMessages)
      .set({ readAt: new Date() })
      .where(eq(mailMessages.id, messageId));
    message.readAt = new Date();
  }
  return toDetail(message);
}

export async function toggleStar(actor: Actor, messageId: string): Promise<{ starred: boolean }> {
  const mailbox = await requireMailbox(actor);
  const [updated] = await db()
    .update(mailMessages)
    .set({ starred: sql`not ${mailMessages.starred}` })
    .where(and(eq(mailMessages.id, messageId), eq(mailMessages.mailboxId, mailbox.id)))
    .returning({ starred: mailMessages.starred });
  if (!updated) throw new MailError("not_found", "Message introuvable.");
  return { starred: updated.starred };
}

export async function markRead(actor: Actor, messageId: string): Promise<void> {
  await requireOwnedMessage(actor, messageId);
  await db().update(mailMessages).set({ readAt: new Date() }).where(eq(mailMessages.id, messageId));
}

// ---------------------------------------------------------------------------
// Brouillons et envoi
// ---------------------------------------------------------------------------

export async function saveDraft(
  actor: Actor,
  input: { id?: string; to: string[]; cc: string[]; subject: string; body: string },
): Promise<{ id: string }> {
  const mailbox = await ensureMailbox(actor);
  const to = assertEmails(input.to, "Destinataire");
  const cc = assertEmails(input.cc, "Copie");
  assertRecipientUnion(to, cc);
  const subject = assertSubject(input.subject);
  const body = assertBodyLength(
    input.body,
    MAX_BODY_LENGTH,
    "Le corps du message ne peut pas dépasser 100 000 caractères.",
  );

  if (input.id) {
    const { message } = await requireOwnedMessage(actor, input.id);
    if (message.folder !== "drafts") {
      throw new MailError("validation", "Seuls les brouillons sont modifiables.");
    }
    await db()
      .update(mailMessages)
      .set({
        toAddresses: to,
        ccAddresses: cc,
        subject,
        threadKey: computeThreadKey(subject),
        body,
        fromAddress: mailbox.address,
      })
      .where(eq(mailMessages.id, input.id));
    return { id: input.id };
  }

  const [created] = await db()
    .insert(mailMessages)
    .values({
      orgId: actor.orgId,
      mailboxId: mailbox.id,
      folder: "drafts",
      fromAddress: mailbox.address,
      toAddresses: to,
      ccAddresses: cc,
      subject,
      threadKey: computeThreadKey(subject),
      body,
    })
    .returning({ id: mailMessages.id });
  if (!created) throw new MailError("validation", "Enregistrement du brouillon impossible.");
  return { id: created.id };
}

/**
 * Envoi : le message est toujours conservé dans « Envoyés ». Si SMTP est
 * configuré, la transmission est tentée APRÈS le commit (un échec réseau ne
 * doit jamais annuler l'écriture) ; en cas d'échec — ou sans SMTP — une erreur
 * explicite est attachée au message (jamais d'échec silencieux).
 */
export async function sendMail(
  actor: Actor,
  input: { id?: string; to: string[]; cc: string[]; subject: string; body: string },
): Promise<{ id: string; sendError: string | null }> {
  const mailbox = await ensureMailbox(actor);
  const to = assertEmails(input.to, "Destinataire");
  if (to.length === 0) {
    throw new MailError("validation", "Au moins un destinataire est requis.");
  }
  const cc = assertEmails(input.cc, "Copie");
  assertRecipientUnion(to, cc);
  const subject = assertSubject(input.subject);
  const body = assertBodyLength(
    input.body,
    MAX_BODY_LENGTH,
    "Le corps du message ne peut pas dépasser 100 000 caractères.",
  );

  // Le brouillon est résolu AVANT toute écriture : un identifiant invalide ne
  // doit jamais produire de ligne dans « Envoyés ».
  let draftId: string | null = null;
  if (input.id) {
    const { message } = await requireOwnedMessage(actor, input.id);
    if (message.folder !== "drafts") {
      throw new MailError("validation", "Seul un brouillon peut être envoyé.");
    }
    draftId = message.id;
  }

  const sentId = await withTransaction(async (tx) => {
    const [sent] = await tx
      .insert(mailMessages)
      .values({
        orgId: actor.orgId,
        mailboxId: mailbox.id,
        folder: "sent",
        fromAddress: mailbox.address,
        toAddresses: to,
        ccAddresses: cc,
        subject,
        threadKey: computeThreadKey(subject),
        body,
        readAt: new Date(),
        sentAt: new Date(),
      })
      .returning({ id: mailMessages.id });
    if (!sent) throw new MailError("validation", "Envoi impossible.");
    if (draftId) {
      await tx.delete(mailMessages).where(eq(mailMessages.id, draftId));
    }
    return sent.id;
  });

  const env = getServerEnv();
  let sendError: string | null = null;

  if (!env.SMTP_HOST) {
    sendError = "SMTP non configuré — message conservé dans « Envoyés », non transmis.";
  } else {
    try {
      const nodemailer = await import("nodemailer");
      const transport = nodemailer.createTransport({
        host: env.SMTP_HOST,
        port: env.SMTP_PORT ?? 587,
        secure: (env.SMTP_PORT ?? 587) === 465,
        auth:
          env.SMTP_USER && env.SMTP_PASS ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
      });
      await transport.sendMail({
        from: env.SMTP_FROM ?? mailbox.address,
        to: to.join(", "),
        cc: cc.length > 0 ? cc.join(", ") : undefined,
        subject: subject || "(sans objet)",
        text: body,
      });
    } catch (caught) {
      sendError = `Échec SMTP : ${caught instanceof Error ? caught.message : "erreur inconnue"}`;
    }
  }

  if (sendError) {
    await db().update(mailMessages).set({ sendError }).where(eq(mailMessages.id, sentId));
  }
  return { id: sentId, sendError };
}

// ---------------------------------------------------------------------------
// Corbeille
// ---------------------------------------------------------------------------

export async function trashMessage(actor: Actor, messageId: string): Promise<void> {
  const { message } = await requireOwnedMessage(actor, messageId);
  if (message.folder === "trash") return;
  await db()
    .update(mailMessages)
    .set({ folder: "trash", trashedFrom: message.folder })
    .where(eq(mailMessages.id, messageId));
}

export async function restoreMessage(actor: Actor, messageId: string): Promise<void> {
  const { message } = await requireOwnedMessage(actor, messageId);
  if (message.folder !== "trash") return;
  const target =
    message.trashedFrom && FOLDERS.includes(message.trashedFrom as FolderKey)
      ? message.trashedFrom
      : "inbox";
  await db()
    .update(mailMessages)
    .set({ folder: target, trashedFrom: null })
    .where(eq(mailMessages.id, messageId));
}

export async function deleteMessage(actor: Actor, messageId: string): Promise<void> {
  const { message } = await requireOwnedMessage(actor, messageId);
  if (message.folder !== "trash") {
    throw new MailError("validation", "Le message doit d'abord être mis à la corbeille.");
  }
  await db().delete(mailMessages).where(eq(mailMessages.id, messageId));
}

// ---------------------------------------------------------------------------
// Ingestion entrante (MX → POST, secret partagé)
// ---------------------------------------------------------------------------

export type InboundPayload = {
  to: string;
  from: string;
  fromName?: string;
  subject?: string;
  body?: string;
  /** Identifiant du message chez le relais — clé d'idempotence. */
  externalId?: string;
};

/** Comparaison en temps constant : digests SHA-256 de longueur fixe. */
function secretsMatch(expected: string, provided: string | null): boolean {
  if (provided === null) return false;
  const expectedDigest = createHash("sha256").update(expected).digest();
  const providedDigest = createHash("sha256").update(provided).digest();
  return timingSafeEqual(expectedDigest, providedDigest);
}

export async function createInboundMessage(
  payload: InboundPayload,
  secret: string | null,
): Promise<{ id: string }> {
  const env = getServerEnv();
  if (!env.MAIL_WEBHOOK_SECRET || !secretsMatch(env.MAIL_WEBHOOK_SECRET, secret)) {
    throw new MailError("forbidden", "Ingestion refusée : secret invalide.");
  }

  const to = normalizeAddress(payload.to);
  const [mailbox] = await db()
    .select()
    .from(mailMailboxes)
    .where(eq(mailMailboxes.address, to))
    .limit(1);
  if (!mailbox) {
    throw new MailError("not_found", `Boîte inconnue : ${to}`);
  }

  const from = normalizeAddress(payload.from);
  if (!EMAIL_RE.test(from)) {
    throw new MailError("validation", "Expéditeur invalide.");
  }

  const subject = assertSubject(payload.subject ?? "");
  const body = assertBodyLength(
    payload.body ?? "",
    MAX_INBOUND_BODY_LENGTH,
    "Corps du message trop volumineux (1 Mo maximum).",
  );
  const externalId = payload.externalId?.trim() ?? "";

  const [created] = await db()
    .insert(mailMessages)
    .values({
      orgId: mailbox.orgId,
      mailboxId: mailbox.id,
      folder: "inbox",
      fromAddress: from,
      fromName: payload.fromName?.trim().slice(0, 200) ?? null,
      toAddresses: [mailbox.address],
      subject,
      threadKey: computeThreadKey(subject),
      body,
      externalId: externalId.length > 0 ? externalId : null,
    })
    .onConflictDoNothing()
    .returning({ id: mailMessages.id });
  if (created) return { id: created.id };

  // Insertion ignorée : un message portant le même externalId existe déjà.
  if (externalId.length > 0) {
    const [existing] = await db()
      .select({ id: mailMessages.id })
      .from(mailMessages)
      .where(eq(mailMessages.externalId, externalId))
      .limit(1);
    if (existing) return { id: existing.id };
  }
  throw new MailError("validation", "Ingestion impossible.");
}
