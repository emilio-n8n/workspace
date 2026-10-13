import type { MessageView } from "../server.ts";

/**
 * Position du séparateur de messages non lus.
 *
 * `cutoff` est le curseur de lecture effectif renvoyé par `getUnreadState` —
 * la même borne que celle du compteur de non-lus de la barre latérale. Le
 * séparateur se place donc exactement là où s'arrête ce que l'on a déjà lu :
 * devant le premier message **d'autrui** postérieur au curseur.
 *
 * Règles :
 * - nos propres messages ne sont jamais « non lus » (`mine`, décidé par le
 *   serveur : le compteur les ignore) ;
 * - sans curseur (conversation inconnue ou déjà lue), aucun séparateur ;
 * - la comparaison se fait à la milliseconde, la précision transportée par
 *   l'API (les horodatages ISO sont tronqués au départ).
 */
export function unreadSplitIndex(messages: readonly MessageView[], cutoff: string | null): number {
  if (cutoff === null) return -1;
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (!message || message.mine) continue;
    if (message.createdAt > cutoff) return index;
  }
  return -1;
}

/** Nombre de messages affichés comme non lus à partir du séparateur. */
export function unreadShown(messages: readonly MessageView[], from: number): number {
  if (from < 0) return 0;
  let total = 0;
  for (let index = from; index < messages.length; index += 1) {
    const message = messages[index];
    if (message && !message.mine) total += 1;
  }
  return total;
}
