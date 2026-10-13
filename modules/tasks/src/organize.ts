/**
 * Tri et regroupement d'affichage des tâches.
 *
 * Logique volontairement pure (aucun accès à la base, aucune dépendance React) :
 * elle est partagée par l'écran de liste et par l'agrégat « Mes tâches », et se
 * teste sans base de données. Les règles retenues, communes à tous les ordres :
 *
 * 1. les tâches terminées passent toujours en dernier — la section
 *    « Terminées » est une question de repli, pas de tri ;
 * 2. les échéances absentes sont considérées comme les plus lointaines ;
 * 3. une priorité inconnue vaut « moyenne » : une donnée incomplète ne doit
 *    jamais faire disparaître une tâche.
 */

/** Niveau de priorité, du plus faible au plus fort. */
export const PRIORITY_RANK: Record<string, number> = { low: 0, medium: 1, high: 2 };

export const DEFAULT_PRIORITY_RANK = 1;

/** Ordres proposés à l'écran. `manual` conserve l'ordre reçu du serveur. */
export const TASK_SORTS = [
  { id: "manual", label: "Ordre de la liste", hint: "Non terminées d'abord, puis échéance." },
  { id: "due", label: "Échéance", hint: "Retards d'abord, échéances absentes en dernier." },
  { id: "priority", label: "Priorité", hint: "Priorité haute d'abord." },
  { id: "alpha", label: "Titre (A → Z)", hint: "Ordre alphabétique français." },
  { id: "created", label: "Ajout récent", hint: "Les tâches créées en dernier d'abord." },
] as const;

export type TaskSortId = (typeof TASK_SORTS)[number]["id"];

/** Regroupements proposés à l'écran (`none` = liste à plat). */
export const TASK_GROUPS = [
  { id: "none", label: "Aucun regroupement" },
  { id: "due", label: "Par échéance" },
  { id: "priority", label: "Par priorité" },
  { id: "list", label: "Par liste" },
] as const;

export type TaskGroupId = (typeof TASK_GROUPS)[number]["id"];
export type TaskGroupBy = Exclude<TaskGroupId, "none">;

/** Champs minimaux nécessaires au tri : les vues (`TaskView`, `MyTaskView`) suffisent. */
export type OrderableTask = {
  id: string;
  title: string;
  status: string;
  priority: string;
  dueAt: string | null;
  createdAt: string;
  listName?: string;
};

function isDone(task: OrderableTask): boolean {
  return task.status === "done";
}

function rank(priority: string): number {
  return PRIORITY_RANK[priority] ?? DEFAULT_PRIORITY_RANK;
}

/** Échéance croissante ; une échéance absente est toujours la plus lointaine. */
function compareDue(a: OrderableTask, b: OrderableTask): number {
  const aTime = a.dueAt === null ? Number.POSITIVE_INFINITY : new Date(a.dueAt).getTime();
  const bTime = b.dueAt === null ? Number.POSITIVE_INFINITY : new Date(b.dueAt).getTime();
  if (aTime === bTime) return 0;
  return aTime < bTime ? -1 : 1;
}

/**
 * Trie les tâches selon l'ordre demandé. Le tri est stable : à critères égaux,
 * l'ordre reçu (celui du serveur) est conservé.
 */
export function sortTasks<T extends OrderableTask>(tasks: readonly T[], sort: TaskSortId): T[] {
  const rows = [...tasks];
  rows.sort((a, b) => {
    const byDone = Number(isDone(a)) - Number(isDone(b));
    if (byDone !== 0) return byDone;
    switch (sort) {
      case "manual":
        return 0;
      case "due":
        return compareDue(a, b);
      case "priority": {
        const byPriority = rank(b.priority) - rank(a.priority);
        return byPriority !== 0 ? byPriority : compareDue(a, b);
      }
      case "alpha": {
        const byTitle = a.title.localeCompare(b.title, "fr");
        return byTitle !== 0 ? byTitle : compareDue(a, b);
      }
      case "created": {
        if (a.createdAt === b.createdAt) return compareDue(a, b);
        return a.createdAt < b.createdAt ? 1 : -1;
      }
      default:
        return 0;
    }
  });
  return rows;
}

export const DUE_BUCKET_LABELS: Record<DueBucketId, string> = {
  overdue: "En retard",
  today: "Aujourd'hui",
  week: "Cette semaine",
  later: "Plus tard",
  none: "Sans échéance",
  done: "Terminées",
};

