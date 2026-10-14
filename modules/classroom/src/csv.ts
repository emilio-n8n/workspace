/**
 * Export CSV du carnet de notes — logique pure, sans base ni navigateur. Le
 * classeur produit se lit dans Excel comme dans LibreOffice : séparateur
 * virgule, champs cités dès qu'ils contiennent une virgule, un guillemet ou un
 * saut de ligne, et neutralisation des formules — un nom d'élève ne doit jamais
 * s'exécuter à l'ouverture.
 */
import type { GradeSummary } from "./grades.ts";

/** Préfixes interprétés comme formules par les tableurs. */
const FORMULA_PREFIX = /^[=+\-@\t\r]/;

/**
 * Neutralise une injection de formule (préfixe `'`) puis cite la valeur si
 * nécessaire. Exporté pour les tests.
 */
export function csvCell(value: string): string {
  const neutralized = FORMULA_PREFIX.test(value) ? `'${value}` : value;
  if (/[",\r\n]/.test(neutralized)) {
    return `"${neutralized.replaceAll('"', '""')}"`;
  }
  return neutralized;
}

/** Un devoir devient une colonne : son titre et son barème. */
export type GradebookColumn = { title: string; points: number };

/** Une ligne du classeur : un élève, ses notes et sa moyenne. */
export type GradebookRow = {
  name: string;
  /** Une note par colonne (`null` = non noté), dans l'ordre des colonnes. */
  grades: (number | null)[];
  summary: GradeSummary;
};

export type GradebookCsvInput = {
  columns: GradebookColumn[];
  rows: GradebookRow[];
};

/** En-tête de colonne : « Devoir (sur 20) ». */
function columnHeader(column: GradebookColumn): string {
  return `${column.title} (sur ${column.points})`;
}

/** Une note vide reste vide : pas de zéro inventé pour un devoir non noté. */
function gradeCell(grade: number | null): string {
  return grade === null ? "" : String(grade);
}

/** Moyenne à la française, deux décimales et virgule ; vide sans note. */
function averageCell(average: number | null): string {
  return average === null ? "" : average.toFixed(2).replace(".", ",");
}

/**
 * Classeur CSV complet : une ligne d'en-tête (Élève, une colonne par devoir,
 * puis moyenne, points et devoirs notés), une ligne par élève, fins de ligne
 * CRLF et saut final — le format RFC 4180 attendu aux deux bouts.
 */
export function buildGradebookCsv(input: GradebookCsvInput): string {
  const header = [
    "Élève",
    ...input.columns.map(columnHeader),
    "Moyenne sur 20",
    "Points obtenus",
    "Points possibles",
    "Devoirs notés",
  ];

  const lines = [header.map(csvCell).join(",")];
  for (const row of input.rows) {
    const cells = [
      row.name,
      ...input.columns.map((_, index) => gradeCell(row.grades[index] ?? null)),
      averageCell(row.summary.average),
      String(row.summary.earned),
      String(row.summary.possible),
      String(row.summary.graded),
    ];
    lines.push(cells.map(csvCell).join(","));
  }

  return `${lines.join("\r\n")}\r\n`;
}
