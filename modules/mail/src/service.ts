import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { recordAudit } from "@workspace/audit";
import { getServerEnv } from "@workspace/config";
import { schema as core, getDb, sortFr, withTransaction } from "@workspace/database";
import type { Actor } from "@workspace/permissions";
import { getStorage } from "@workspace/storage";
import { and, asc, desc, eq, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import {
  DEFAULT_LABEL_COLOR,
  isLabelColorKey,
  MAX_LABEL_NAME_LENGTH,
  MAX_LABELS_PER_MESSAGE,
  MAX_LABELS_PER_USER,
} from "./label-colors.ts";
import {
  type MailAttachmentRow,
  type MailLabelRow,
  type MailMailboxRow,
  type MailMessageRow,
  mailAttachments,
  mailLabels,
  mailMailboxes,
  mailMessageLabels,
  mailMessages,
} from "./schema.ts";

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

export type FolderKey = "inbox" | "archive" | "sent" | "drafts" | "trash";
const FOLDERS: FolderKey[] = ["inbox", "archive", "sent", "drafts", "trash"];

/**
 * Dossiers qu'un message peut quitter pour les archives : la corbeille et les
 * brouillons restent dehors (archiver un brouillon n'aurait aucun sens — il
 * n'est pas encore parti).
 */
const ARCHIVABLE: FolderKey[] = ["inbox", "sent"];

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
  /** Nombre de pièces jointes — le détail expose la liste complète. */
  attachmentCount: number;
  /** Libellés personnels appliqués au message. */
  labels: MessageLabelRef[];
};

/** Libellé réduit à ce que l'UI affiche (id, nom, couleur). */
export type MessageLabelRef = { id: string; name: string; color: string };

/** Libellé personnel, tel que renvoyé par la liste de gestion. */
export type MailLabel = MessageLabelRef & { createdAt: string };

/** Métadonnées d'une pièce jointe exposées à l'UI (jamais la clé de stockage). */
export type AttachmentMeta = {
  id: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
};

export type MessageDetail = MessageSummary & {
  body: string;
  ccAddresses: string[];
  /** Copies cachées (Cci) — jamais affichées aux autres destinataires. */
  bccAddresses: string[];
  attachments: AttachmentMeta[];
};

/** Fil de discussion résumé : regroupement des messages d'une même clé. */
export type ThreadSummary = {
  threadKey: string;
  subject: string;
  messageCount: number;
  unreadCount: number;
  latest: MessageSummary;
  /** Union des libellés des messages du fil. */
  labels: MessageLabelRef[];
};

export type ListMessagesInput = {
  folder?: FolderKey;
  query?: string;
  /** Filtre par expéditeur (contient, insensible à la casse). */
  from?: string;
  /** Filtre par destinataire — compare chaque élément de « À ». */
  to?: string;
  /** Uniquement les messages non lus. */
  unreadOnly?: boolean;
  /** Uniquement les messages suivis (étoile). */
  starredOnly?: boolean;
  /** Uniquement les messages portant au moins une pièce jointe. */
  hasAttachment?: boolean;
  /** Uniquement les messages portant ce libellé. */
  labelId?: string;
};

export type FolderCounts = Record<FolderKey, { total: number; unread: number }>;

const db = () => getDb();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Bornes de saisie — tout dépassement est refusé, jamais tronqué. */
export const MAX_SUBJECT_LENGTH = 500;
export const MAX_BODY_LENGTH = 100_000;
/** Corps maximal d'un message entrant (webhook MX) : 1 Mio. */
export const MAX_INBOUND_BODY_LENGTH = 1024 * 1024;
/** Pièces jointes : 5 fichiers de 10 Mio au maximum (sortant et lecture). */
export const MAX_ATTACHMENTS = 5;
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
/** Pièce jointe entrante (webhook MX) : 5 Mio décodés au maximum chacune. */
export const MAX_INBOUND_ATTACHMENT_BYTES = 5 * 1024 * 1024;
export const MAX_ATTACHMENT_FILENAME_LENGTH = 255;
export const MAX_CONTENT_TYPE_LENGTH = 200;

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

/** L'union À + Cc + Cci (dédupliquée) est bornée, pas chaque liste séparément. */
function assertRecipientUnion(to: string[], cc: string[], bcc: string[]): void {
  const distinct = new Set([...to, ...cc, ...bcc]);
  if (distinct.size > MAX_RECIPIENTS) {
    throw new MailError(
      "validation",
      `${MAX_RECIPIENTS} destinataires au maximum (À, Cc et Cci confondus).`,
    );
  }
}

