/**
 * Notes et moyennes — logique pure, sans base de données, partagée par le
 * service (remplissage des vues) et par l'interface (libellés). Une seule
 * vérité pour le calcul d'une moyenne : jamais recopiée dans un composant.
 *
 * Règle retenue : **une moyenne se calcule sur le travail déjà corrigé**. Un
 * devoir non rendu ou pas encore noté n'est pas un zéro — il n'est pas
 * compté. La moyenne est donc provisoire, et le nombre de devoirs corrigés
 * l'accompagne toujours pour que personne ne la lisse (« 12/20 sur 3 devoirs
 * notés »). Chaque devoir compte au poids de son barème : un devoir sur 100
 * pèse cinq fois un devoir sur 20.
 */

/** Une note de devoir telle que la voit le calcul : `null` = pas encore notée. */
export type GradeEntry = {
  grade: number | null;
  /** Barème du devoir, en points (> 0, sinon le devoir ne pèse rien). */
  points: number;
};

/** Bilan de notes d'un élève (ou de toute la classe, agrégeant les copies). */
export type GradeSummary = {
  /** Moyenne sur 20, `null` quand rien n'est corrigé (ou rien de pondérable). */
  average: number | null;
  /** Points obtenus sur les devoirs corrigés. */
  earned: number;
  /** Points possibles sur les devoirs corrigés. */
  possible: number;
  /** Nombre de devoirs corrigés. */
  graded: number;
  /** Nombre de devoirs pris en compte au total (corrigés ou non). */
  total: number;
};

/** Bilan d'un même cercle de notes, par élève. */
export type StudentGradeSummary = GradeSummary & { studentId: string };

/** Entrée d'un calcul multi-élèves : la copie sait de qui elle est. */
export type GradeRow = GradeEntry & { studentId: string };

/** Décimales gardées sur une moyenne (deux : 12,35 — pas plus, pas moins). */
const AVERAGE_DECIMALS = 100;

/**
 * Somme les notes d'un ensemble de devoirs. Les devoirs non notés sont
 * ignorés ; un barème nul ou négatif ne pèse rien (mais compte dans `total`).
 */
export function summarizeGrades(entries: readonly GradeEntry[]): GradeSummary {
  let earned = 0;
  let possible = 0;
  let graded = 0;

  for (const entry of entries) {
    if (entry.grade === null) continue;
    graded += 1;
    if (entry.points > 0) {
      earned += entry.grade;
      possible += entry.points;
    }
  }

  return {
    average: averageOnTwenty(earned, possible),
    earned,
    possible,
    graded,
    total: entries.length,
  };
}

/** Moyennes de chaque élève, triées par nom d'élève si fourni (sinon par id). */
export function summarizeGradesByStudent(
  rows: readonly GradeRow[],
  names?: ReadonlyMap<string, string>,
): StudentGradeSummary[] {
  const byStudent = new Map<string, GradeEntry[]>();
  for (const row of rows) {
    const list = byStudent.get(row.studentId) ?? [];
    list.push({ grade: row.grade, points: row.points });
    byStudent.set(row.studentId, list);
  }

  return [...byStudent.entries()]
    .map(([studentId, entries]) => ({ studentId, ...summarizeGrades(entries) }))
    .sort((a, b) => {
      const nameA = names?.get(a.studentId) ?? a.studentId;
      const nameB = names?.get(b.studentId) ?? b.studentId;
      return nameA.localeCompare(nameB, "fr");
    });
}

/** Bilan de toute une classe : les mêmes règles, toutes les copies ensemble. */
export function summarizeClassGrades(rows: readonly GradeRow[]): GradeSummary {
  return summarizeGrades(rows);
}

/**
 * Moyenne sur 20 d'un couple (points obtenus, points possibles). `null` quand
 * il n'y a rien à diviser : pas de note, ou seulement des devoirs sur 0.
 */
export function averageOnTwenty(earned: number, possible: number): number | null {
  if (possible <= 0) return null;
  return Math.round((earned / possible) * 20 * AVERAGE_DECIMALS) / AVERAGE_DECIMALS;
}

/**
 * Mention française d'une moyenne sur 20 (seuils usuels de l'école
 * française). `null` sans moyenne.
 */
export function gradeMention(average: number | null): string | null {
  if (average === null) return null;
  if (average >= 16) return "Très bien";
  if (average >= 14) return "Bien";
  if (average >= 12) return "Assez bien";
  if (average >= 10) return "Passable";
  return "Insuffisant";
}

/** Ton de la pastille de moyenne, aligné sur les statuts (tokens sémantiques). */
export function averageTone(average: number | null): "accent" | "attention" | "neutral" | "danger" {
  if (average === null) return "neutral";
  if (average >= 10) return "accent";
  if (average >= 8) return "attention";
  return "danger";
}

/** « 12,5/20 » — la virgule décimale française, jamais de point. */
export function formatAverage(average: number | null): string {
  if (average === null) return "—";
  return `${average.toFixed(2).replace(".", ",")}/20`;
}

/** Résumé lisible d'un bilan : « 3 devoirs notés sur 5 ». */
export function formatGradedCount(summary: GradeSummary): string {
  const { graded, total } = summary;
  if (total === 0) return "aucun devoir";
  if (graded === 0) return `0 devoir noté sur ${total}`;
  return `${graded} devoir${graded > 1 ? "s" : ""} noté${graded > 1 ? "s" : ""} sur ${total}`;
}
