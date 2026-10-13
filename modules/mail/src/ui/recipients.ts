/**
 * Règles de saisie des destinataires (À, Cc, Cci) — fonctions pures, testées
 * sans navigateur, partagées par les trois champs du compositeur.
 *
 * Convention : le champ de saisie reste une zone de texte libre ; les
 * destinataires validés deviennent des puces (chips). Une puce n'est pas un
 * engagement : elle est seulement proposée, l'envoi revalide tout.
 */

/** Séparateurs acceptés entre deux adresses : virgule, point-virgule, espace, retour à la ligne. */
const SEPARATORS = /[,;\s]+/;

/** Les trois champs de destinataires du compositeur. */
export const RECIPIENT_FIELDS = ["to", "cc", "bcc"] as const;
export type RecipientField = (typeof RECIPIENT_FIELDS)[number];

export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type RecipientChip = {
  /** Adresse normalisée (minuscules, sans espaces) — clé stable de la puce. */
  value: string;
  /** Texte tel que tapé par l'utilisateur, affiché dans la puce. */
  label: string;
};

/** Nombre maximal de destinataires distincts, aligné sur le service. */
export const MAX_RECIPIENT_CHIPS = 20;

export const FIELD_LABELS: Record<RecipientField, string> = {
  to: "destinataire",
  cc: "copie",
  bcc: "copie cachée",
};

/** Découpe une saisie libre en adresses candidates (une entrée par séparateur). */
export function parseRecipientInput(value: string): string[] {
  return value
    .split(SEPARATORS)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

/** Vrai si l'adresse a une forme exploitable (le serveur reste l'autorité). */
export function isValidRecipient(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length > 0 && EMAIL_PATTERN.test(trimmed) && !/\s/.test(trimmed);
}

/** Normalise une adresse pour la comparer (minuscules, espaces retirés). */
export function normalizeRecipient(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Transforme une saisie en puces : chaque adresse valide devient une puce, les
 * doublons (déjà présents ou répétés dans la saisie) sont absorbés, le reste
 * reste dans le champ. `limit` borne le total — au-delà, les adresses
 * excédentaires retournent dans le champ plutôt que d'être perdues.
 */
export function inputToChips(
  value: string,
  existing: RecipientChip[],
  limit = MAX_RECIPIENT_CHIPS,
): { chips: RecipientChip[]; rest: string } {
  const entries = parseRecipientInput(value);
  const chips = [...existing];
  const known = new Set(chips.map((chip) => normalizeRecipient(chip.value)));
  const rest: string[] = [];

  for (const entry of entries) {
    if (!isValidRecipient(entry)) {
      rest.push(entry);
      continue;
    }
    const key = normalizeRecipient(entry);
    if (known.has(key)) continue;
    if (chips.length >= limit) {
      rest.push(entry);
      continue;
    }
    known.add(key);
    chips.push({ value: key, label: entry });
  }

  return { chips, rest: rest.join(", ") };
}

/** Adresses normalisées d'une liste de puces — ce que le serveur reçoit. */
export function chipsToAddresses(chips: RecipientChip[]): string[] {
  return chips.map((chip) => chip.value);
}

/** Puce(s) issue(s) d'une liste d'adresses déjà enregistrées (brouillon, message). */
export function addressesToChips(addresses: string[] | undefined): RecipientChip[] {
  return (addresses ?? []).map((address) => ({
    value: normalizeRecipient(address),
    label: address.trim(),
  }));
}

/**
 * Total de destinataires distincts sur les trois champs, texte en cours de
 * saisie compris : sert à appliquer la règle des 20 avant l'envoi.
 */
export function countRecipients(
  lists: Record<RecipientField, RecipientChip[]>,
  draft = "",
): number {
  const distinct = new Set<string>();
  for (const field of RECIPIENT_FIELDS) {
    for (const chip of lists[field]) distinct.add(chip.value);
  }
  for (const entry of parseRecipientInput(draft)) {
    if (isValidRecipient(entry)) distinct.add(normalizeRecipient(entry));
  }
  return distinct.size;
}

/**
 * Retire la dernière puce d'une liste (rappelle le comportement attendu quand
 * l'utilisateur efface un champ vide : la puce précédente disparaît).
 */
export function removeLastChip(chips: RecipientChip[]): RecipientChip[] {
  return chips.slice(0, -1);
}

/** Libellé accessible d'une puce : « Retirer amine@exemple.org (destinataire) ». */
export function chipRemoveLabel(chip: RecipientChip, field: RecipientField): string {
  return `Retirer ${chip.value} (${FIELD_LABELS[field]})`;
}
