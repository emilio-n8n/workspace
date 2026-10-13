/**
 * Notes du présentateur, par diapositive.
 *
 * Règles partagées par l'éditeur, le mode présentation et le service (une
 * seule vérité pour la limite de caractères) : ce module ne dépend de rien,
 * il est donc testable sans navigateur ni base.
 */

/** Longueur maximale des notes d'une diapositive (borne du service). */
export const MAX_NOTES_CHARS = 5000;

/** Espace fine insécable : séparateur de milliers à la française. */
const THIN_NBSP = "\u202f";

/** Phrase affichée quand une diapositive n'a pas de note. */
export const NOTES_EMPTY_HINT = "Aucune note pour cette diapositive.";

/** Formate un entier à la française (« 5 000 », « 12 »). */
export function formatCount(value: number): string {
  const safe = Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
  return String(safe).replace(/\B(?=(\d{3})+(?!\d))/g, THIN_NBSP);
}

/**
 * Notes prêtes à être enregistrées : nettoyées, ou null si vides. Une note
 * vide ne crée pas de ligne inutile côté service.
 */
export function notesForSave(notes: string | null | undefined): string | null {
  const trimmed = (notes ?? "").trim();
  return trimmed.length === 0 ? null : trimmed;
}

/** Caractères encore autorisés avant la limite. */
export function notesRemaining(notes: string | null | undefined): number {
  return Math.max(0, MAX_NOTES_CHARS - (notes ?? "").length);
}

/** Libellé du compteur sous le champ (« 12 / 5 000 caractères »). */
export function notesCounterLabel(notes: string | null | undefined): string {
  return `${formatCount((notes ?? "").length)} / ${formatCount(MAX_NOTES_CHARS)} caractères`;
}

/** Note affichable : texte nettoyé et indicateur de vacuité (état vide). */
export function presenterNote(notes: string | null | undefined): { text: string; empty: boolean } {
  const text = (notes ?? "").trim();
  return { text: text.length === 0 ? NOTES_EMPTY_HINT : text, empty: text.length === 0 };
}

/**
 * Durée écoulée de présentation : « mm:ss », puis « h:mm:ss » au-delà d'une
 * heure. Sert au chronomètre du mode présentation.
 */
export function formatElapsed(totalSeconds: number): string {
  const total = Math.max(0, Math.trunc(Number.isFinite(totalSeconds) ? totalSeconds : 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}
