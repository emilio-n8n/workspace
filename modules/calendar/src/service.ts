import { recordAudit } from "@workspace/audit";
import { schema as core, getDb, withTransaction } from "@workspace/database";
import type { Actor } from "@workspace/permissions";
import { and, asc, eq, gt, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";
import {
  type CalendarEventRow,
  type CalendarRow,
  calendarAttendees,
  calendarEvents,
  calendars,
} from "./schema.ts";

export type CalendarErrorCode = "not_found" | "forbidden" | "validation" | "conflict";

export class CalendarError extends Error {
  readonly code: CalendarErrorCode;
  constructor(code: CalendarErrorCode, message: string) {
    super(message);
    this.name = "CalendarError";
    this.code = code;
  }
}

/** Plage maximale interrogeable en une requête (garde-fou anti-DoS). */
const MAX_RANGE_MS = 366 * 24 * 60 * 60 * 1000;

/** Nombre maximal d'événements renvoyés par {@link listEvents}. */
const MAX_EVENTS = 2000;

/** Délai d'une journée en millisecondes (événements « journée entière »). */
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Nombre maximal d'occurrences développées par événement récurrent et par
 * requête (garde-fou anti-DoS ; au-delà, les occurrences suivantes de la plage
 * ne sont pas renvoyées).
 */
const MAX_OCCURRENCES_PER_EVENT = 100;

/** Durée maximale d'une série récurrente : 2 ans calendaires après le début. */
const MAX_RECURRENCE_MONTHS = 24;

/** Intervalle de répétition : au moins une unité, au plus 52 (une année). */
export const RECURRENCE_INTERVAL_MIN = 1;
export const RECURRENCE_INTERVAL_MAX = 52;

/** Valeurs acceptées pour `calendar_events.recurrence`. */
export type Recurrence = "none" | "daily" | "weekly" | "monthly";

type ActiveRecurrence = Exclude<Recurrence, "none">;

const RECURRENCES: readonly Recurrence[] = ["none", "daily", "weekly", "monthly"];

function isRecurrence(value: unknown): value is Recurrence {
  return typeof value === "string" && (RECURRENCES as readonly string[]).includes(value);
}

/** Valeur stockée → type public (une valeur inconnue retombe sur « aucune »). */
function asRecurrence(value: string): Recurrence {
  return isRecurrence(value) ? value : "none";
}

/** Intervalle stocké → nombre de périodes entre deux occurrences. */
function asInterval(value: number): number {
  return Number.isFinite(value) && value >= RECURRENCE_INTERVAL_MIN
    ? Math.min(Math.trunc(value), RECURRENCE_INTERVAL_MAX)
    : RECURRENCE_INTERVAL_MIN;
}

const PRIMARY_CALENDAR_NAME = "Mon agenda";

export type AttendanceStatus = "invited" | "accepted" | "declined";

export type CalendarView = {
  id: string;
  name: string;
  isOrg: boolean;
  isMine: boolean;
};

export type AttendeeView = {
  id: string;
  email: string;
  userId: string | null;
  name: string | null;
  status: string;
};

export type EventView = {
  id: string;
  calendarId: string;
  calendarName: string;
  title: string;
  description: string | null;
  location: string | null;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  /** Récurrence de la série (`none` pour un événement simple). */
  recurrence: Recurrence;
  /**
   * Intervalle entre deux occurrences, en unités de `recurrence` : `1` pour
   * toutes les semaines, `3` pour toutes les trois semaines. `1` pour un
   * événement simple.
   */
  recurrenceInterval: number;
  /** Fin de la série (incluse), `null` pour un événement simple. */
  recurrenceUntil: string | null;
  /**
   * `true` pour toute occurrence d'une série récurrente. Chaque occurrence
   * porte l'identifiant de la série (l'édition affecte la série entière).
   */
  recurring: boolean;
  createdBy: string;
  canEdit: boolean;
  /** Réponse de l'acteur s'il est invité (`null` sinon). */
  myStatus: AttendanceStatus | null;
  attendees: AttendeeView[];
};

export type EventInput = {
  calendarId?: string | null;
  title: string;
  description?: string | null;
  location?: string | null;
  startsAt: string;
  endsAt: string;
  allDay?: boolean;
  attendees?: string[];
  /** Récurrence simple : `none` (défaut), `daily`, `weekly` ou `monthly`. */
  recurrence?: Recurrence;
  /**
   * Intervalle entre deux occurrences (1 par défaut) : `2` avec `weekly`
   * signifie « toutes les deux semaines ». Ignoré si `recurrence` vaut `none`.
   */
  recurrenceInterval?: number;
  /**
   * Dernière date (incluse) de la série. Obligatoire dès que `recurrence`
   * n'est pas `none`, comprise entre `startsAt` et `startsAt` + 2 ans.
   */
  recurrenceUntil?: string | null;
};

const db = () => getDb();

/** Violation de contrainte d'unicité PostgreSQL (23505), y compris encapsulée par Drizzle. */
function isUniqueViolation(error: unknown): boolean {
  const candidate = error as { code?: string; cause?: { code?: string } };
  return candidate?.code === "23505" || candidate?.cause?.code === "23505";
}

/**
 * Les événements « journée entière » sont stockés en instants DATE seule : le
 * début est le minuit UTC du jour choisi, la fin le minuit UTC du lendemain.
 * Les plages sur plusieurs jours restent hors périmètre.
 */
function normalizeAllDayRange(
  range: { startsAt: Date; endsAt: Date },
  allDay: boolean,
): { startsAt: Date; endsAt: Date } {
  if (!allDay) return range;
  const startsAt = new Date(
    Date.UTC(
      range.startsAt.getUTCFullYear(),
      range.startsAt.getUTCMonth(),
      range.startsAt.getUTCDate(),
    ),
  );
  return { startsAt, endsAt: new Date(startsAt.getTime() + ONE_DAY_MS) };
}

function assertTitle(title: string): string {
  const trimmed = title.trim();
  if (trimmed.length < 1 || trimmed.length > 255) {
    throw new CalendarError("validation", "Le titre doit contenir entre 1 et 255 caractères.");
  }
  return trimmed;
}

function assertRange(startsAt: string, endsAt: string): { startsAt: Date; endsAt: Date } {
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new CalendarError("validation", "Dates invalides.");
  }
  if (end.getTime() <= start.getTime()) {
    throw new CalendarError("validation", "La fin doit être après le début.");
  }
  return { startsAt: start, endsAt: end };
}

