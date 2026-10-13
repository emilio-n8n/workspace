/**
 * Bus d'évènements temps réel de la cloche de notifications.
 *
 * SSE en mémoire = mono-instance : `publishNotification` ne touche que les
 * abonnés du processus courant. Derrière un déploiement multi-instances (ou
 * un redémarrage), un évènement peut donc ne pas être diffusé — le client
 * garde un polling de secours (~60 s côté application), donc la dégradation
 * est sûre.
 *
 * Aucune dépendance navigateur ni base de données : ce module est utilisé par
 * le serveur (routes `/api/notifications/stream`) et se teste seul sous Node.
 */

import type { NotificationKind } from "./index.ts";

/** Évènement diffusé aux abonnés d'un couple (organisation, utilisateur). */
export type NotificationStreamEvent = {
  orgId: string;
  userId: string;
  kind: NotificationKind;
  title: string;
  href: string | null;
};

/** Abonné notifié à chaque évènement de son couple (organisation, utilisateur). */
export type NotificationListener = (event: NotificationStreamEvent) => void;

/** Abonnés par couple `orgId` + `userId` (clé composée, jamais ambiguë). */
const listenersByKey = new Map<string, Set<NotificationListener>>();

function keyOf(orgId: string, userId: string): string {
  return `${orgId}\u0000${userId}`;
}

/**
 * Abonne `listener` aux évènements d'un couple (organisation, utilisateur).
 * Retourne la fonction de désabonnement (idempotente) ; la clé est retirée de
 * la table dès que son dernier abonné part.
 */
export function subscribeToNotifications(
  filter: { orgId: string; userId: string },
  listener: NotificationListener,
): () => void {
  const key = keyOf(filter.orgId, filter.userId);
  let listeners = listenersByKey.get(key);
  if (!listeners) {
    listeners = new Set();
    listenersByKey.set(key, listeners);
  }
  listeners.add(listener);

  let subscribed = true;
  return () => {
    if (!subscribed) return;
    subscribed = false;
    const current = listenersByKey.get(key);
    if (!current) return;
    current.delete(listener);
    if (current.size === 0) listenersByKey.delete(key);
  };
}

/**
 * Publie un évènement aux abonnés de son couple (organisation, utilisateur).
 * Best-effort : l'échec d'un abonné est journalisé et n'empêche pas les
 * autres ; `publishNotification` ne lève jamais.
 */
export function publishNotification(event: NotificationStreamEvent): void {
  const listeners = listenersByKey.get(keyOf(event.orgId, event.userId));
  if (!listeners || listeners.size === 0) return;
  for (const listener of [...listeners]) {
    try {
      listener(event);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[notifications] abonné temps réel en échec : ${message}`);
    }
  }
}
