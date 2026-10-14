/**
 * Nom d'un élément saisi dans l'interface (dossier, fichier).
 *
 * Le service reste l'autorité : cette validation ne sert qu'à éviter un
 * aller-retour réseau inutile et à expliquer le refus au moment de la frappe.
 * Les règles recopient celles de `assertValidName` (service).
 */

/** Longueurs extrêmes acceptées pour un nom. */
export const NAME_MAX_LENGTH = 255;

/** Caractères interdits, énumérés pour le message d'erreur. */
export const FORBIDDEN_NAME_CHARS = "/\\";

/** Vrai si le caractère est interdit dans un nom (contrôle, séparateurs de chemin). */
export function isForbiddenNameChar(char: string): boolean {
  const code = char.codePointAt(0) ?? 0;
  return code < 0x20 || char === "/" || char === "\\";
}

/**
 * Valide un nom saisi. Retourne `null` si le nom est acceptable, sinon le
 * message d'erreur en français, prêt à être affiché sous le champ.
 */
export function validateEntryName(raw: string): string | null {
  const name = raw.trim();
  if (name.length === 0) return "Le nom est obligatoire.";
  if (name.length > NAME_MAX_LENGTH) {
    return `Le nom ne peut pas dépasser ${NAME_MAX_LENGTH} caractères.`;
  }
  if ([...name].some(isForbiddenNameChar)) {
    return "Le nom ne peut pas contenir de « / », de « \\ » ni de caractères de contrôle.";
  }
  return null;
}

/** Nombre de caractères restants avant la limite (0 une fois atteinte). */
export function remainingNameChars(raw: string): number {
  return Math.max(NAME_MAX_LENGTH - raw.length, 0);
}