// ---------------------------------------------------------------------------
// Récurrence simple (aucune dérogation par occurrence : toute modification ou
// suppression porte sur la série entière)
// ---------------------------------------------------------------------------

/**
 * Décale un instant de `count` mois calendaires UTC. Le jour est **borné**
 * (clampé) au dernier jour du mois cible : le 31 janvier devient le 28/29
 * février, puis le 31 mars (le jour d'origine est mémorisé, pas celui de
 * l'occurrence précédente).
 */
function addUtcMonths(date: Date, count: number): Date {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + count;
  const daysInTarget = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(
    Date.UTC(
      year,
      month,
      Math.min(date.getUTCDate(), daysInTarget),
      date.getUTCHours(),
      date.getUTCMinutes(),
      date.getUTCSeconds(),
      date.getUTCMilliseconds(),
    ),
  );
}

/** Début de la n-ième occurrence (`index` = 0 : l'événement stocké lui-même). */
function occurrenceStart(
  base: Date,
  recurrence: ActiveRecurrence,
  interval: number,
  index: number,
): Date {
  // Quotidien / hebdomadaire : décalage en millisecondes (UTC, sans heure d'été).
  if (recurrence === "daily") return new Date(base.getTime() + index * interval * ONE_DAY_MS);
  if (recurrence === "weekly") {
    return new Date(base.getTime() + index * interval * 7 * ONE_DAY_MS);
  }
  return addUtcMonths(base, index * interval);
}

/**
 * Indice de la première occurrence à examiner pour une plage dont la borne
 * basse vaut `thresholdMs` (= `from` moins la durée de l'événement, afin
 * d'inclure une occurrence à cheval). L'arithmétique directe évite de boucler
 * depuis la première occurrence quand la série a commencé loin avant la plage.
 */
