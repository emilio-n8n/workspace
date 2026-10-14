/**
 * Sous-tâches — logique pure (progression, ordre, bornes).
 *
 * Aucun accès à la base : ces règles sont partagées par le service et par
 * l'écran, et se testent sans base de données.
 */

export const SUBTASK_TITLE_MAX = 200;
/** Borne d'une seule liste de sous-tâches : au-delà, la tâche mérite d'être décomposée. */
export const SUBTASKS_MAX = 50;

/** Champs minimaux d'une sous-tâche. */
export type SubtaskLike = {
  id: string;
  title: string;
  isDone: boolean;
  position: number;
};

/** Ordre d'affichage : position croissante, `id` (uuidv7) en départage. */
export function sortSubtasks<T extends SubtaskLike>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
}

export type SubtaskProgress = {
  done: number;
  total: number;
  /** Tout est fait — et il y a au moins une sous-tâche. */
  complete: boolean;
};

export function subtaskProgress(rows: readonly { isDone: boolean }[]): SubtaskProgress {
  const done = rows.filter((row) => row.isDone).length;
  return { done, total: rows.length, complete: rows.length > 0 && done === rows.length };
}

/** Libellé de progression, accordé au singulier comme au pluriel. */
export function progressLabel(progress: SubtaskProgress): string {
  if (progress.total === 0) return "Aucune sous-tâche";
  const unit = progress.done === 1 ? "sous-tâche terminée" : "sous-tâches terminées";
  return `${progress.done} ${unit} sur ${progress.total}`;
}

/** Annonce pour lecteur d'écran, bascule d'état et progression incluses. */
export function describeSubtaskChange(input: {
  title: string;
  isDone: boolean;
  progress: SubtaskProgress;
}): string {
  const state = input.isDone ? "terminée" : "remise à faire";
  return `Sous-tâche « ${input.title} » ${state} — ${progressLabel(input.progress)}.`;
}

/** Prochaine position libre : en fin de liste, calcul sans trou. */
export function nextSubtaskPosition(rows: readonly SubtaskLike[]): number {
  return rows.reduce((max, row) => Math.max(max, row.position), -1) + 1;
}

/**
 * Décale une sous-tâche d'un cran. Renvoie `null` si le déplacement est hors
 * bornes : l'appelant n'a alors rien à envoyer au serveur.
 */
export function moveSubtaskIds(ids: readonly string[], from: number, to: number): string[] | null {
  if (!Number.isInteger(from) || !Number.isInteger(to)) return null;
  if (from < 0 || to < 0 || from >= ids.length || to >= ids.length) return null;
  if (from === to) return [...ids];

  const next = [...ids];
  const [moved] = next.splice(from, 1);
  if (moved === undefined) return null;
  next.splice(to, 0, moved);
  return next;
}

/**
 * Règles de synchronisation de la tâche parente :
 *
 * - toutes les sous-tâches faites ⇒ la tâche parente se termine (`completedAt`) ;
 * - une sous-tâche rouverte alors que la parente était terminée la rouvre.
 *
 * C'est le seul endroit où cette règle vit : le service et les tests l'utilisent,
 * et l'écran n'a jamais à la deviner.
 */
export function parentStatusAfterSubtaskChange(input: {
  parentStatus: string;
  /** Seul l'état compte ici : `SubtaskLike[]` convient aussi. */
  subtasks: readonly { isDone: boolean }[];
}): { status: "todo" | "done"; changed: boolean } {
  const { complete } = subtaskProgress(input.subtasks);
  if (complete && input.parentStatus !== "done") return { status: "done", changed: true };
  if (!complete && input.parentStatus === "done") return { status: "todo", changed: true };
  return {
    status: input.parentStatus === "done" ? "done" : "todo",
    changed: false,
  };
}
