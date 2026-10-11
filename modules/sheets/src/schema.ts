import { schema as core } from "@workspace/database";
import { driveFiles } from "@workspace/drive";
import { sql } from "drizzle-orm";
import { index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

/**
 * Schéma du module Sheets — voir docs/modules/sheets.md.
 * Une feuille est un fichier Drive lié ; les cellules sont stockées creuses
 * (`row`, `col` 0-indexées), les formules ne sont jamais stockées calculées.
 */

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
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [uniqueIndex("sheet_cells_tab_row_col_uidx").on(table.tabId, table.row, table.col)],
);

export type SpreadsheetRow = typeof spreadsheets.$inferSelect;
export type SheetTabRow = typeof sheetTabs.$inferSelect;
export type SheetCellRow = typeof sheetCells.$inferSelect;