function firstOccurrenceIndex(
  base: Date,
  recurrence: ActiveRecurrence,
  interval: number,
  thresholdMs: number,
): number {
  const baseMs = base.getTime();
  if (baseMs > thresholdMs) return 0;
  if (recurrence === "daily") {
    return Math.floor((thresholdMs - baseMs) / (interval * ONE_DAY_MS)) + 1;
  }
  if (recurrence === "weekly") {
    return Math.floor((thresholdMs - baseMs) / (interval * 7 * ONE_DAY_MS)) + 1;
  }
  // Mensuel : estimation par différence de mois, puis ajustement borné
  // (le clamp de fin de mois rend le pas non linéaire).
  const threshold = new Date(thresholdMs);
  const months =
    (threshold.getUTCFullYear() - base.getUTCFullYear()) * 12 +
    (threshold.getUTCMonth() - base.getUTCMonth());
  let index = Math.max(0, Math.floor(months / interval));
  while (
    index > 0 &&
    occurrenceStart(base, recurrence, interval, index - 1).getTime() > thresholdMs
  ) {
    index -= 1;
  }
  while (occurrenceStart(base, recurrence, interval, index).getTime() <= thresholdMs) {
    index += 1;
  }
  return index;
}

/** Occurrences d'un événement qui recouvrent la plage [`fromMs`, `toMs`). */
function expandOccurrences(
  row: {
    startsAt: Date;
    endsAt: Date;
    recurrence: Recurrence;
    recurrenceInterval: number;
    recurrenceUntil: Date | null;
  },
  fromMs: number,
  toMs: number,
): { startsAt: Date; endsAt: Date }[] {
  const durationMs = row.endsAt.getTime() - row.startsAt.getTime();
  if (row.recurrence === "none") {
    return row.startsAt.getTime() < toMs && row.endsAt.getTime() > fromMs
      ? [{ startsAt: row.startsAt, endsAt: row.endsAt }]
      : [];
  }

  const interval = asInterval(row.recurrenceInterval);
  const untilMs = row.recurrenceUntil?.getTime() ?? Number.POSITIVE_INFINITY;
  const occurrences: { startsAt: Date; endsAt: Date }[] = [];
  for (
    let index = firstOccurrenceIndex(row.startsAt, row.recurrence, interval, fromMs - durationMs);
    occurrences.length < MAX_OCCURRENCES_PER_EVENT;
    index += 1
  ) {
    const startsAt = occurrenceStart(row.startsAt, row.recurrence, interval, index);
    // Fin de série (début d'occurrence borné par `recurrenceUntil`) ou fin de
    // plage : les débuts croissent, on peut s'arrêter.
    if (startsAt.getTime() > untilMs || startsAt.getTime() >= toMs) break;
    const endsAt = new Date(startsAt.getTime() + durationMs);
    if (endsAt.getTime() > fromMs) occurrences.push({ startsAt, endsAt });
  }
  return occurrences;
}

/** Valide la récurrence, son intervalle et sa fin, et normalise les valeurs persistées. */
function assertRecurrence(
  recurrence: Recurrence,
  interval: number | undefined,
  until: string | null | undefined,
  startsAt: Date,
): { recurrence: Recurrence; recurrenceInterval: number; recurrenceUntil: Date | null } {
  if (!isRecurrence(recurrence)) {
    throw new CalendarError("validation", "Récurrence invalide.");
  }
  const recurrenceInterval = assertInterval(interval);
  // Sans répétition, l'intervalle n'a pas de sens : il est ramené à 1.
  if (recurrence === "none") {
    return { recurrence, recurrenceInterval: RECURRENCE_INTERVAL_MIN, recurrenceUntil: null };
  }

  const raw = until?.trim() ?? "";
  if (raw.length === 0) {
    throw new CalendarError("validation", "La date de fin de répétition est requise.");
  }
  const end = new Date(raw);
  if (Number.isNaN(end.getTime())) {
    throw new CalendarError("validation", "Date de fin de répétition invalide.");
  }
  if (end.getTime() < startsAt.getTime()) {
    throw new CalendarError("validation", "La fin de répétition doit suivre le début.");
  }
  if (end.getTime() > addUtcMonths(startsAt, MAX_RECURRENCE_MONTHS).getTime()) {
    throw new CalendarError("validation", "La répétition ne peut pas dépasser 2 ans.");
  }
  return { recurrence, recurrenceInterval, recurrenceUntil: end };
}

