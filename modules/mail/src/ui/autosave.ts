/**
 * Brouillon automatique du compositeur — règles pures, testées sans
 * navigateur : quand enregistrer, et quoi dire à l'utilisateur.
 *
 * Le compositeur ne perd jamais une saisie : tant qu'il contient quelque
 * chose, un enregistrement est proposé après une pause de frappe. Rien n'est
 * jamais écrit pour un compositeur vide (pas de brouillon fantôme).
 */

/** Pause de frappe déclenchant l'enregistrement automatique. */
export const AUTOSAVE_DELAY_MS = 1500;
/** Délai minimal entre deux enregistrements automatiques. */
export const AUTOSAVE_MIN_INTERVAL_MS = 4000;

export type DraftContent = {
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  body: string;
};

export type AutosaveState = "idle" | "pending" | "saving" | "saved" | "error";

/** Vrai si le compositeur contient assez pour mériter un brouillon. */
export function hasDraftContent(draft: DraftContent): boolean {
  return (
    draft.to.length > 0 ||
    draft.cc.length > 0 ||
    draft.bcc.length > 0 ||
    draft.subject.trim().length > 0 ||
    draft.body.trim().length > 0
  );
}

export type AutosaveDecisionInput = {
  /** Contenu courant du compositeur. */
  draft: DraftContent;
  /** Des changements n'ont pas encore été enregistrés. */
  dirty: boolean;
  /** Un enregistrement est en cours. */
  saving: boolean;
  /** Horodatage du dernier enregistrement automatique (null : jamais). */
  lastSavedAt: number | null;
  now: number;
  /** Le compositeur porte des pièces jointes en cours de téléversement. */
  uploading?: boolean;
};

/**
 * Décide de l'enregistrement automatique. Un téléversement en cours bloque la
 * décision (les métadonnées du brouillon doivent être stables), et une
 * cadence minimale évite les rafales quand l'utilisateur tape lentement.
 */
export function shouldAutosave(input: AutosaveDecisionInput): boolean {
  if (!hasDraftContent(input.draft)) return false;
  if (!input.dirty || input.saving) return false;
  if (input.uploading) return false;
  if (input.lastSavedAt !== null && input.now - input.lastSavedAt < AUTOSAVE_MIN_INTERVAL_MS) {
    return false;
  }
  return true;
}

/** Message d'état affiché sous le champ de saisie du compositeur. */
export function autosaveLabel(state: AutosaveState, savedAt: Date | null): string | null {
  switch (state) {
    case "idle":
      return null;
    case "pending":
      return "Enregistrement du brouillon…";
    case "saving":
      return "Enregistrement du brouillon…";
    case "saved":
      return savedAt ? `Brouillon enregistré à ${formatClock(savedAt)}` : "Brouillon enregistré";
    case "error":
      return "Enregistrement automatique impossible — utilisez « Enregistrer en brouillon ».";
  }
}

/** Heure locale au format 24 h français (14:05). */
export function formatClock(date: Date): string {
  return date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

/**
 * Pièces jointes et brouillon : elles ne sont pas encore rattachables (le
 * service les lie à l'envoi). La mention rassure sans bloquer la saisie.
 */
export const ATTACHMENTS_DRAFT_NOTICE =
  "Les pièces jointes sont jointes à l'envoi ; elles ne sont pas encore conservées dans le brouillon.";
