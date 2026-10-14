/**
 * Mode présentation local (plein écran), règles pures.
 *
 * Le plein écran est demandé par le navigateur ; il peut aussi être quitté par
 * l'utilisateur (Échap, touche dédiée, alt-tab). La décision « faut-il continuer
 * à présenter ? » est ici une fonction pure, testable sans navigateur, que
 * l'éditeur applique à chaque `fullscreenchange`.
 *
 * Logique pure (aucune dépendance) : testable sans navigateur ni base.
 */

/** Capacités du navigateur, passées en paramètre pour rester testable. */
export type PresentationCapabilities = {
  /** L'API Fullscreen est disponible. */
  fullscreen: boolean;
};

export type FullscreenState = {
  /** Vrai quand le mode présentation a demandé le plein écran. */
  requested: boolean;
  /** Élément actuellement en plein écran, `null` si aucun. */
  fullscreenElement: unknown;
  /** Conteneur de la présentation (celui qu'on compare). */
  container: unknown;
};

/**
 * Faut-il continuer à présenter ? Sans plein écran demandé, rien à
 * surveiller ; sinon, le plein écran doit toujours porter sur **notre**
 * conteneur. Si ce n'est plus le cas, l'utilisateur est sorti du plein écran
 * (Échap) et la présentation se referme avec lui.
 */
export function presentationShouldContinue(state: FullscreenState): boolean {
  if (!state.requested) return true;
  return state.fullscreenElement === state.container;
}

/** Libellé de position, lu par les lecteurs d'écran (« Diapositive 3 sur 10 »). */
export function presentationLabel(index: number, count: number): string {
  const total = Math.max(0, Math.trunc(count));
  const current = Math.min(Math.max(0, Math.trunc(index)) + 1, total);
  return `Diapositive ${current} sur ${total}.`;
}

/**
 * Avancement en pourcentage, pour la barre de progression du mode
 * présentation. 0 quand la présentation est vide (pas de NaN à l'écran).
 */
export function presentationProgress(index: number, count: number): number {
  const total = Math.max(0, Math.trunc(count));
  if (total === 0) return 0;
  const current = Math.min(Math.max(0, Math.trunc(index)), total - 1);
  return Math.round(((current + 1) / total) * 100);
}

/** Résumé de la présentation, avec accord du pluriel. */
export function presentationSummary(count: number): string {
  const total = Math.max(0, Math.trunc(count));
  return `${total} diapositive${total > 1 ? "s" : ""}`;
}

/** Message annoncé à la sortie du mode présentation. */
export function presentationExitMessage(): string {
  return "Mode présentation terminé.";
}

/**
 * Message d'aide affiché sous le canevas en mode présentation : les
 * raccourcis déjà en place pour la navigation.
 */
export function presentationHelp(): string {
  return "Flèches ou Page préc. / Page suiv. pour changer de diapositive, Début et Fin pour les extrémités, Échap pour quitter.";
}
