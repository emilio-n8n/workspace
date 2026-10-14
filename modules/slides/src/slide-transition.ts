/**
 * Transitions d'une présentation : animation jouée à chaque changement de
 * diapositive en mode présentation, et en aperçu dans l'éditeur.
 *
 * Logique pure : la table des transitions est la seule vérité, l'interface
 * ne fait que l'appliquer (mode présentation + aperçu). Les animations sont
 * décrites par des images-clés Web Animations, pour rester indépendantes de
 * toute feuille de style.
 */

export type SlideTransitionId = "none" | "fade" | "slide" | "push" | "wipe";

export type SlideTransition = {
  id: SlideTransitionId;
  label: string;
  /** Aide courte affichée sous le sélecteur. */
  hint: string;
  /** Durée par défaut conseillée, en millisecondes. */
  durationMs: number;
};

export const SLIDE_TRANSITIONS: Record<SlideTransitionId, SlideTransition> = {
  none: {
    id: "none",
    label: "Aucune",
    hint: "Le changement de diapositive est instantané.",
    durationMs: 0,
  },
  fade: {
    id: "fade",
    label: "Fondu",
    hint: "La diapositive apparaît en fondu.",
    durationMs: 400,
  },
  slide: {
    id: "slide",
    label: "Glissement",
    hint: "La diapositive entre par la droite.",
    durationMs: 350,
  },
  push: {
    id: "push",
    label: "Poussée",
    hint: "La diapositive pousse l'écran depuis la droite.",
    durationMs: 450,
  },
  wipe: {
    id: "wipe",
    label: "Balayage",
    hint: "La diapositive se révèle de gauche à droite.",
    durationMs: 450,
  },
};

/** Transitions proposées, dans l'ordre du sélecteur. */
export const SLIDE_TRANSITION_IDS = Object.keys(SLIDE_TRANSITIONS) as SlideTransitionId[];

/** Transition attribuée aux valeurs illisibles. */
export const DEFAULT_SLIDE_TRANSITION: SlideTransitionId = "none";

/** Bornes de la durée d'une transition, en millisecondes. */
export const TRANSITION_MIN_MS = 200;
export const TRANSITION_MAX_MS = 2000;

/** Relit une transition persistée : toute valeur inconnue retombe au défaut. */
export function normalizeTransition(value: unknown): SlideTransitionId {
  if (typeof value === "string" && value in SLIDE_TRANSITIONS) {
    return value as SlideTransitionId;
  }
  return DEFAULT_SLIDE_TRANSITION;
}

/** Relit une durée persistée, bornée et entière. */
export function normalizeTransitionMs(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 400;
  return Math.round(Math.min(TRANSITION_MAX_MS, Math.max(TRANSITION_MIN_MS, value)));
}

/** Libellé français d'une transition. */
export function transitionLabel(transition: SlideTransitionId): string {
  return SLIDE_TRANSITIONS[normalizeTransition(transition)].label;
}

/** Phrase d'aide d'une transition. */
export function transitionHint(transition: SlideTransitionId): string {
  return SLIDE_TRANSITIONS[normalizeTransition(transition)].hint;
}

/** Images-clés Web Animations d'une transition, en pourcentage de la scène. */
export type TransitionFrames = { from: Keyframe; to: Keyframe } | null;

/**
 * Images-clés d'une transition pour Web Animations : `null` pour « aucune »
 * (rien à animer) et pour une animation réduite demandée par l'utilisateur.
 */
export function transitionFrames(
  transition: SlideTransitionId,
  options: { reduceMotion?: boolean } = {},
): TransitionFrames {
  const id = normalizeTransition(transition);
  if (id === "none" || options.reduceMotion) return null;
  switch (id) {
    case "fade":
      return { from: { opacity: 0 }, to: { opacity: 1 } };
    case "slide":
      return {
        from: { transform: "translateX(18%)" },
        to: { transform: "translateX(0%)" },
      };
    case "push":
      return {
        from: { transform: "translateX(100%)" },
        to: { transform: "translateX(0%)" },
      };
    case "wipe":
      return {
        from: { clipPath: "inset(0 100% 0 0)", opacity: 1 },
        to: { clipPath: "inset(0 0 0 0)", opacity: 1 },
      };
    default:
      return null;
  }
}

/** Durée effective d'une transition, en millisecondes (0 = instantané). */
export function transitionDuration(
  transition: SlideTransitionId,
  durationMs: number,
  options: { reduceMotion?: boolean } = {},
): number {
  if (normalizeTransition(transition) === "none" || options.reduceMotion) return 0;
  return normalizeTransitionMs(durationMs);
}

/** Phrase d'aperçu (« Fondu, 400 ms ») pour les annonces vocales. */
export function transitionSummary(transition: SlideTransitionId, durationMs: number): string {
  const id = normalizeTransition(transition);
  if (id === "none") return "Aucune transition.";
  return `${transitionLabel(id)}, ${normalizeTransitionMs(durationMs)} ms.`;
}