/** Valide l'intervalle de répétition (1 à 52 unités de la fréquence). */
function assertInterval(interval: number | undefined): number {
  if (interval === undefined) return RECURRENCE_INTERVAL_MIN;
  if (
    !Number.isInteger(interval) ||
    interval < RECURRENCE_INTERVAL_MIN ||
    interval > RECURRENCE_INTERVAL_MAX
  ) {
    throw new CalendarError(
      "validation",
      `L'intervalle de répétition doit être un nombre entier entre ${RECURRENCE_INTERVAL_MIN} et ${RECURRENCE_INTERVAL_MAX}.`,
    );
  }
  return interval;
}

function clean(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeEmails(emails: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of emails) {
    const email = raw.trim().toLowerCase();
    if (email.length === 0 || seen.has(email)) continue;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new CalendarError("validation", `Adresse e-mail invalide : ${raw}`);
    }
    seen.add(email);
    result.push(email);
  }
  if (result.length > 50) {
    throw new CalendarError("validation", "50 invités au maximum.");
  }
  return result;
}

async function actorEmail(actor: Actor): Promise<string> {
  const [row] = await db()
    .select({ email: core.user.email })
    .from(core.user)
    .where(eq(core.user.id, actor.userId))
    .limit(1);
  return (row?.email ?? "").toLowerCase();
}

// ---------------------------------------------------------------------------
// Agendas
// ---------------------------------------------------------------------------

/** Agenda personnel de l'acteur (créé à la première utilisation). */
export async function ensurePrimaryCalendar(actor: Actor): Promise<string> {
  const [existing] = await db()
    .select({ id: calendars.id })
    .from(calendars)
    .where(
      and(
        eq(calendars.orgId, actor.orgId),
        eq(calendars.ownerId, actor.userId),
        eq(calendars.name, PRIMARY_CALENDAR_NAME),
      ),
    )
    .orderBy(asc(calendars.createdAt))
    .limit(1);
  if (existing) return existing.id;

  return withTransaction(async (tx) => {
    const [created] = await tx
      .insert(calendars)
      .values({ orgId: actor.orgId, ownerId: actor.userId, name: PRIMARY_CALENDAR_NAME })
      .onConflictDoNothing({ target: [calendars.orgId, calendars.ownerId, calendars.name] })
      .returning({ id: calendars.id });
    if (created) return created.id;

    // Insertion concurrente : l'agenda vient d'être créé par quelqu'un d'autre.
    const [row] = await tx
      .select({ id: calendars.id })
      .from(calendars)
      .where(
        and(
          eq(calendars.orgId, actor.orgId),
          eq(calendars.ownerId, actor.userId),
          eq(calendars.name, PRIMARY_CALENDAR_NAME),
        ),
      )
      .orderBy(asc(calendars.createdAt))
      .limit(1);
    if (!row) throw new CalendarError("conflict", "Création de l'agenda impossible.");
    return row.id;
  });
}

/** Agendas visibles : les miens et ceux de l'organisation. */
export async function listCalendars(actor: Actor): Promise<CalendarView[]> {
  const rows = await db()
    .select()
    .from(calendars)
    .where(
      and(
        eq(calendars.orgId, actor.orgId),
        or(eq(calendars.ownerId, actor.userId), isNull(calendars.ownerId)),
      ),
    )
    .orderBy(asc(calendars.createdAt));
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    isOrg: row.ownerId === null,
    isMine: row.ownerId === actor.userId,
  }));
}