type Recipients = { to: string[]; cc: string[]; bcc: string[] };

/**
 * Valide les trois listes de destinataires d'un coup. `requireTo` distingue
 * l'envoi (au moins un destinataire) du brouillon (une ébauche peut être
 * enregistrée sans destinataire).
 */
function assertRecipients(
  input: { to: string[]; cc: string[]; bcc?: string[] },
  options: { requireTo: boolean },
): Recipients {
  const to = assertEmails(input.to, "Destinataire");
  const cc = assertEmails(input.cc, "Copie");
  const bcc = assertEmails(input.bcc ?? [], "Copie cachée");
  if (options.requireTo && to.length === 0) {
    throw new MailError("validation", "Au moins un destinataire est requis.");
  }
  assertRecipientUnion(to, cc, bcc);
  return { to, cc, bcc };
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

// ---------------------------------------------------------------------------
// Pièces jointes — validation commune (sortant, entrant, lecture)
// ---------------------------------------------------------------------------

function assertAttachmentFilename(value: unknown): string {
  if (typeof value !== "string") {
    throw new MailError("validation", "Nom de fichier invalide.");
  }
  const filename = value.trim();
  if (filename.length === 0 || filename.length > MAX_ATTACHMENT_FILENAME_LENGTH) {
    throw new MailError(
      "validation",
      `Nom de fichier invalide (1 à ${MAX_ATTACHMENT_FILENAME_LENGTH} caractères).`,
    );
  }
  if (/[/\\]/.test(filename) || filename.includes("\0")) {
    throw new MailError(
      "validation",
      "Le nom du fichier ne peut pas contenir de séparateur de chemin.",
    );
  }
  return filename;
}

function assertContentType(value: unknown): string {
  if (typeof value !== "string") {
    throw new MailError("validation", "Type de contenu invalide.");
  }
  const contentType = value.trim();
  if (contentType.length === 0 || contentType.length > MAX_CONTENT_TYPE_LENGTH) {
    throw new MailError(
      "validation",
      `Type de contenu invalide (1 à ${MAX_CONTENT_TYPE_LENGTH} caractères).`,
    );
  }
  return contentType;
}

/** Jeton provisoire renvoyé par `uploadMailAttachment` puis transmis à `sendMail`. */
export type AttachmentToken = {
  storageKey: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
};

/**
 * Valide les jetons d'upload avant rattachement : bornés à 5, chacun préfixé
 * par `mail/<orgId>/` — un jeton d'une autre organisation ne passe jamais.
 */
function assertAttachmentTokens(actor: Actor, attachments: AttachmentToken[]): AttachmentToken[] {
  if (attachments.length > MAX_ATTACHMENTS) {
    throw new MailError("validation", `${MAX_ATTACHMENTS} pièces jointes au maximum.`);
  }
  const prefix = `mail/${actor.orgId}/`;
  return attachments.map((attachment) => {
    if (!attachment.storageKey.startsWith(prefix)) {
      throw new MailError("validation", "Clé de pièce jointe invalide.");
    }
    if (
      !Number.isInteger(attachment.sizeBytes) ||
      attachment.sizeBytes < 0 ||
      attachment.sizeBytes > MAX_ATTACHMENT_BYTES
    ) {
      throw new MailError("validation", "Taille de pièce jointe invalide.");
    }
    return {
      storageKey: attachment.storageKey,
      filename: assertAttachmentFilename(attachment.filename),
      contentType: assertContentType(attachment.contentType),
      sizeBytes: attachment.sizeBytes,
    };
  });
}

/** Décode une pièce jointe entrante (base64 strict) et borne sa taille. */
function decodeAttachmentBase64(value: unknown): Buffer {
  if (typeof value !== "string") {
    throw new MailError("validation", "Pièce jointe : contenu base64 invalide.");
  }
  const normalized = value.replace(/\s+/g, "");
  if (
    normalized.length === 0 ||
    normalized.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(normalized)
  ) {
    throw new MailError("validation", "Pièce jointe : contenu base64 invalide.");
  }
  const body = Buffer.from(normalized, "base64");
  if (body.length > MAX_INBOUND_ATTACHMENT_BYTES) {
    throw new MailError(
      "validation",
      `Pièce jointe trop volumineuse (${MAX_INBOUND_ATTACHMENT_BYTES / (1024 * 1024)} Mo maximum).`,
    );
  }
  return body;
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

/**
 * Dossier d'origine mémorisé à la sortie d'une liste (corbeille, archives) :
 * une valeur absente ou inconnue retombe sur la boîte de réception.
 */
function originFolder(trashedFrom: string | null): FolderKey {
  return trashedFrom && FOLDERS.includes(trashedFrom as FolderKey)
    ? (trashedFrom as FolderKey)
    : "inbox";
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

/** Pièce jointe d'un message de la boîte de l'acteur — jamais celle d'un autre. */
async function requireOwnedAttachment(
  actor: Actor,
  attachmentId: string,
): Promise<MailAttachmentRow> {
  const mailbox = await requireMailbox(actor);
  const [row] = await db()
    .select({ attachment: mailAttachments })
    .from(mailAttachments)
    .innerJoin(mailMessages, eq(mailMessages.id, mailAttachments.messageId))
    .where(and(eq(mailAttachments.id, attachmentId), eq(mailMessages.mailboxId, mailbox.id)))
    .limit(1);
  if (!row) throw new MailError("not_found", "Pièce jointe introuvable.");
  return row.attachment;
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
> & { attachmentCount: number };

function toSummary(
  row: MessageSummaryRow,
  snippet: string,
  labels: MessageLabelRef[] = [],
): MessageSummary {
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
    attachmentCount: row.attachmentCount,
    labels,
  };
}

function toDetail(
  row: MailMessageRow,
  attachments: AttachmentMeta[],
  labels: MessageLabelRef[] = [],
): MessageDetail {
  return {
    ...toSummary({ ...row, attachmentCount: attachments.length }, row.body, labels),
    body: row.body,
    ccAddresses: row.ccAddresses,
    bccAddresses: row.bccAddresses,
    attachments,
  };
}

/** Métadonnées des libellés de plusieurs messages (une seule requête). */
async function labelsByMessage(
  actor: Actor,
  messageIds: string[],
): Promise<Map<string, MessageLabelRef[]>> {
  const result = new Map<string, MessageLabelRef[]>();
  if (messageIds.length === 0) return result;
  const rows = await db()
    .select({
      messageId: mailMessageLabels.messageId,
      id: mailLabels.id,
      name: mailLabels.name,
      color: mailLabels.color,
    })
    .from(mailMessageLabels)
    .innerJoin(mailLabels, eq(mailLabels.id, mailMessageLabels.labelId))
    .where(
      and(inArray(mailMessageLabels.messageId, messageIds), eq(mailLabels.userId, actor.userId)),
    )
    .orderBy(asc(mailLabels.name), asc(mailLabels.id));
  for (const row of rows) {
    const list = result.get(row.messageId) ?? [];
    list.push({ id: row.id, name: row.name, color: row.color });
    result.set(row.messageId, list);
  }
  return result;
}

/** Métadonnées des pièces jointes de plusieurs messages (une seule requête). */
async function attachmentsByMessage(messageIds: string[]): Promise<Map<string, AttachmentMeta[]>> {
  const result = new Map<string, AttachmentMeta[]>();
  if (messageIds.length === 0) return result;
  const rows = await db()
    .select()
    .from(mailAttachments)
    .where(inArray(mailAttachments.messageId, messageIds))
    .orderBy(asc(mailAttachments.createdAt), asc(mailAttachments.id));
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
function listConditions(
  actor: Actor,
  mailboxId: string,
  folder: FolderKey,
  input: ListMessagesInput,
) {
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
  // Filtre « De » : l'expéditeur, comparé comme la recherche (contient).
  const from = input.from?.trim().slice(0, MAX_SEARCH_QUERY_LENGTH);
  if (from && from.length > 0) {
    conditions.push(ilike(mailMessages.fromAddress, `%${escapeLike(from)}%`));
  }
  // Filtre « À » : chaque destinataire est comparé (jsonb → texte par élément).
  const to = input.to?.trim().slice(0, MAX_SEARCH_QUERY_LENGTH);
  if (to && to.length > 0) {
    conditions.push(
      sql`exists (select 1 from jsonb_array_elements_text(${mailMessages.toAddresses}) as destinataire where destinataire ilike ${`%${escapeLike(to)}%`})`,
    );
  }
  if (input.unreadOnly) conditions.push(isNull(mailMessages.readAt));
  if (input.starredOnly) conditions.push(eq(mailMessages.starred, true));
  if (input.hasAttachment) {
    conditions.push(
      sql`exists (select 1 from ${mailAttachments} where ${mailAttachments.messageId} = ${sql.identifier("mail_messages")}.${sql.identifier("id")})`,
    );
  }
  // Filtre par libellé : seuls les libellés de l'utilisateur comptent, la
  // condition est posée côté jointure (jamais de libellé étranger).
  if (input.labelId) {
    conditions.push(
      sql`exists (select 1 from ${mailMessageLabels} join ${mailLabels} on ${mailLabels.id} = ${mailMessageLabels.labelId} where ${mailMessageLabels.messageId} = ${sql.identifier("mail_messages")}.${sql.identifier("id")} and ${mailMessageLabels.labelId} = ${input.labelId} and ${mailLabels.userId} = ${actor.userId})`,
    );
  }
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
  // Sous-requête corrélée : l'identifiant du message doit être qualifié
  // explicitement, sinon PostgreSQL le résout dans la portée de la
  // sous-requête (`mail_attachments.id`).
  attachmentCount: sql<number>`(select count(*)::int from ${mailAttachments} where ${mailAttachments.messageId} = ${sql.identifier("mail_messages")}.${sql.identifier("id")})`,
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
  labelsByKey: Map<string, MessageLabelRef[]>,
): ThreadSummary[] {
  const threads = new Map<string, ThreadSummary>();
  for (const row of rows) {
    const key = row.threadKey ?? row.id;
    // Les libellés sont appliqués par message : un fil porte l'union des
    // libellés de ses messages, ceux du plus récent d'abord.
    const labels = new Map<string, MessageLabelRef>();
    for (const label of labelsByKey.get(row.id) ?? []) labels.set(label.id, label);
    const thread = threads.get(key);
    if (thread) {
      thread.messageCount += 1;
      if (row.readAt === null) thread.unreadCount += 1;
      for (const label of labels.values()) {
        if (!thread.labels.some((existing) => existing.id === label.id)) {
          thread.labels.push(label);
        }
      }
      continue;
    }
    threads.set(key, {
      threadKey: key,
      subject: row.subject,
      messageCount: 1,
      unreadCount: row.readAt === null ? 1 : 0,
      latest: toSummary(row, row.snippet, [...labels.values()]),
      labels: [...labels.values()],
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
  const conditions = listConditions(actor, mailbox.id, folder, input);

  if (input.threaded) {
    // Les compteurs par fil doivent être exacts : on lit les résumés du dossier
    // (sans le corps complet), puis on regroupe en mémoire.
    const rows = await db()
      .select({ ...summarySelection, threadKey: mailMessages.threadKey })
      .from(mailMessages)
      .where(and(...conditions))
      .orderBy(desc(mailMessages.createdAt), desc(mailMessages.id));
    const labels = await labelsByMessage(
      actor,
      rows.map((row) => row.id),
    );
    return toThreadSummaries(rows, labels);
  }

  const rows = await db()
    .select(summarySelection)
    .from(mailMessages)
    .where(and(...conditions))
    .orderBy(desc(mailMessages.createdAt))
    .limit(MAX_LIST_RESULTS);
  const labels = await labelsByMessage(
    actor,
    rows.map((row) => row.id),
  );
  return rows.map((row) => toSummary(row, row.snippet, labels.get(row.id) ?? []));
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
  if (message.threadKey === null) {
    const attachments = await attachmentsByMessage([message.id]);
    return [toDetail(message, attachments.get(message.id) ?? [])];
  }

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
  const attachments = await attachmentsByMessage(rows.map((row) => row.id));
  const labels = await labelsByMessage(
    actor,
    rows.map((row) => row.id),
  );
  return rows.map((row) => toDetail(row, attachments.get(row.id) ?? [], labels.get(row.id) ?? []));
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
  const attachments = await attachmentsByMessage([message.id]);
  const labels = await labelsByMessage(actor, [message.id]);
  return toDetail(message, attachments.get(message.id) ?? [], labels.get(message.id) ?? []);
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

/**
 * Marque comme lus tous les messages du fil auquel appartient `messageId`
 * (même boîte, même dossier, même clé). Un message sans clé ne marque que
 * lui. Retourne le nombre de messages réellement modifiés — un fil déjà lu
 * renvoie 0, ce n'est pas une erreur.
 */
export async function markThreadRead(
  actor: Actor,
  messageId: string,
): Promise<{ updated: number }> {
  const { mailbox, message } = await requireOwnedMessage(actor, messageId);
  if (message.threadKey === null) {
    if (message.readAt !== null) return { updated: 0 };
    await db()
      .update(mailMessages)
      .set({ readAt: new Date() })
      .where(eq(mailMessages.id, messageId));
    return { updated: 1 };
  }
  const updated = await db()
    .update(mailMessages)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(mailMessages.mailboxId, mailbox.id),
        eq(mailMessages.folder, message.folder),
        eq(mailMessages.threadKey, message.threadKey),
        isNull(mailMessages.readAt),
      ),
    )
    .returning({ id: mailMessages.id });
  return { updated: updated.length };
}

// ---------------------------------------------------------------------------
// Libellés personnels
// ---------------------------------------------------------------------------

function labelView(row: MailLabelRow): MailLabel {
  return { id: row.id, name: row.name, color: row.color, createdAt: row.createdAt.toISOString() };
}

function labelRef(row: { id: string; name: string; color: string }): MessageLabelRef {
  return { id: row.id, name: row.name, color: row.color };
}

function assertLabelName(value: unknown): string {
  if (typeof value !== "string") {
    throw new MailError("validation", "Nom de libellé invalide.");
  }
  const name = value.trim().replace(/\s+/g, " ");
  if (name.length === 0) {
    throw new MailError("validation", "Le nom du libellé ne peut pas être vide.");
  }
  if (name.length > MAX_LABEL_NAME_LENGTH) {
    throw new MailError(
      "validation",
      `Le nom du libellé ne peut pas dépasser ${MAX_LABEL_NAME_LENGTH} caractères.`,
    );
  }
  return name;
}

function assertLabelColor(value: unknown): string {
  if (!isLabelColorKey(value)) {
    throw new MailError("validation", "Couleur de libellé inconnue.");
  }
  return value;
}

async function requireOwnLabel(actor: Actor, labelId: string): Promise<MailLabelRow> {
  const [row] = await db()
    .select()
    .from(mailLabels)
    .where(and(eq(mailLabels.id, labelId), eq(mailLabels.userId, actor.userId)))
    .limit(1);
  if (!row) throw new MailError("not_found", "Libellé introuvable.");
  return row;
}

/** Libellés de l'utilisateur, triés par nom (ordre stable et lisible). */
export async function listLabels(actor: Actor): Promise<MailLabel[]> {
  const rows = await db()
    .select()
    .from(mailLabels)
    .where(eq(mailLabels.userId, actor.userId))
    .orderBy(asc(mailLabels.name));
  return sortFr(rows, (row) => row.name).map(labelView);
}

/** Nombre de messages par libellé (total, puis non lus de la boîte). */
export async function listLabelCounts(
  actor: Actor,
): Promise<Record<string, { total: number; unread: number }>> {
  const mailbox = await ensureMailbox(actor);
  const rows = await db()
    .select({
      labelId: mailMessageLabels.labelId,
      total: sql<number>`count(*)`.mapWith(Number),
      unread:
        sql<number>`count(*) filter (where ${mailMessages.readAt} is null and ${mailMessages.folder} = 'inbox')`.mapWith(
          Number,
        ),
    })
    .from(mailMessageLabels)
    .innerJoin(mailMessages, eq(mailMessages.id, mailMessageLabels.messageId))
    .innerJoin(mailLabels, eq(mailLabels.id, mailMessageLabels.labelId))
    .where(and(eq(mailLabels.userId, actor.userId), eq(mailMessages.mailboxId, mailbox.id)))
    .groupBy(mailMessageLabels.labelId);

  const counts: Record<string, { total: number; unread: number }> = {};
  for (const row of rows) {
    counts[row.labelId] = { total: row.total, unread: row.unread };
  }
  return counts;
}

export async function createLabel(
  actor: Actor,
  input: { name: string; color?: string },
): Promise<MailLabel> {
  const name = assertLabelName(input.name);
  const color = assertLabelColor(input.color ?? DEFAULT_LABEL_COLOR);
  await ensureMailbox(actor);

  const existing = await db()
    .select({ id: mailLabels.id })
    .from(mailLabels)
    .where(eq(mailLabels.userId, actor.userId));
  if (existing.length >= MAX_LABELS_PER_USER) {
    throw new MailError(
      "validation",
      `${MAX_LABELS_PER_USER} libellés au maximum — supprimez-en un avant d'en créer un nouveau.`,
    );
  }

  const [created] = await db()
    .insert(mailLabels)
    .values({ orgId: actor.orgId, userId: actor.userId, name, color })
    .onConflictDoNothing()
    .returning();
  if (!created) {
    throw new MailError("conflict", `Vous avez déjà un libellé « ${name} ».`);
  }
  await recordAudit({
    orgId: actor.orgId,
    actorUserId: actor.userId,
    action: "mail.label.create",
    resourceType: "mail_label",
    resourceId: created.id,
    result: "success",
    metadata: { color },
  });
  return labelView(created);
}

/** Renomme un libellé et/ou change sa couleur. */
export async function updateLabel(
  actor: Actor,
  input: { id: string; name?: string; color?: string },
): Promise<MailLabel> {
  const label = await requireOwnLabel(actor, input.id);
  const name = input.name === undefined ? label.name : assertLabelName(input.name);
  const color = input.color === undefined ? label.color : assertLabelColor(input.color);

  if (name === label.name && color === label.color) return labelView(label);

  let updated: MailLabelRow | undefined;
  try {
    [updated] = await db()
      .update(mailLabels)
      .set({ name, color })
      .where(eq(mailLabels.id, label.id))
      .returning();
  } catch (caught) {
    // Violation d'unicité (user_id, name) : le libellé existe déjà.
    if (isUniqueViolation(caught)) {
      throw new MailError("conflict", `Vous avez déjà un libellé « ${name} ».`);
    }
    throw caught;
  }
  if (!updated) throw new MailError("not_found", "Libellé introuvable.");
  await recordAudit({
    orgId: actor.orgId,
    actorUserId: actor.userId,
    action: "mail.label.update",
    resourceType: "mail_label",
    resourceId: label.id,
    result: "success",
  });
  return labelView(updated);
}

/**
 * Supprime un libellé : les couples message/libellé disparaissent avec lui
 * (cascade), les messages restent intacts.
 */
export async function deleteLabel(actor: Actor, labelId: string): Promise<void> {
  const label = await requireOwnLabel(actor, labelId);
  await db().delete(mailLabels).where(eq(mailLabels.id, label.id));
  await recordAudit({
    orgId: actor.orgId,
    actorUserId: actor.userId,
    action: "mail.label.delete",
    resourceType: "mail_label",
    resourceId: label.id,
    result: "success",
  });
}

/**
 * Remplace la liste des libellés d'un message : l'ensemble exact est appliqué
 * (ajouts et retraits en une seule opération), l'appelant n'a pas à savoir
 * lesquels étaient déjà là.
 */
export async function setMessageLabels(
  actor: Actor,
  messageId: string,
  labelIds: string[],
): Promise<MessageLabelRef[]> {
  await requireOwnedMessage(actor, messageId);
  const requested = [...new Set(labelIds)];
  if (requested.length > MAX_LABELS_PER_MESSAGE) {
    throw new MailError("validation", `${MAX_LABELS_PER_MESSAGE} libellés au maximum par message.`);
  }

  const owned =
    requested.length === 0
      ? []
      : await db()
          .select({ id: mailLabels.id, name: mailLabels.name, color: mailLabels.color })
          .from(mailLabels)
          .where(and(eq(mailLabels.userId, actor.userId), inArray(mailLabels.id, requested)));
  if (owned.length !== requested.length) {
    throw new MailError("validation", "Un des libellés choisis n'existe pas.");
  }

  await withTransaction(async (tx) => {
    await tx.delete(mailMessageLabels).where(eq(mailMessageLabels.messageId, messageId));
    if (owned.length > 0) {
      await tx
        .insert(mailMessageLabels)
        .values(owned.map((label) => ({ messageId, labelId: label.id })));
    }
  });

  // Ordre d'affichage stable, aligné sur la liste des libellés (par nom).
  return owned
    .slice()
    .sort((left, right) => left.name.localeCompare(right.name, "fr"))
    .map(labelRef);
}

// ---------------------------------------------------------------------------
// Pièces jointes
// ---------------------------------------------------------------------------

/**
 * Téléverse une pièce jointe et renvoie un jeton provisoire (non encore lié à
 * un message) : `sendMail` le rattache au message envoyé. Les métadonnées
 * (nom, type, taille) sont portées par le jeton ; le binaire vit dans le
 * stockage sous `mail/<orgId>/<uuid>`.
 */
export async function uploadMailAttachment(
  actor: Actor,
  input: { filename: string; contentType: string; body: Buffer },
): Promise<AttachmentToken> {
  const filename = assertAttachmentFilename(input.filename);
  const contentType = assertContentType(input.contentType);
  if (input.body.length > MAX_ATTACHMENT_BYTES) {
    throw new MailError(
      "validation",
      `Pièce jointe trop volumineuse (${MAX_ATTACHMENT_BYTES / (1024 * 1024)} Mo maximum).`,
    );
  }
  const storageKey = `mail/${actor.orgId}/${randomUUID()}`;
  await getStorage().put({ key: storageKey, body: input.body, contentType });
  return { storageKey, filename, contentType, sizeBytes: input.body.length };
}

export type AttachmentDownload = {
  filename: string;
  contentType: string;
  body: Buffer;
};

/** Téléchargement d'une pièce jointe — réservé à la boîte propriétaire du message. */
export async function getAttachment(
  actor: Actor,
  attachmentId: string,
): Promise<AttachmentDownload> {
  const attachment = await requireOwnedAttachment(actor, attachmentId);
  const body = await getStorage().get(attachment.storageKey);
  if (!body) throw new MailError("not_found", "Pièce jointe introuvable.");
  return { filename: attachment.filename, contentType: attachment.contentType, body };
}

// ---------------------------------------------------------------------------
// Brouillons et envoi
// ---------------------------------------------------------------------------

/**
 * Brouillons : aucune entrée d'audit (volontaire) — écriture fréquente,
 * aucun effet externe tant que le message n'est pas envoyé ; le journal
 * d'audit ne retient que les actions engageantes (envoi, corbeille,
 * suppression, ingestion).
 */
export async function saveDraft(
  actor: Actor,
  input: {
    id?: string;
    to: string[];
    cc: string[];
    bcc?: string[];
    subject: string;
    body: string;
  },
): Promise<{ id: string }> {
  const mailbox = await ensureMailbox(actor);
  const { to, cc, bcc } = assertRecipients(input, { requireTo: false });
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
        bccAddresses: bcc,
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
      bccAddresses: bcc,
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
  input: {
    id?: string;
    to: string[];
    cc: string[];
    bcc?: string[];
    subject: string;
    body: string;
    /** Jetons d'upload (uploadMailAttachment) à rattacher au message envoyé. */
    attachments?: AttachmentToken[];
  },
): Promise<{ id: string; sendError: string | null }> {
  const mailbox = await ensureMailbox(actor);
  const { to, cc, bcc } = assertRecipients(input, { requireTo: true });
  const subject = assertSubject(input.subject);
  const body = assertBodyLength(
    input.body,
    MAX_BODY_LENGTH,
    "Le corps du message ne peut pas dépasser 100 000 caractères.",
  );
  const attachments = assertAttachmentTokens(actor, input.attachments ?? []);

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
        bccAddresses: bcc,
        subject,
        threadKey: computeThreadKey(subject),
        body,
        readAt: new Date(),
        sentAt: new Date(),
      })
      .returning({ id: mailMessages.id });
    if (!sent) throw new MailError("validation", "Envoi impossible.");
    // Les pièces jointes sont rattachées dans la même transaction que le
    // message : pas de message envoyé sans ses pièces, pas de pièces orphelines.
    if (attachments.length > 0) {
      await tx.insert(mailAttachments).values(
        attachments.map((attachment) => ({
          messageId: sent.id,
          storageKey: attachment.storageKey,
          filename: attachment.filename,
          contentType: attachment.contentType,
          sizeBytes: attachment.sizeBytes,
        })),
      );
    }
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
        // Les copies cachées partent dans l'enveloppe SMTP, jamais dans les
        // en-têtes visibles : nodemailer les place dans `bcc`.
        bcc: bcc.length > 0 ? bcc.join(", ") : undefined,
        subject: subject || "(sans objet)",
        text: body,
      });
    } catch (caught) {
      const detail = caught instanceof Error ? caught.message : "erreur inconnue";
      sendError = `Échec SMTP : ${detail} — le message reste dans « Envoyés », vous pouvez le renvoyer.`;
    }
  }

  if (sendError) {
    await db().update(mailMessages).set({ sendError }).where(eq(mailMessages.id, sentId));
  }

  await recordAudit({
    orgId: actor.orgId,
    actorUserId: actor.userId,
    action: "mail.message.send",
    resourceType: "mail_message",
    resourceId: sentId,
    result: "success",
    metadata: { to: to.length },
  });
  return { id: sentId, sendError };
}

