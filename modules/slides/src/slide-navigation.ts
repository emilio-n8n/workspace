/**
 * Navigation clavier entre diapositives (flèches, Page préc./suiv., Début/Fin).
 *
 * Logique pure, testée sans navigateur : l'éditeur et le mode présentation
 * partagent la même table de décision, donc les mêmes raccourcis.
 */

/** Touches reconnues par la navigation (modificateurs exclus). */
export const SLIDE_NAV_KEYS = [
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
  "PageUp",
  "PageDown",
  "Home",
  "End",
] as const;

export type SlideNavKey = (typeof SLIDE_NAV_KEYS)[number];

export type SlideNavigationInput = {
  key: string;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  /** Nombre de diapositives de la présentation. */
  count: number;
  /** Index de la diapositive courante. */
  current: number;
};

const STEP_FORWARD = new Set<string>(["ArrowRight", "ArrowDown", "PageDown"]);
const STEP_BACKWARD = new Set<string>(["ArrowLeft", "ArrowUp", "PageUp"]);

/**
 * Index de la diapositive visée, ou null si la touche ne change rien :
 * modificateur pressé (raccourci d'une autre action), touche inconnue, ou
 * borne déjà atteinte (pas d'annonce inutile).
 */
export function slideNavigationTarget(input: SlideNavigationInput): number | null {
  if (input.altKey || input.ctrlKey || input.metaKey) return null;
  if (input.count <= 0) return null;

  let target: number;
  if (input.key === "Home") target = 0;
  else if (input.key === "End") target = input.count - 1;
  else if (STEP_FORWARD.has(input.key)) target = input.current + 1;
  else if (STEP_BACKWARD.has(input.key)) target = input.current - 1;
  else return null;

  if (target < 0 || target >= input.count || target === input.current) return null;
  return target;
}

/**
 * Champs où les flèches servent à saisir ou choisir une valeur : la
 * navigation est suspendue, sinon écrire dans le titre ou déplier une
 * liste déplacerait la diapositive courante.
 */
export function isTypingTarget(
  target: { tagName?: string; isContentEditable?: boolean } | null | undefined,
): boolean {
  if (!target) return false;
  const tag = (target.tagName ?? "").toUpperCase();
  return (
    tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable === true
  );
}

/** Une fenêtre modale est ouverte : elle garde le clavier pour elle. */
export function isInsideModal(target: Element | null | undefined): boolean {
  if (!target || typeof target.closest !== "function") return false;
  return target.closest("dialog, [role='dialog']") !== null;
}

/** Position lue à voix haute après un changement de diapositive. */
export function slideNavigationAnnouncement(index: number, count: number): string {
  return `Diapositive ${index + 1} sur ${count}.`;
}