/** Crée un agenda (personnel ou partagé avec toute l'organisation). */
export async function createCalendar(
  actor: Actor,
  input: { name: string; shared?: boolean },
): Promise<CalendarView> {
  const name = input.name.trim();
  if (name.length < 1 || name.length > 120) {
    throw new CalendarError("validation", "Le nom doit contenir entre 1 et 120 caractères.");
  }
  if (input.shared) {
    // L'index unique (org, propriétaire, nom) ne couvre pas les agendas
    // partagés (propriétaire NULL : les NULL sont distincts en SQL).
    const [duplicate] = await db()
      .select({ id: calendars.id })
      .from(calendars)
      .where(
        and(eq(calendars.orgId, actor.orgId), isNull(calendars.ownerId), eq(calendars.name, name)),
      )
      .limit(1);
    if (duplicate) throw new CalendarError("conflict", "Un agenda porte déjà ce nom.");
  }
  let created: CalendarRow | undefined;
  try {
    [created] = await db()
      .insert(calendars)
      .values({
        orgId: actor.orgId,
        ownerId: input.shared ? null : actor.userId,
        name,
      })
      .returning();
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new CalendarError("conflict", "Un agenda porte déjà ce nom.");
    }
    throw error;
  }
  if (!created) throw new CalendarError("validation", "Création de l'agenda impossible.");
  await recordAudit({
    orgId: actor.orgId,
    actorUserId: actor.userId,
    action: "calendar.calendar.create",
    resourceType: "calendar",
    resourceId: created.id,
    result: "success",
  });
  return {
    id: created.id,
    name: created.name,
    isOrg: created.ownerId === null,
    isMine: created.ownerId === actor.userId,
  };
}

async function requireCalendarForWrite(actor: Actor, calendarId: string): Promise<CalendarRow> {
  const [row] = await db().select().from(calendars).where(eq(calendars.id, calendarId)).limit(1);
  if (!row || row.orgId !== actor.orgId) {
    throw new CalendarError("not_found", "Agenda introuvable.");
  }
  if (row.ownerId !== null && row.ownerId !== actor.userId) {
    throw new CalendarError("forbidden", "Cet agenda est privé.");
  }
  return row;
}

// ---------------------------------------------------------------------------
// Événements
// ---------------------------------------------------------------------------

async function hydrate(
  actor: Actor,
  rows: CalendarEventRow[],
  myEmail: string,
): Promise<EventView[]> {
  if (rows.length === 0) return [];

  const calendarIds = [...new Set(rows.map((row) => row.calendarId))];
  const calendarRows = await db()
    .select()
    .from(calendars)
    .where(inArray(calendars.id, calendarIds));
  const calendarById = new Map(calendarRows.map((row) => [row.id, row]));

  const eventIds = rows.map((row) => row.id);
  const attendeeRows = await db()
    .select({
      id: calendarAttendees.id,
      eventId: calendarAttendees.eventId,
      email: calendarAttendees.email,
      userId: calendarAttendees.userId,
      status: calendarAttendees.status,
      name: core.user.name,
    })
    .from(calendarAttendees)
    .leftJoin(core.user, eq(core.user.id, calendarAttendees.userId))
    .where(inArray(calendarAttendees.eventId, eventIds))
    .orderBy(asc(calendarAttendees.createdAt));

  const attendeesByEvent = new Map<string, AttendeeView[]>();
  for (const row of attendeeRows) {
    const list = attendeesByEvent.get(row.eventId) ?? [];
    list.push({
      id: row.id,
      email: row.email,
      userId: row.userId,
      name: row.name ?? null,
      status: row.status,
    });
    attendeesByEvent.set(row.eventId, list);
  }

  return rows.map((row) => {
    const calendar = calendarById.get(row.calendarId);
    // Fail-closed : sans agenda lisible, l'édition est refusée.
    const canEdit = calendar
      ? row.createdBy === actor.userId ||
        calendar.ownerId === null ||
        calendar.ownerId === actor.userId
      : false;
    const mine = (attendeesByEvent.get(row.id) ?? []).find(
      (attendee) => attendee.userId === actor.userId || attendee.email === myEmail,
    );
    return {
      id: row.id,
      calendarId: row.calendarId,
      calendarName: calendar?.name ?? "Agenda",
      title: row.title,
      description: row.description,
      location: row.location,
      startsAt: row.startsAt.toISOString(),
      endsAt: row.endsAt.toISOString(),
      allDay: row.allDay,
      recurrence: asRecurrence(row.recurrence),
      recurrenceInterval: asInterval(row.recurrenceInterval),
      recurrenceUntil: row.recurrenceUntil ? row.recurrenceUntil.toISOString() : null,
      recurring: row.recurrence !== "none",
      createdBy: row.createdBy,
      canEdit,
      myStatus: (mine?.status as AttendanceStatus | undefined) ?? null,
      attendees: attendeesByEvent.get(row.id) ?? [],
    };
  });
}