export type DueBucketId = "overdue" | "today" | "week" | "later" | "none" | "done";

/** Fin de la journée locale (23:59:59.999) de `reference`. */
function endOfDay(reference: Date): Date {
  const end = new Date(reference);
  end.setHours(23, 59, 59, 999);
  return end;
}

/** Bornes de la semaine glissante : aujourd'hui + 7 jours, fin de journée. */
const WEEK_MS = 7 * 86_400_000;

function dueBucketId(task: OrderableTask, now: Date): DueBucketId {
  if (task.dueAt === null) return "none";
  const due = new Date(task.dueAt);
  if (due.getTime() < now.getTime()) return "overdue";
  if (due.getTime() <= endOfDay(now).getTime()) return "today";
  if (due.getTime() <= endOfDay(new Date(now.getTime() + WEEK_MS)).getTime()) return "week";
  return "later";
}

function bucketOf(task: OrderableTask, group: TaskGroupBy, now: Date): string {
  if (isDone(task)) return "done";
  switch (group) {
    case "due":
      return dueBucketId(task, now);
    case "priority":
      return task.priority;
    case "list":
      return task.listName && task.listName.length > 0 ? `list:${task.listName}` : "list:";
    default:
      return "all";
  }
}

/** Libellés des groupes de priorité — les identifiants restent en anglais. */
export const PRIORITY_GROUP_LABELS: Record<string, string> = {
  high: "Priorité haute",
  medium: "Priorité moyenne",
  low: "Priorité basse",
};

function bucketLabel(bucket: string): string {
  if (bucket === "all") return "";
  if (bucket.startsWith("list:")) {
    const name = bucket.slice("list:".length);
    return name.length > 0 ? name : "Autres listes";
  }
  return DUE_BUCKET_LABELS[bucket as DueBucketId] ?? PRIORITY_GROUP_LABELS[bucket] ?? bucket;
}

/** Ordre d'affichage des groupes : le plus urgent d'abord, « Terminées » en dernier. */
const BUCKET_ORDER: Record<string, number> = {
  overdue: 0,
  today: 1,
  week: 2,
  later: 3,
  none: 4,
  high: 0,
  medium: 1,
  low: 2,
  // Repli « Autres listes » : après les listes nommées, avant les terminées.
  "list:": 98,
  done: 99,
};

export type TaskGroup<T> = { id: string; label: string; tasks: T[] };

/**
 * Regroupe les tâches. Les groupes vides sont omis ; les tâches terminées
 * forment toujours le dernier groupe. `now` est injectable pour rendre les
 * bornes de la semaine testables.
 */
export function groupTasks<T extends OrderableTask>(
  tasks: readonly T[],
  group: TaskGroupBy,
  now: Date = new Date(),
): TaskGroup<T>[] {
  const buckets = new Map<string, T[]>();
  for (const task of tasks) {
    const id = bucketOf(task, group, now);
    const bucket = buckets.get(id);
    if (bucket) bucket.push(task);
    else buckets.set(id, [task]);
  }

  const groups = [...buckets.entries()].map(([id, rows]) => ({
    id,
    label: bucketLabel(id),
    tasks: rows,
  }));
  groups.sort((a, b) => {
    const byOrder = (BUCKET_ORDER[a.id] ?? 50) - (BUCKET_ORDER[b.id] ?? 50);
    if (byOrder !== 0) return byOrder;
    // Regroupement par liste : alphabétique français pour un ordre prévisible.
    return a.label.localeCompare(b.label, "fr");
  });
  return groups;
}

/** Texte d'annonce pour lecteur d'écran résumant la vue courante. */
export function describeView(input: {
  total: number;
  shown: number;
  sort: TaskSortId;
  group: TaskGroupId;
}): string {
  const count = input.shown === 1 ? "1 tâche affichée" : `${input.shown} tâches affichées`;
  const base = input.shown === input.total ? count : `${count} sur ${input.total}`;
  const sortLabel = TASK_SORTS.find((item) => item.id === input.sort)?.label ?? "";
  const groupLabel = TASK_GROUPS.find((item) => item.id === input.group)?.label ?? "";
  const sortPart = input.sort === "manual" ? "" : `, tri : ${sortLabel.toLowerCase()}`;
  const groupPart = input.group === "none" ? "" : `, regroupement : ${groupLabel.toLowerCase()}`;
  return `${base}${sortPart}${groupPart}.`;
}