// ---------------------------------------------------------------------------
// Archives
// ---------------------------------------------------------------------------

/**
 * Archive un message de la boîte de réception (ou des « Envoyés ») : il quitte
 * la liste principale sans être détruit, et retrouve son dossier d'origine à la
 * restauration. La corbeille et les brouillons ne sont jamais archivables.
 */
export async function archiveMessage(actor: Actor, messageId: string): Promise<void> {
  const { message } = await requireOwnedMessage(actor, messageId);
  const folder = message.folder as FolderKey;
  if (folder === "archive") return;
  if (!ARCHIVABLE.includes(folder)) {
    throw new MailError(
      "validation",
      folder === "trash"
        ? "Un message à la corbeille ne peut pas être archivé."
        : "Seuls les messages reçus ou envoyés peuvent être archivés.",
    );
  }
  await db()
    .update(mailMessages)
    .set({ folder: "archive", trashedFrom: folder })
    .where(eq(mailMessages.id, messageId));
  await recordAudit({
    orgId: actor.orgId,
    actorUserId: actor.userId,
    action: "mail.message.archive",
    resourceType: "mail_message",
    resourceId: messageId,
    result: "success",
    metadata: { from: folder },
  });
}

/** Sort un message des archives vers son dossier d'origine (boîte par défaut). */
export async function unarchiveMessage(actor: Actor, messageId: string): Promise<void> {
  const { message } = await requireOwnedMessage(actor, messageId);
  if (message.folder !== "archive") return;
  await db()
    .update(mailMessages)
    .set({ folder: originFolder(message.trashedFrom), trashedFrom: null })
    .where(eq(mailMessages.id, messageId));
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
  await recordAudit({
    orgId: actor.orgId,
    actorUserId: actor.userId,
    action: "mail.message.trash",
    resourceType: "mail_message",
    resourceId: messageId,
    result: "success",
  });
}