/**
 * Événements visibles dans une plage (agendas visibles + invitations).
 *
 * Les séries récurrentes sont développées en occurrences : chaque occurrence
 * reprend l'identifiant de la série (les clics et le détail fonctionnent
 * toujours), avec des bornes décalées, `recurring: true` et la récurrence
 * d'origine. Limites assumées : 100 occurrences par événement et par requête ;
 * modifier ou supprimer un événement récurrent affecte toute la série (pas de
 * dérogation par occurrence).
 */
export async function listEvents(
  actor: Actor,
  input: { from: string; to: string },
): Promise<EventView[]> {
  const from = new Date(input.from);
  const to = new Date(input.to);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from) {
    throw new CalendarError("validation", "Plage de dates invalide.");
  }
  if (to.getTime() - from.getTime() > MAX_RANGE_MS) {
    throw new CalendarError("validation", "La plage de dates ne peut pas dépasser 366 jours.");
  }

  const myEmail = await actorEmail(actor);
  const visibleCalendars = await db()
    .select({ id: calendars.id })
    .from(calendars)
    .where(
      and(
        eq(calendars.orgId, actor.orgId),
        or(eq(calendars.ownerId, actor.userId), isNull(calendars.ownerId)),
      ),
    );
  const calendarIds = visibleCalendars.map((row) => row.id);

  const invited = await db()
    .select({ eventId: calendarAttendees.eventId })
    .from(calendarAttendees)
    .where(or(eq(calendarAttendees.userId, actor.userId), eq(calendarAttendees.email, myEmail)));
  const invitedIds = invited.map((row) => row.eventId);

  if (calendarIds.length === 0 && invitedIds.length === 0) return [];

  const visibility =
    calendarIds.length > 0 && invitedIds.length > 0
      ? or(inArray(calendarEvents.calendarId, calendarIds), inArray(calendarEvents.id, invitedIds))
      : calendarIds.length > 0
        ? inArray(calendarEvents.calendarId, calendarIds)
        : inArray(calendarEvents.id, invitedIds);

  // Cloisonnement par organisation : une invitation croisée ne doit jamais
  // exposer l'événement d'une autre organisation (branches agendas ET invités).
  const rows = await db()
    .select()
    .from(calendarEvents)
    .where(
      and(
        eq(calendarEvents.orgId, actor.orgId),
        visibility,
        // Aucune occurrence ne peut démarrer après la fin de la plage.
        lt(calendarEvents.startsAt, to),
        or(
          // Événement simple (ou première occurrence d'une série) : intervalle
          // semi-ouvert [startsAt, endsAt) — un événement qui touche exactement
          // une borne n'est pas dupliqué entre deux plages adjacentes.
          gt(calendarEvents.endsAt, from),
          // Série récurrente : une occurrence ultérieure peut tomber dans la
          // plage même si la première est antérieure. Dernière occurrence
          // possible = `recurrenceUntil` ; elle recouvre la plage tant que
          // « recurrenceUntil + durée > from » (la suite est filtrée en
          // mémoire par expandOccurrences).
          and(
            ne(calendarEvents.recurrence, "none"),
            sql`(${calendarEvents.recurrenceUntil} is null or ${calendarEvents.recurrenceUntil} + (${calendarEvents.endsAt} - ${calendarEvents.startsAt}) > ${from})`,
          ),
        ),
      ),
    )
    .orderBy(asc(calendarEvents.startsAt))
    .limit(MAX_EVENTS);

  const views = await hydrate(actor, rows, myEmail);

  // Développement des occurrences. La ligne stockée est la première occurrence
  // (index 0) : `expandOccurrences` la renvoie telle quelle quand la plage la
  // couvre, sans dupliquer le travail de `hydrate`.
  const expanded = views.flatMap((view) =>
    expandOccurrences(
      {
        startsAt: new Date(view.startsAt),
        endsAt: new Date(view.endsAt),
        recurrence: view.recurrence,
        recurrenceInterval: view.recurrenceInterval,
        recurrenceUntil: view.recurrenceUntil ? new Date(view.recurrenceUntil) : null,
      },
      from.getTime(),
      to.getTime(),
    ).map((occurrence) => ({
      ...view,
      startsAt: occurrence.startsAt.toISOString(),
      endsAt: occurrence.endsAt.toISOString(),
      recurring: view.recurrence !== "none",
    })),
  );

  // Les occurrences de plusieurs séries s'entrelacent : tri chronologique puis
  // plafond global (garde-fou anti-DoS, comme la requête SQL).
  expanded.sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
  return expanded.slice(0, MAX_EVENTS);
}

