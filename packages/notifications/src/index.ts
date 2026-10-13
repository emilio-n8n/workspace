import { getDb, schema } from "@workspace/database";
import type { Actor } from "@workspace/permissions";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { publishNotification } from "./stream.ts";

export type { NotificationListener, NotificationStreamEvent } from "./stream.ts";
export { publishNotification, subscribeToNotifications } from "./stream.ts";

/**
 * Notifications utilisateur — partages reçus, tâches assignées, copies notées.
 *
 * Règles :
 * - une notification appartient à (utilisateur, organisation) : la lecture et
 *   les mutations sont toujours filtrées sur l'acteur, jamais sur un
 *   identifiant fourni par l'appelant ;
 * - `createNotification` est au mieux (best-effort) : une panne de notification
 *   ne casse jamais le chemin métier qui l'émet (même contrat que l'audit).
 */

export type NotificationKind = "share" | "task_assigned" | "graded" | "system";

export type NotificationView = {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string | null;
  href: string | null;
  read: boolean;
  createdAt: string;
};

export type NotificationsErrorCode = "not_found";

export class NotificationsError extends Error {
  readonly code: NotificationsErrorCode;
  constructor(code: NotificationsErrorCode, message: string) {
    super(message);
    this.name = "NotificationsError";
    this.code = code;
  }
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

type NotificationRow = typeof schema.notifications.$inferSelect;

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function clampLimit(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return DEFAULT_LIMIT;
  return Math.min(Math.max(Math.trunc(value), 1), MAX_LIMIT);
}

function toView(row: NotificationRow): NotificationView {
  return {
    id: row.id,
    kind: row.kind as NotificationKind,
    title: row.title,
    body: row.body,
    href: row.href,
    read: row.readAt !== null,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Émet une notification pour un utilisateur d'une organisation. Ne lève
 * jamais : l'échec est signalé sur stderr et avalé. Après une insertion
 * réussie, l'évènement est diffusé au mieux sur le bus temps réel (best-effort,
 * jamais bloquant) pour la cloche ouverte dans l'organisation.
 */
export async function createNotification(input: {
  orgId: string;
  userId: string;
  kind: NotificationKind;
  title: string;
  body?: string | null;
  href?: string | null;
}): Promise<void> {
  try {
    await getDb()
      .insert(schema.notifications)
      .values({
        orgId: input.orgId,
        userId: input.userId,
        kind: input.kind,
        title: input.title,
        body: input.body ?? null,
        href: input.href ?? null,
      });
  } catch (error) {
    console.error(`[notifications] écriture impossible : ${errorText(error)}`);
    return;
  }

  try {
    publishNotification({
      orgId: input.orgId,
      userId: input.userId,
      kind: input.kind,
      title: input.title,
      href: input.href ?? null,
    });
  } catch {
    // Silencieux : la diffusion temps réel ne doit jamais casser l'émission.
  }
}

/**
 * Notifications de l'acteur (organisation active incluse), de la plus récente
 * à la plus ancienne. `limit` par défaut 50, borné à 200.
 */
export async function listNotifications(
  actor: Actor,
  opts: { unreadOnly?: boolean; limit?: number } = {},
): Promise<NotificationView[]> {
  const conditions = [
    eq(schema.notifications.userId, actor.userId),
    eq(schema.notifications.orgId, actor.orgId),
  ];
  if (opts.unreadOnly) conditions.push(isNull(schema.notifications.readAt));

  const rows = await getDb()
    .select()
    .from(schema.notifications)
    .where(and(...conditions))
    .orderBy(desc(schema.notifications.createdAt))
    .limit(clampLimit(opts.limit));

  return rows.map(toView);
}

/** Nombre de notifications non lues de l'acteur. */
export async function countUnreadNotifications(actor: Actor): Promise<number> {
  const [row] = await getDb()
    .select({ value: sql<number>`count(*)`.mapWith(Number) })
    .from(schema.notifications)
    .where(
      and(
        eq(schema.notifications.userId, actor.userId),
        eq(schema.notifications.orgId, actor.orgId),
        isNull(schema.notifications.readAt),
      ),
    );
  return row?.value ?? 0;
}

/**
 * Marque une notification de l'acteur comme lue. Une notification qui ne lui
 * appartient pas (ou pas dans l'organisation active) est introuvable — jamais
 * révélée.
 */
export async function markNotificationRead(actor: Actor, id: string): Promise<void> {
  const rows = await getDb()
    .update(schema.notifications)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(schema.notifications.id, id),
        eq(schema.notifications.userId, actor.userId),
        eq(schema.notifications.orgId, actor.orgId),
      ),
    )
    .returning({ id: schema.notifications.id });

  if (rows.length === 0) {
    throw new NotificationsError("not_found", "Notification introuvable.");
  }
}

/** Marque toutes les notifications non lues de l'acteur comme lues. */
export async function markAllNotificationsRead(actor: Actor): Promise<void> {
  await getDb()
    .update(schema.notifications)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(schema.notifications.userId, actor.userId),
        eq(schema.notifications.orgId, actor.orgId),
        isNull(schema.notifications.readAt),
      ),
    );
}
