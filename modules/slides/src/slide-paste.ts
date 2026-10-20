/**
 * Collage de texte venu d'ailleurs (presse-papiers système) : une zone de
 * texte est créée — ou le texte s'ajoute à la zone sélectionnée — comme dans
 * PowerPoint. Logique pure : nettoyage, taille et géométrie de la zone.
 */

/** Limite de texte d'un élément (alignée sur le service). */
export const MAX_ELEMENT_TEXT = 2000;

/** Type MIME interne : le presse-papiers porte des éléments de diapositive. */
export const SLIDES_CLIPBOARD_MIME = "application/x-workspace-slides";

/** Normalise un texte collé : fins de ligne, tabulations, bornes, longueur. */
export function cleanPastedText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/\t/g, "  ")
    .split("")
    .filter((char) => {
      // Caractères de contrôle retirés, sauf le saut de ligne.
      const code = char.charCodeAt(0);
      return code === 10 || code >= 32;
    })
    .join("")
    .replace(/^\n+|\s+$/g, "")
    .slice(0, MAX_ELEMENT_TEXT);
}

/** Ajoute le texte collé à une zone existante (vide : il la remplit). */
export function appendPastedText(existing: string, pasted: string): string {
  const clean = cleanPastedText(pasted);
  if (existing.trim().length === 0) return clean;
  return `${existing}${clean}`.slice(0, MAX_ELEMENT_TEXT);
}

/**
 * Géométrie d'une zone de texte créée par collage : hauteur selon le nombre
 * de lignes (bornée), taille de police plus petite pour un long texte.
 */
export function pastedTextBox(text: string): {
  x: number;
  y: number;
  w: number;
  h: number;
  fontSize: number;
} {
  const clean = cleanPastedText(text);
  const lines = clean.length === 0 ? 1 : clean.split("\n").length;
  const fontSize = clean.length > 400 || lines > 8 ? 16 : clean.length > 120 ? 20 : 24;
  const lineHeightPct = (fontSize * 1.25 * 100) / 540;
  const wrapped = lines + Math.floor(clean.length / 80);
  const h = Math.min(80, Math.max(10, Math.round(wrapped * lineHeightPct + 4)));
  const w = 60;
  return { x: 20, y: Math.max(5, Math.round((100 - h) / 2)), w, h, fontSize };
}