/** Événement visible : agenda visible ou invitation nominative. */
export async function getEvent(actor: Actor, eventId: string): Promise<EventView> {
  const [row] = await db()
    .select()
    .from(calendarEvents)
    .where(eq(calendarEvents.id, eventId))
    .limit(1);
  if (!row || row.orgId !== actor.orgId) {
    throw new CalendarError("not_found", "Événement introuvable.");
  }

  const myEmail = await actorEmail(actor);
  const [calendar] = await db()
    .select()
    .from(calendars)
    .where(eq(calendars.id, row.calendarId))
    .limit(1);
  const [invite] = await db()
    .select({ id: calendarAttendees.id })
    .from(calendarAttendees)
    .where(
      and(
        eq(calendarAttendees.eventId, eventId),
        or(eq(calendarAttendees.userId, actor.userId), eq(calendarAttendees.email, myEmail)),
      ),
    )
    .limit(1);

  const visible =
    (calendar && (calendar.ownerId === null || calendar.ownerId === actor.userId)) ||
    Boolean(invite);
  if (!visible) {
    throw new CalendarError("not_found", "Événement introuvable.");
  }

  const [view] = await hydrate(actor, [row], myEmail);
  if (!view) throw new CalendarError("not_found", "Événement introuvable.");
  return view;
}

export async function createEvent(actor: Actor, input: EventInput): Promise<EventView> {
  const title = assertTitle(input.title);
  const allDay = input.allDay ?? false;
  const range = normalizeAllDayRange(assertRange(input.startsAt, input.endsAt), allDay);
  const calendarId = input.calendarId ?? (await ensurePrimaryCalendar(actor));
  await requireCalendarForWrite(actor, calendarId);

  const recurrence = assertRecurrence(
    input.recurrence ?? "none",
    input.recurrenceInterval,
    input.recurrenceUntil,
    range.startsAt,
  );
  const emails = normalizeEmails(input.attendees ?? []);

  // L'événement et ses invités sont créés atomiquement : jamais d'événement
  // orphelin ni d'invités sans événement.
  const eventId = await withTransaction(async (tx) => {
    const [created] = await tx
      .insert(calendarEvents)
      .values({
        orgId: actor.orgId,
        calendarId,
        title,
        description: clean(input.description),
        location: clean(input.location),
        startsAt: range.startsAt,
        endsAt: range.endsAt,
        allDay,
        recurrence: recurrence.recurrence,
        recurrenceInterval: recurrence.recurrenceInterval,
        recurrenceUntil: recurrence.recurrenceUntil,
        createdBy: actor.userId,
      })
      .returning({ id: calendarEvents.id });
    if (!created) throw new CalendarError("validation", "Création de l'événement impossible.");

    if (emails.length > 0) {
      const members = await tx
        .select({ id: core.user.id, email: core.user.email })
        .from(core.user)
        .innerJoin(
          core.member,
          and(eq(core.member.userId, core.user.id), eq(core.member.organizationId, actor.orgId)),
        );
      const userIdByEmail = new Map(
        members.map((member) => [member.email.toLowerCase(), member.id]),
      );

      await tx.insert(calendarAttendees).values(
        emails.map((email) => ({
          eventId: created.id,
          userId: userIdByEmail.get(email) ?? null,
          email,
          status: "invited",
        })),
      );
    }

    return created.id;
  });

  await recordAudit({
    orgId: actor.orgId,
    actorUserId: actor.userId,
    action: "calendar.event.create",
    resourceType: "calendar_event",
    resourceId: eventId,
    result: "success",
  });

  return getEvent(actor, eventId);
}

/**
 * Modifie un événement. Pour une série récurrente, la modification porte sur
 * **toute la série** : il n'existe pas de dérogation par occurrence.
 */
