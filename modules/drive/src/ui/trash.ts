/**
 * Corbeille : messages purs en français accordé, sans DOM ni rendu.
 *
 * Testables (test/trash.test.ts) : la page de corbeille ne fait qu'afficher ces
 * libellés. Les actions elles-mêmes (restauration, vidage) restent portées par
 * le service et la page.
 */

/** Nombre accordé : « 1 élément » / « 3 éléments ». */
function counted(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

/** Libellé du bouton de vidage de la corbeille, quel que soit le nombre d'éléments. */
export function emptyTrashLabel(count: number): string {
  return count > 0 ? `Vider la corbeille (${count})` : "Vider la corbeille";
}

/**
 * Phrase de confirmation affichée avant un vidage définitif. Insiste sur le
 * caractère irréversible, sans jamais promettre une récupération possible.
 */
export function emptyTrashMessage(count: number): string {
  if (count <= 0) {
    return "La corbeille est déjà vide : il n'y a rien à vider.";
  }
  return `${counted(count, "élément", "éléments")} ${count === 1 ? "sera" : "seront"} définitivement supprimé${count === 1 ? "" : "s"}, contenu compris. Cette action est irréversible.`;
}

/**
 * Compte rendu du vidage : « 4 éléments supprimés. » ; en cas d'échec partiel,
 * le nombre de refus est nommé pour que l'utilisateur sache quoi regarder.
 */
export function emptyTrashResult(purged: number, failures: number): string {
  if (failures === 0) {
    return purged === 0
      ? "La corbeille était déjà vide."
      : `${counted(purged, "élément supprimé définitivement", "éléments supprimés définitivement")}.`;
  }
  const done =
    purged === 0 ? "" : `${counted(purged, "élément supprimé", "éléments supprimés")} — `;
  return `${done}${counted(failures, "échec", "échecs")}.`;
}

/** Message d'échec d'un vidage rejeté en bloc (droits, panne réseau). */
export function emptyTrashFailure(): string {
  return "Le vidage de la corbeille a échoué. Réessayez.";
}

/** Message de restauration d'un élément, nommé pour la confirmation à l'écran. */
export function restoredMessage(name: string): string {
  return `« ${name} » a été restauré.`;
}

/** Message d'échec de restauration, nommé. */
export function restoreFailure(name: string): string {
  return `Restauration de « ${name} » impossible.`;
}

/**
 * Phrase de confirmation avant la purge d'un élément précis. Le nom est cité
 * pour qu'on ne supprime jamais « un » élément sans savoir lequel.
 */
export function purgeEntryMessage(name: string): string {
  return `« ${name} » sera définitivement supprimé, contenu compris. Cette action est irréversible.`;
}

/** Compte rendu de la purge d'un élément, nommé. */
export function purgedMessage(name: string): string {
  return `« ${name} » a été supprimé définitivement.`;
}

/** Message d'échec de la purge d'un élément, nommé. */
export function purgeFailure(name: string): string {
  return `Suppression définitive de « ${name} » impossible.`;
}
