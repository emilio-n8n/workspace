/**
 * Recherche et filtres des tâches — logique pure.
 *
 * Tous les critères se COMBINENT (ET) : le texte, l'état, l'échéance et les
 * étiquettes restreignent successivement le même lot. Rien n'est appliqué en
 * amont par le serveur : l'écran travaille sur les tâches déjà chargées, ce qui
 * rend la règle testable et l'affichage instantané.
 */

/** Filtres d'état (boutons de la barre). */
export const TASK_STATUS_FILTERS = [
  { id: "all", label: "Toutes" },
  { id: "todo", label: "À faire" },
  { id: "in_progress", label: "En cours" },
  { id: "done", label: "Terminées" },
] as const;

/** Filtres d'échéance (menu déroulant). */
export const TASK_DUE_FILTERS = [
  { id: "all", label: "Toutes les échéances" },
  { id: "overdue", label: "En retard" },
  { id: "today", label: "Aujourd'hui" },
  { id: "week", label: "Cette semaine" },
  { id: "none", label: "Sans échéance" },
] as const;

export type TaskStatusFilter = (typeof TASK_STATUS_FILTERS)[number]["id"];
export type TaskDueFilter = (typeof TASK_DUE_FILTERS)[number]["id"];

export type TaskFilterCriteria = {
  /** Texte libre : titre et notes. */
  query: string;
  status: TaskStatusFilter;
  due: TaskDueFilter;
  /** Étiquettes exigées (ET logique) ; vide = aucune contrainte. */
  labelIds: readonly string[];
};

export const DEFAULT_CRITERIA: TaskFilterCriteria = {
  query: "",
  status: "all",
  due: "all",
  labelIds: [],
};

/** Champs minimaux nécessaires au filtrage. */
export type FilterableTask = {
  id: string;
  title: string;
  notes?: string | null;
  status: string;
  dueAt: string | null;
  labels?: readonly { id: string; name?: string }[];
};

export type DueBucketId = "overdue" | "today" | "week" | "later" | "none";

/** Fin de la journée locale (23:59:59.999) de `reference`. */
function endOfDay(reference: Date): Date {
  const end = new Date(reference);
  end.setHours(23, 59, 59, 999);
  return end;
}

/** Borne de la semaine glissante : aujourd'hui + 7 jours, fin de journée. */
const WEEK_MS = 7 * 86_400_000;

/**
 * Regroupe une échéance dans un panneau français. `done` n'est PAS géré ici :
 * les tâches terminées n'ont pas de retard, elles appartiennent à l'historique.
 */
export function dueBucketOf(task: FilterableTask, now: Date): DueBucketId | "done" {
  if (task.dueAt === null) return "none";
  const due = new Date(task.dueAt);
  if (due.getTime() < now.getTime()) return "overdue";
  if (due.getTime() <= endOfDay(now).getTime()) return "today";
  if (due.getTime() <= endOfDay(new Date(now.getTime() + WEEK_MS)).getTime()) return "week";
  return "later";
}

/**
 * Normalise une recherche : minuscules, accents ignorés, espaces compactés.
 * Chercher « ecole » doit trouver « École ».
 */
