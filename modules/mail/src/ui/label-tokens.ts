import { labelColorName } from "../label-colors.ts";

/**
 * Classes dérivées des tokens sémantiques du système de design — aucune
 * couleur libre, aucun hexadécimal. Même rendu en clair et en sombre puisque
 * le token porte déjà la variante.
 */
export function labelDotClasses(color: string): string {
  switch (color) {
    case "vert":
      return "bg-primary";
    case "ambre":
      return "bg-attention";
    case "bleu":
      return "bg-chart-3";
    case "orange":
      return "bg-chart-4";
    case "violet":
      return "bg-chart-5";
    default:
      return "bg-muted-foreground";
  }
}

/** Anneau de sélection d'une pastille (choix de la couleur). */
export function labelSwatchRing(color: string, selected: boolean): string {
  if (!selected) return "ring-transparent";
  return `ring-${labelDotClasses(color).slice(3)}`;
}

/** Texte accessible d'une puce : « Libellé Client, couleur Vert ». */
export function labelChipLabel(label: { name: string; color: string }): string {
  return `Libellé ${label.name}, couleur ${labelColorName(label.color)}`;
}
