/**
 * Mode présentateur (PowerPoint « Mode Présentateur ») : diapositive en
 * cours, diapositive suivante, notes, minuteur avec pause, et fenêtre public
 * séparée pilotée depuis la console. Règles pures et testables ; le composant
 * `PresenterView` ne fait qu'afficher.
 */

/** Minuteur : temps accumulé + départ de la période en cours (null = en pause). */
export type PresenterTimer = { accumulatedMs: number; runningSince: number | null };

export function startTimer(now: number): PresenterTimer {
  return { accumulatedMs: 0, runningSince: now };
}

export function elapsedMs(timer: PresenterTimer, now: number): number {
  return (
    timer.accumulatedMs + (timer.runningSince === null ? 0 : Math.max(0, now - timer.runningSince))
  );
}

export function pauseTimer(timer: PresenterTimer, now: number): PresenterTimer {
  if (timer.runningSince === null) return timer;
  return { accumulatedMs: elapsedMs(timer, now), runningSince: null };
}

export function resumeTimer(timer: PresenterTimer, now: number): PresenterTimer {
  if (timer.runningSince !== null) return timer;
  return { ...timer, runningSince: now };
}

export function resetTimer(timer: PresenterTimer, now: number): PresenterTimer {
  return { accumulatedMs: 0, runningSince: timer.runningSince === null ? null : now };
}

/** Index de la diapositive suivante, `null` en fin de présentation. */
export function nextSlideIndex(index: number, count: number): number | null {
  return index + 1 < count ? index + 1 : null;
}

/** Libellé de l'aperçu « suivante » (ou fin de diaporama). */
export function nextSlideLabel(index: number, count: number): string {
  const next = nextSlideIndex(index, count);
  return next === null ? "Fin du diaporama" : `Suivante : diapositive ${next + 1} sur ${count}`;
}

/** Heure murale affichée dans la console (« 14:05 »). */
export function clockLabel(date: Date): string {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

/** Nom de la fenêtre public (réutilisée d'une ouverture à l'autre). */
export const AUDIENCE_WINDOW_NAME = "workspace-slides-public";

/** Options de la fenêtre public : fenêtre séparée, déplaçable sur un 2e écran. */
export const AUDIENCE_WINDOW_FEATURES = "popup=yes,width=1280,height=760";
