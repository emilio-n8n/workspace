/**
 * État des filtres de la liste — règles pures, testées sans navigateur.
 * Un filtre est toujours visible et toujours annulable un par un ; rien
 * n'applique un filtre en silence.
 */

/** Longueur maximisée d'un critère de filtre (alignée sur le service). */
export const MAX_FILTER_LENGTH = 100;

export type MailFilters = {
  /** Recherche plein texte (objet, expéditeur, corps). */
  query: string;
  /** Filtre par expéditeur. */
  from: string;
  /** Filtre par destinataire. */
  to: string;
  unreadOnly: boolean;
  starredOnly: boolean;
  hasAttachment: boolean;
  /** Libellé sélectionné dans le panneau latéral. */
  labelId: string | null;
};

export const EMPTY_FILTERS: MailFilters = {
  query: "",
  from: "",
  to: "",
  unreadOnly: false,
  starredOnly: false,
  hasAttachment: false,
  labelId: null,
};

export type FilterChip = {
  /** Clé du filtre, utilisée pour le retirer. */
  key: keyof MailFilters;
  /** Texte affiché, en français, prêt à lire. */
  label: string;
};

/** Trois états de filtre possible, exposés pour les tests. */
export function filtersEqual(left: MailFilters, right: MailFilters): boolean {
  return (Object.keys(EMPTY_FILTERS) as (keyof MailFilters)[]).every(
    (key) => left[key] === right[key],
  );
}

/** Nettoie un critère de filtre saisi (espaces, casse, borne). */
export function normalizeFilterValue(value: string, maxLength = MAX_FILTER_LENGTH): string {
  return value.trim().replace(/\s+/g, " ").slice(0, maxLength);
}

/** Vrai si au moins un filtre est actif (hors libellé, géré à part). */
export function hasActiveFilters(filters: MailFilters): boolean {
  return activeFilters(filters).length > 0;
}

/**
 * Filtres actifs, dans l'ordre d'affichage du bandeau. La recherche plein
 * texte est nommée « Recherche », les autres par leur intitulé de champ.
 */
export function activeFilters(filters: MailFilters, labelName?: string): FilterChip[] {
  const chips: FilterChip[] = [];
  const query = normalizeFilterValue(filters.query);
  if (query.length > 0) chips.push({ key: "query", label: `Recherche : ${query}` });
  const from = normalizeFilterValue(filters.from);
  if (from.length > 0) chips.push({ key: "from", label: `De : ${from}` });
  const to = normalizeFilterValue(filters.to);
  if (to.length > 0) chips.push({ key: "to", label: `À : ${to}` });
  if (filters.unreadOnly) chips.push({ key: "unreadOnly", label: "Non lus" });
  if (filters.starredOnly) chips.push({ key: "starredOnly", label: "Suivis" });
  if (filters.hasAttachment) chips.push({ key: "hasAttachment", label: "Avec pièce jointe" });
  if (filters.labelId) {
    chips.push({ key: "labelId", label: `Libellé : ${labelName ?? "…"}` });
  }
  return chips;
}

/**
 * Valeur d'un filtre remise à zéro — un seul filtre saute à la fois, les
 * autres restent appliqués.
 */
export function clearFilter(filters: MailFilters, key: keyof MailFilters): MailFilters {
  if (key === "labelId") return { ...filters, labelId: null };
  if (key === "unreadOnly" || key === "starredOnly" || key === "hasAttachment") {
    return { ...filters, [key]: false };
  }
  return { ...filters, [key]: "" };
}

/** Résumé lu par les lecteurs d'écran quand les filtres changent. */
export function filtersAnnouncement(
  filters: MailFilters,
  count: number,
  labelName?: string,
): string {
  const active = activeFilters(filters, labelName);
  if (active.length === 0) {
    return `${count} message${count > 1 ? "s" : ""} affiché${count > 1 ? "s" : ""}, aucun filtre.`;
  }
  return `${count} message${count > 1 ? "s" : ""} affiché${count > 1 ? "s" : ""} — filtres : ${active
    .map((chip) => chip.label)
    .join(", ")}.`;
}

/** Libellés du bandeau de filtres (textes fixes, en français). */
export const FILTER_LABELS = {
  query: "Recherche",
  from: "De",
  to: "À",
  unreadOnly: "Non lus",
  starredOnly: "Suivis",
  hasAttachment: "Avec pièce jointe",
  reset: "Réinitialiser les filtres",
  toggle: "Filtres",
  hint: "Astuce : croisez la recherche avec « De », « À » et les filtres.",
} as const;