export function normalizeQuery(query: string): string {
  return query
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

/** Le texte recherché apparaît-il dans le titre ou les notes ? */
export function matchesQuery(task: FilterableTask, query: string): boolean {
  const needle = normalizeQuery(query);
  if (needle.length === 0) return true;
  const haystack = normalizeQuery(`${task.title} ${task.notes ?? ""}`);
  // Chaque mot doit apparaître : « rapport client » ne trouve pas
  // « rapport » seul, mais trouve « Client : rapport ».
  return needle.split(" ").every((word) => haystack.includes(word));
}

function matchesStatus(task: FilterableTask, status: TaskStatusFilter): boolean {
  if (status === "all") return true;
  return task.status === status;
}

function matchesDue(task: FilterableTask, due: TaskDueFilter, now: Date): boolean {
  if (due === "all") return true;
  if (due === "none") return task.dueAt === null;
  // Une tâche terminée n'est jamais « en retard » : le retard se vit au présent.
  if (task.status === "done") return false;
  const bucket = dueBucketOf(task, now);
  // « Cette semaine » est une plage : aujourd'hui ET les sept jours à venir.
  if (due === "week") return bucket === "week" || bucket === "today";
  return bucket === due;
}

/** Les étiquettes sélectionnées sont toutes portées par la tâche (ET). */
function matchesLabels(task: FilterableTask, labelIds: readonly string[]): boolean {
  if (labelIds.length === 0) return true;
  const owned = new Set((task.labels ?? []).map((label) => label.id));
  return labelIds.every((labelId) => owned.has(labelId));
}

/** Applique les critères combinés. Ordre stable : l'ordre d'entrée est conservé. */
export function filterTasks<T extends FilterableTask>(
  tasks: readonly T[],
  criteria: TaskFilterCriteria,
  now: Date = new Date(),
): T[] {
  return tasks.filter(
    (task) =>
      matchesQuery(task, criteria.query) &&
      matchesStatus(task, criteria.status) &&
      matchesDue(task, criteria.due, now) &&
      matchesLabels(task, criteria.labelIds),
  );
}

export type ActiveFilter = { id: string; label: string };

/** Filtres actifs, sous forme de puces retirables (libellés français). */
export function activeFilters(
  criteria: TaskFilterCriteria,
  labelNames: ReadonlyMap<string, string> = new Map(),
): ActiveFilter[] {
  const chips: ActiveFilter[] = [];
  const query = criteria.query.trim();
  if (query.length > 0) chips.push({ id: "query", label: `« ${query} »` });

  const status = TASK_STATUS_FILTERS.find((item) => item.id === criteria.status);
  if (status && criteria.status !== "all") chips.push({ id: "status", label: status.label });

  const due = TASK_DUE_FILTERS.find((item) => item.id === criteria.due);
  if (due && criteria.due !== "all") chips.push({ id: "due", label: due.label });

  for (const labelId of criteria.labelIds) {
    chips.push({ id: `label:${labelId}`, label: labelNames.get(labelId) ?? "Étiquette" });
  }
  return chips;
}

export function isFiltering(criteria: TaskFilterCriteria): boolean {
  return (
    criteria.query.trim().length > 0 ||
    criteria.status !== "all" ||
    criteria.due !== "all" ||
    criteria.labelIds.length > 0
  );
}

/** Résumé lisible de la sélection, réutilisé par les puces et les annonces. */
export function describeFilterSummary(input: {
  shown: number;
  total: number;
  criteria: TaskFilterCriteria;
}): string {
  const count = input.shown === 1 ? "1 tâche affichée" : `${input.shown} tâches affichées`;
  const base = input.shown === input.total ? count : `${count} sur ${input.total}`;
  if (!isFiltering(input.criteria)) return `${base}.`;

  const parts: string[] = [];
  const query = input.criteria.query.trim();
  if (query.length > 0) parts.push(`recherche « ${query} »`);
  if (input.criteria.status !== "all") {
    const status = TASK_STATUS_FILTERS.find((item) => item.id === input.criteria.status);
    if (status) parts.push(status.label.toLowerCase());
  }
  if (input.criteria.due !== "all") {
    const due = TASK_DUE_FILTERS.find((item) => item.id === input.criteria.due);
    if (due) parts.push(`échéance : ${due.label.toLowerCase()}`);
  }
  if (input.criteria.labelIds.length > 0) {
    const unit = input.criteria.labelIds.length === 1 ? "étiquette" : "étiquettes";
    parts.push(`${input.criteria.labelIds.length} ${unit}`);
  }
  return `${base} — ${parts.join(", ")}.`;
}