export async function updateEvent(
  actor: Actor,
  eventId: string,
  patch: Partial<EventInput>,
): Promise<EventView> {
  if (patch.attendees !== undefined) {
    throw new CalendarError("validation", "Les invités ne sont pas modifiables après création.");
  }
  if (patch.calendarId !== undefined) {
    throw new CalendarError("validation", "L'agenda n'est pas modifiable après création.");
  }

  const existing = await getEvent(actor, eventId);
  if (!existing.canEdit) {
    throw new CalendarError("forbidden", "Permission insuffisante pour modifier cet événement.");
  }

  // Un seul côté fourni : fusion avec la ligne existante puis validation de la
  // plage résultante ; les deux bornes sont persistées ensemble.
  const startsAt = patch.startsAt ?? existing.startsAt;
  const endsAt = patch.endsAt ?? existing.endsAt;
  const allDay = patch.allDay ?? existing.allDay;
  const rangeTouched =
    patch.startsAt !== undefined || patch.endsAt !== undefined || patch.allDay !== undefined;
  const range = rangeTouched ? normalizeAllDayRange(assertRange(startsAt, endsAt), allDay) : null;

  // La récurrence se valide contre le début résultant (le déplacement d'une
  // série ne peut pas la faire sortir de sa fenêtre de fin).
  const recurrence = assertRecurrence(
    patch.recurrence ?? existing.recurrence,
    patch.recurrenceInterval ?? existing.recurrenceInterval,
    patch.recurrenceUntil !== undefined ? patch.recurrenceUntil : existing.recurrenceUntil,
    range ? range.startsAt : new Date(existing.startsAt),
  );

  const [updated] = await db()
    .update(calendarEvents)
    .set({
      ...(patch.title !== undefined ? { title: assertTitle(patch.title) } : {}),
      ...(patch.description !== undefined ? { description: clean(patch.description) } : {}),
      ...(patch.location !== undefined ? { location: clean(patch.location) } : {}),
      ...(range ? { startsAt: range.startsAt, endsAt: range.endsAt } : {}),
      ...(patch.allDay !== undefined ? { allDay: patch.allDay } : {}),
      recurrence: recurrence.recurrence,
      recurrenceInterval: recurrence.recurrenceInterval,
      recurrenceUntil: recurrence.recurrenceUntil,
    })
    .where(eq(calendarEvents.id, eventId))
    .returning({ id: calendarEvents.id });
  if (!updated) throw new CalendarError("not_found", "Événement introuvable.");

  await recordAudit({
    orgId: actor.orgId,
    actorUserId: actor.userId,
    action: "calendar.event.update",
    resourceType: "calendar_event",
    resourceId: eventId,
    result: "success",
  });

  return getEvent(actor, eventId);
}

/**
 * Supprime un événement. Pour une série récurrente, la suppression emporte
 * **toutes les occurrences** (pas de dérogation par occurrence).
 */
export async function deleteEvent(actor: Actor, eventId: string): Promise<void> {
  const existing = await getEvent(actor, eventId);
  if (!existing.canEdit) {
    throw new CalendarError("forbidden", "Permission insuffisante pour supprimer cet événement.");
  }
  await db().delete(calendarEvents).where(eq(calendarEvents.id, eventId));

  await recordAudit({
    orgId: actor.orgId,
    actorUserId: actor.userId,
    action: "calendar.event.delete",
    resourceType: "calendar_event",
    resourceId: eventId,
    result: "success",
  });
}

/** Réponse d'un invité (accepter / refuser). */
export async function setAttendance(
  actor: Actor,
  eventId: string,
  status: AttendanceStatus,
): Promise<EventView> {
  // Charge d'abord l'événement (organisation + visibilité) : une écriture ne
  // doit jamais précéder le contrôle d'accès.
  await getEvent(actor, eventId);

  const myEmail = await actorEmail(actor);
  await withTransaction(async (tx) => {
    const [updated] = await tx
      .update(calendarAttendees)
      .set({ status })
      .where(
        and(
          eq(calendarAttendees.eventId, eventId),
          or(eq(calendarAttendees.userId, actor.userId), eq(calendarAttendees.email, myEmail)),
        ),
      )
      .returning({ id: calendarAttendees.id });
    if (!updated) {
      throw new CalendarError("forbidden", "Vous n'êtes pas invité à cet événement.");
    }
  });

  return getEvent(actor, eventId);
}
