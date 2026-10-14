/**
 * Palette et bornes de mise en forme : valeurs PURES partagées par l'interface
 * (sélecteur de fond, limites) et le serveur (schéma Drizzle, validators zod).
 *
 * Ce module ne doit JAMAIS importer de dépendance serveur (database, storage) :
 * il est évalué dans le bundle client (importé par l'éditeur et par les
 * validators des server fns compilés côté client).
 */

/** Jetons de fond autorisés : jamais de couleur en dur en base. */
export const CELL_STYLE_BACKGROUNDS = ["accent", "attention", "danger", "muted"] as const;
export type CellStyleBackground = (typeof CELL_STYLE_BACKGROUNDS)[number];

/**
 * Jetons de couleur de TEXTE autorisés (stockés) : le défaut n'est jamais
 * persisté — l'absence de clé est le défaut, comme pour les attributs booléens.
 */
export const CELL_TEXT_COLORS = ["muted", "accent", "attention", "danger"] as const;
export type CellTextColor = (typeof CELL_TEXT_COLORS)[number];

/** Plafond de cellules mises en forme par feuille. */
export const MAX_STYLE_CELLS = 500;
