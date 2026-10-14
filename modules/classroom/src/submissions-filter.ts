/**
 * Tri et filtres des copies — logique pure, sans DOM ni base de données.
 * L'enseignant qui corrige une pile doit pouvoir isoler « ce qui reste à
 * corriger », « les retards » ou un élève précis, et trier par nom, statut,
 * date de remise ou note. Une seule vérité, testée ici, jamais recopiée dans
 * le composant.
 */
import type { SubmissionStatusCode } from "./status.ts";

/** Filtre de statut : toutes les copies, ou l'une des trois issues. */
export type SubmissionStatusFilter = "all" | SubmissionStatusCode;

/** Clés de tri offertes à l'enseignant. */
export type SubmissionSortKey = "name" | "status" | "submittedAt" | "grade";

/** Sens du tri. */
export type SortDirection = "asc" | "desc";

/**
 * Ce qu'une ligne doit exposer pour être filtrée et triée. Volontairement
 * structurel : `TeacherSubmissionView` le satisfait sans que le service ait à
 * connaître l'interface.
 */
export type FilterableSubmission = {
  studentId: string;
  studentName: string;
  submittedAt: string;
  grade: number | null;
  status: SubmissionStatusCode;
};

export type SubmissionFilters = {
  /** `"all"` (défaut) affiche toutes les copies. */
  status?: SubmissionStatusFilter;
  /** `null` ou absent : tous les élèves. */
  studentId?: string | null;
};

export type SubmissionSort = {
  sortKey?: SubmissionSortKey;
  direction?: SortDirection;
};

/** Priorité d'affichage d'un statut : ce qui reste à corriger passe devant. */
const STATUS_ORDER: Record<SubmissionStatusCode, number> = {
  late: 0,
  submitted: 1,
  graded: 2,
};

/** Instant d'une date ISO ; une date illisible ne fait pas planter le tri. */
function instant(value: string): number {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/** Ne garde que les copies correspondant au statut et à l'élève demandés. */
export function filterSubmissions<T extends FilterableSubmission>(
  rows: readonly T[],
  filters: SubmissionFilters = {},
): T[] {
  const { status = "all", studentId = null } = filters;
  return rows.filter((row) => {
    if (status !== "all" && row.status !== status) return false;
    if (studentId !== null && row.studentId !== studentId) return false;
    return true;
  });
}

/**
 * Trie une liste de copies. Les échéances restent stables : à clé égale, le nom
 * d'élève départage (puis l'identifiant), jamais l'ordre d'arrivée.
 */
export function sortSubmissions<T extends FilterableSubmission>(
  rows: readonly T[],
  sort: SubmissionSort = {},
): T[] {
  const { sortKey = "name", direction = "asc" } = sort;
  const sign = direction === "asc" ? 1 : -1;

  return [...rows].sort((a, b) => {
    if (sortKey === "grade") {
      // Une copie non notée ne se mêle jamais aux notes : elle finit la liste,
      // quel que soit le sens (on n'affiche pas « pas de note » avant 0).
      if (a.grade === null || b.grade === null) {
        if (a.grade === null && b.grade === null) return byStudent(a, b, sign);
        return a.grade === null ? 1 : -1;
      }
      const byGrade = a.grade - b.grade;
      return byGrade !== 0 ? byGrade * sign : byStudent(a, b, sign);
    }

    let comparison = 0;
    if (sortKey === "status") comparison = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
    else if (sortKey === "submittedAt") {
      comparison = instant(a.submittedAt) - instant(b.submittedAt);
    }
    // `"name"` : aucune clé primaire, le nom décide directement.
    return comparison !== 0 ? comparison * sign : byStudent(a, b, sign);
  });
}

/** Départage par nom (accents pliés par la locale française), puis par id. */
function byStudent(
  a: Pick<FilterableSubmission, "studentName" | "studentId">,
  b: Pick<FilterableSubmission, "studentName" | "studentId">,
  sign: number,
): number {
  const byName = a.studentName.localeCompare(b.studentName, "fr");
  if (byName !== 0) return byName * sign;
  return a.studentId.localeCompare(b.studentId) * sign;
}

export type StudentOption = { value: string; label: string };

/**
 * Élèves présents dans la liste, dédoublonnés et rangés par nom — les options
 * d'un filtre « élève », jamais une requête séparée.
 */
export function studentOptions(rows: readonly FilterableSubmission[]): StudentOption[] {
  const byId = new Map<string, string>();
  for (const row of rows) byId.set(row.studentId, row.studentName);
  return [...byId.entries()]
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label, "fr"));
}
