/**
 * Niveau du micro — logique pure du vu-mètre affiché à l'écran préparatoire et
 * dans la salle. La mesure brute (RMS du canal audio) est normalisée ici, puis
 * traduite en barres et en état « parle / se taît » avec hystérésis, pour éviter
 * un indicateur qui clignote à chaque respiration.
 */

/** Nombre de barres du vu-mètre. */
export const MIC_LEVEL_STEPS = 7;

/**
 * Gain appliqué à la mesure RMS : les valeurs brutes d'un canal de parole
 * tournent autour de 0,01–0,20, le gain les ramène sur toute la largeur du
 * vu-mètre.
 */
export const LEVEL_GAIN = 3.5;

/** Ramène une mesure RMS dans `[0, 1]` après application du gain. */
export function normalizeRms(rms: number): number {
  return clampLevel(clampLevel(rms) * LEVEL_GAIN);
}

/** Niveau RMS au-delà duquel la personne est considérée comme parlant. */
export const SPEAKING_ENTER_LEVEL = 0.62;

/** Niveau RMS en deçà duquel la personne est considérée comme silencieuse. */
export const SPEAKING_EXIT_LEVEL = 0.3;

/** Ramène une mesure quelconque dans `[0, 1]` (NaN → 0, infinis bornés). */
export function clampLevel(value: number): number {
  if (Number.isNaN(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

/** Nombre de barres allumées pour un niveau donné. */
export function activeLevelBars(level: number, steps: number = MIC_LEVEL_STEPS): number {
  const safeSteps = Number.isFinite(steps) && steps > 0 ? Math.floor(steps) : MIC_LEVEL_STEPS;
  return Math.min(safeSteps, Math.round(clampLevel(level) * safeSteps));
}

/**
 * État de parole avec hystérésis : franchir le seuil haut pour passer à « parle »,
 * repasser sous le seuil bas pour revenir à « silencieux ».
 */
export function speakingState(previous: boolean, level: number): boolean {
  const safe = clampLevel(level);
  return previous ? safe >= SPEAKING_EXIT_LEVEL : safe >= SPEAKING_ENTER_LEVEL;
}

/** Libellé lisible à haute voix du vu-mètre (annonce pour lecteurs d'écran). */
export function micLevelLabel(bars: number, steps: number = MIC_LEVEL_STEPS): string {
  if (bars <= 0) return "Aucun son détecté par le micro";
  return `Niveau du micro ${bars} sur ${steps}`;
}
