import { schema as core } from "@workspace/database";
import { driveFiles } from "@workspace/drive";
import { sql } from "drizzle-orm";
import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { DimensionAxis } from "./dimensions.ts";

/**
 * Schéma du module Sheets — voir docs/modules/sheets.md.
 * Une feuille est un fichier Drive lié ; les cellules sont stockées creuses
 * (`row`, `col` 0-indexées), les formules ne sont jamais stockées calculées.
 */

/** Alignement horizontal d'une cellule (v1 de la mise en forme). */
export type CellStyleAlign = "left" | "center" | "right";

/**
 * Jetons de fond autorisés : jamais de couleur en dur en base, l'interface
 * choisit la teinte réelle de chaque jeton (palette fixe).
 */
import { CELL_STYLE_BACKGROUNDS, type CellStyleBackground } from "./style-palette.ts";

export type { CellStyleBackground };
export { CELL_STYLE_BACKGROUNDS };

/**
 * Mise en forme d'une cellule (v1) : `true` uniquement quand l'attribut est
 * actif (un attribut absent est inactif) ; `null` sur la colonne = aucun style.
 */
export type CellStyle = {
  bold?: true;
  italic?: true;
  align?: CellStyleAlign;
  background?: CellStyleBackground;
};

export const spreadsheets = pgTable(
  "spreadsheets",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    orgId: text("org_id")
      .notNull()
      .references(() => core.organization.id, { onDelete: "cascade" }),
    fileId: uuid("file_id")
      .notNull()
      .references(() => driveFiles.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("spreadsheets_file_uidx").on(table.fileId),
    index("spreadsheets_org_idx").on(table.orgId),
  ],
);

export const sheetTabs = pgTable(
  "sheet_tabs",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    spreadsheetId: uuid("spreadsheet_id")
      .notNull()
      .references(() => spreadsheets.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    position: integer("position").notNull(),
  },
  (table) => [index("sheet_tabs_spreadsheet_idx").on(table.spreadsheetId)],
);

export const sheetCells = pgTable(
  "sheet_cells",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    tabId: uuid("tab_id")
      .notNull()
      .references(() => sheetTabs.id, { onDelete: "cascade" }),
    row: integer("row").notNull(),
    col: integer("col").notNull(),
    value: text("value").notNull(),
    style: jsonb("style").$type<CellStyle>(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [uniqueIndex("sheet_cells_tab_row_col_uidx").on(table.tabId, table.row, table.col)],
);

/**
 * Dimensions persistées de la grille (largeur d'une colonne, hauteur d'une
 * ligne) par onglet et par index. Seules les tailles qui diffèrent du défaut
 * sont stockées ; une taille revenue au défaut retire sa ligne.
 */
export const sheetDimensions = pgTable(
  "sheet_dimensions",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    tabId: uuid("tab_id")
      .notNull()
      .references(() => sheetTabs.id, { onDelete: "cascade" }),
    /** Axe concerné : « col » (largeur) ou « row » (hauteur). */
    axis: text("axis").$type<DimensionAxis>().notNull(),
    /** Index 0-basé de la colonne ou de la ligne sur cet axe. */
    index: integer("index").notNull(),
    /** Taille en pixels, bornée par l'interface. */
    size: integer("size").notNull(),
  },
  (table) => [
    uniqueIndex("sheet_dimensions_tab_axis_index_uidx").on(table.tabId, table.axis, table.index),
  ],
);

export type SpreadsheetRow = typeof spreadsheets.$inferSelect;
export type SheetTabRow = typeof sheetTabs.$inferSelect;
export type SheetCellRow = typeof sheetCells.$inferSelect;
export type SheetDimensionRow = typeof sheetDimensions.$inferSelect;
