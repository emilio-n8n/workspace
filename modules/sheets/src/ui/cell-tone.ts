import type { CellValue } from "../formula.ts";

/**
 * Nature d'une valeur affichée — dérivée du résultat du moteur de formules et
 * partagée par la grille et la barre de formule (une seule teinte par nature,
 * jamais de couleur codée en dur).
 */
export type CellTone = "number" | "error" | "text";

/** Teinte d'une valeur calculée : nombre aligné à droite, erreur en alerte. */
export function toneOf(value: CellValue | undefined): CellTone {
  if (value?.kind === "number") return "number";
  if (value?.kind === "error") return "error";
  return "text";
}

/** Vrai quand la valeur brute est une formule (commence par « = »). */
export function isFormulaValue(raw: string): boolean {
  return raw.trimStart().startsWith("=");
}