export async function restoreMessage(actor: Actor, messageId: string): Promise<void> {
  const { message } = await requireOwnedMessage(actor, messageId);
  if (message.folder !== "trash") return;
  await db()
    .update(mailMessages)
    .set({ folder: originFolder(message.trashedFrom), trashedFrom: null })
    .where(eq(mailMessages.id, messageId));
}

export async function deleteMessage(actor: Actor, messageId: string): Promise<void> {
  const { message } = await requireOwnedMessage(actor, messageId);
  if (message.folder !== "trash") {
    throw new MailError("validation", "Le message doit d'abord être mis à la corbeille.");
  }
  await db().delete(mailMessages).where(eq(mailMessages.id, messageId));
  await recordAudit({
    orgId: actor.orgId,
    actorUserId: actor.userId,
    action: "mail.message.delete",
    resourceType: "mail_message",
    resourceId: messageId,
    result: "success",
  });
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
  /**
   * Pièces jointes encodées en base64 (≤ 5, ≤ 5 Mio décodés chacune) :
   * stockées puis rattachées au message entrant. Les éléments sont validés à
   * l'exécution (entrée webhook non fiable).
   */
  attachments?: unknown[];
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

  // Validation complète des pièces jointes AVANT toute écriture : un contenu
  // invalide ne doit jamais laisser de message ni de blob derrière lui.
  const inboundAttachments = payload.attachments ?? [];
  if (!Array.isArray(inboundAttachments)) {
    throw new MailError("validation", "Pièces jointes invalides.");
  }
  if (inboundAttachments.length > MAX_ATTACHMENTS) {
    throw new MailError("validation", `${MAX_ATTACHMENTS} pièces jointes au maximum.`);
  }
  const preparedAttachments = inboundAttachments.map((raw) => {
    const attachment = (raw ?? {}) as {
      filename?: unknown;
      contentType?: unknown;
      contentBase64?: unknown;
    };
    return {
      filename: assertAttachmentFilename(attachment.filename),
      contentType: assertContentType(attachment.contentType),
      body: decodeAttachmentBase64(attachment.contentBase64),
    };
  });

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

  let messageId: string | null = created?.id ?? null;

  if (!messageId && externalId.length > 0) {
    // Insertion ignorée : un message portant le même externalId existe déjà.
    const [existing] = await db()
      .select({ id: mailMessages.id })
      .from(mailMessages)
      .where(eq(mailMessages.externalId, externalId))
      .limit(1);
    messageId = existing?.id ?? null;
  }
  if (!messageId) throw new MailError("validation", "Ingestion impossible.");

  if (created && preparedAttachments.length > 0) {
    // Nettoyage des blobs déjà écrits si la liaison échoue (pas d'orphelins).
    const storedKeys: string[] = [];
    try {
      for (const attachment of preparedAttachments) {
        const storageKey = `mail/${mailbox.orgId}/${randomUUID()}`;
        await getStorage().put({
          key: storageKey,
          body: attachment.body,
          contentType: attachment.contentType,
        });
        storedKeys.push(storageKey);
        await db().insert(mailAttachments).values({
          messageId,
          storageKey,
          filename: attachment.filename,
          contentType: attachment.contentType,
          sizeBytes: attachment.body.length,
        });
      }
    } catch (error) {
      await Promise.all(
        storedKeys.map((key) =>
          getStorage()
            .delete(key)
            .catch(() => undefined),
        ),
      );
      throw error;
    }
  }

  await recordAudit({
    orgId: mailbox.orgId,
    actorUserId: null,
    action: "mail.message.inbound",
    resourceType: "mail_message",
    resourceId: messageId,
    result: "success",
  });
  return { id: messageId };
}
