import { getDb, withTransaction } from "@workspace/database";
import {
  createLinkedFile,
  type DriveEntry,
  DriveError,
  rename as driveRename,
  effectiveRole,
  getEntry,
  touchEntry,
} from "@workspace/drive";
import { type Actor, roleSatisfies } from "@workspace/permissions";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { MAX_CELL_CHARS, MAX_COLS, MAX_ROWS, parseCsv } from "./csv.ts";
import { cellKey, evaluateCells, formatValue } from "./formula.ts";
import { type SheetTabRow, sheetCells, sheetTabs, spreadsheets } from "./schema.ts";

export { MAX_CELL_CHARS, MAX_COLS, MAX_ROWS } from "./csv.ts";

/** Type MIME du pointeur Drive d'une feuille de calcul Workspace. */
export const SHEETS_MIME = "application/vnd.workspace.sheets+json";

const MAX_UPDATES_PER_SAVE = 2000;
const MAX_CELLS_PER_LOAD = 50_000;
const MAX_CELLS_PER_IMPORT = 20_000;
/** Taille des lots d'écriture (4 colonnes par ligne, bien sous la limite de paramètres PG). */
const SAVE_CHUNK = 500;
/** Nombre maximal d'onglets par feuille. */
export const MAX_TABS = 20;

export type SheetsErrorCode = "not_found" | "forbidden" | "validation" | "conflict";

export class SheetsError extends Error {
  readonly code: SheetsErrorCode;
  constructor(code: SheetsErrorCode, message: string) {
    super(message);
    this.name = "SheetsError";
    this.code = code;
  }
}

export type TabView = { id: string; name: string; position: number };
export type CellView = { row: number; col: number; value: string };

export type SpreadsheetDetail = {
  fileId: string;
  title: string;
  canEdit: boolean;
  tabs: TabView[];
  cells: (CellView & { tabId: string })[];
  /** Vrai quand la limite de chargement des cellules (50 000) est atteinte. */
  truncated: boolean;
};

const db = () => getDb();

function assertTitle(title: string): string {
  const trimmed = title.trim();
  if (trimmed.length < 1 || trimmed.length > 255) {
    throw new SheetsError("validation", "Le titre doit contenir entre 1 et 255 caractères.");
  }
  return trimmed;
}

function assertTabName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length < 1 || trimmed.length > 120) {
    throw new SheetsError("validation", "Le nom d'onglet doit contenir entre 1 et 120 caractères.");
  }
  return trimmed;
}

async function requireSpreadsheet(
  actor: Actor,
  fileId: string,
): Promise<{ entry: DriveEntry; spreadsheet: { id: string; orgId: string; fileId: string } }> {
  let entry: DriveEntry;
  try {
    entry = await getEntry(actor, fileId);
  } catch (error) {
    // Le module expose ses propres erreurs typées, jamais celles de Drive.
    if (error instanceof DriveError) {
      throw new SheetsError("not_found", "Feuille de calcul introuvable.");
    }
    throw error;
  }
  if (entry.mimeType !== SHEETS_MIME) {
    throw new SheetsError("not_found", "Feuille de calcul introuvable.");
  }
  const [row] = await db()
    .select()
    .from(spreadsheets)
    .where(eq(spreadsheets.fileId, fileId))
    .limit(1);
  if (!row || row.orgId !== actor.orgId) {
    throw new SheetsError("not_found", "Feuille de calcul introuvable.");
  }
  return { entry, spreadsheet: row };
}

async function requireEditor(actor: Actor, fileId: string): Promise<void> {
  const role = await effectiveRole(actor, fileId);
  if (!roleSatisfies(role, "write")) {
    throw new SheetsError("forbidden", "Permission insuffisante pour modifier cette feuille.");
  }
}

async function requireTab(
  actor: Actor,
  tabId: string,
): Promise<{ tab: SheetTabRow; fileId: string }> {
  const [tab] = await db().select().from(sheetTabs).where(eq(sheetTabs.id, tabId)).limit(1);
  if (!tab) throw new SheetsError("not_found", "Onglet introuvable.");
  const [spreadsheet] = await db()
    .select()
    .from(spreadsheets)
    .where(eq(spreadsheets.id, tab.spreadsheetId))
    .limit(1);
  if (!spreadsheet) throw new SheetsError("not_found", "Onglet introuvable.");
  // Contrôle complet (MIME, organisation, corbeille, visibilité) avant le droit d'écriture.
  await requireSpreadsheet(actor, spreadsheet.fileId);
  await requireEditor(actor, spreadsheet.fileId);
  return { tab, fileId: spreadsheet.fileId };
}

// ---------------------------------------------------------------------------
// Cycle de vie
// ---------------------------------------------------------------------------

export async function createSpreadsheet(
  actor: Actor,
  input: { parentFolderId?: string | null; title: string },
): Promise<{ entry: DriveEntry; spreadsheet: { id: string; fileId: string } }> {
  const title = assertTitle(input.title);

  const entry = await createLinkedFile(actor, {
    parentId: input.parentFolderId ?? null,
    name: title,
    mimeType: SHEETS_MIME,
  });

  const spreadsheet = await withTransaction(async (tx) => {
    const [created] = await tx
      .insert(spreadsheets)
      .values({ orgId: actor.orgId, fileId: entry.id })
      .returning({ id: spreadsheets.id, fileId: spreadsheets.fileId });
    if (!created) throw new SheetsError("conflict", "Création de la feuille impossible.");
    await tx
      .insert(sheetTabs)
      .values({ spreadsheetId: created.id, name: "Feuille 1", position: 0 });
    return created;
  });

  return { entry, spreadsheet };
}

export async function getSpreadsheet(actor: Actor, fileId: string): Promise<SpreadsheetDetail> {
  const { entry, spreadsheet } = await requireSpreadsheet(actor, fileId);
  const role = await effectiveRole(actor, fileId);

  const tabs = await db()
    .select({ id: sheetTabs.id, name: sheetTabs.name, position: sheetTabs.position })
    .from(sheetTabs)
    .where(eq(sheetTabs.spreadsheetId, spreadsheet.id))
    .orderBy(asc(sheetTabs.position));

  const tabIds = tabs.map((tab) => tab.id);
  const cells =
    tabIds.length > 0
      ? await db()
          .select({
            tabId: sheetCells.tabId,
            row: sheetCells.row,
            col: sheetCells.col,
            value: sheetCells.value,
          })
          .from(sheetCells)
          .where(inArray(sheetCells.tabId, tabIds))
          .orderBy(asc(sheetCells.tabId), asc(sheetCells.row), asc(sheetCells.col))
          .limit(MAX_CELLS_PER_LOAD)
      : [];

  return {
    fileId: entry.id,
    title: entry.name,
    canEdit: roleSatisfies(role, "write"),
    tabs,
    cells,
    truncated: cells.length >= MAX_CELLS_PER_LOAD,
  };
}

// ---------------------------------------------------------------------------
// Écriture de cellules (sauvegarde et import)
// ---------------------------------------------------------------------------

type CellUpdate = { row: number; col: number; value: string };

/** Cellule dans les bornes de la grille et sous la limite de caractères. */
function assertCell(update: CellUpdate): void {
  if (
    !Number.isInteger(update.row) ||
    !Number.isInteger(update.col) ||
    update.row < 0 ||
    update.row >= MAX_ROWS ||
    update.col < 0 ||
    update.col >= MAX_COLS
  ) {
    throw new SheetsError("validation", "Cellule hors limites.");
  }
  if (update.value.length > MAX_CELL_CHARS) {
    throw new SheetsError("validation", `Cellule limitée à ${MAX_CELL_CHARS} caractères.`);
  }
}

/** Upsert multi-lignes par lots — chemin d'écriture partagé sauvegarde / import. */
async function upsertCells(
  tx: Parameters<Parameters<typeof withTransaction>[0]>[0],
  tabId: string,
  upserts: CellUpdate[],
): Promise<void> {
  for (let offset = 0; offset < upserts.length; offset += SAVE_CHUNK) {
    const chunk = upserts.slice(offset, offset + SAVE_CHUNK);
    await tx
      .insert(sheetCells)
      .values(
        chunk.map((update) => ({
          tabId,
          row: update.row,
          col: update.col,
          value: update.value,
        })),
      )
      .onConflictDoUpdate({
        target: [sheetCells.tabId, sheetCells.row, sheetCells.col],
        set: { value: sql`excluded.value` },
      });
  }
}

/** Sauvegarde par lots de cellules (mise à jour creuse, valeur vide = efface). */
export async function saveCells(
  actor: Actor,
  fileId: string,
  input: { tabId: string; updates: { row: number; col: number; value: string }[] },
): Promise<{ saved: number }> {
  const { spreadsheet } = await requireSpreadsheet(actor, fileId);
  await requireEditor(actor, fileId);

  // Dédoublonnage par cellule, la dernière valeur gagne — la limite porte sur
  // le lot effectivement écrit, pas sur les entrées brutes.
  const deduped = new Map<string, { row: number; col: number; value: string }>();
  for (const update of input.updates) {
    deduped.set(`${update.row}:${update.col}`, update);
  }
  const updates = [...deduped.values()];

  if (updates.length > MAX_UPDATES_PER_SAVE) {
    throw new SheetsError("validation", `Sauvegarde limitée à ${MAX_UPDATES_PER_SAVE} cellules.`);
  }

  const [tab] = await db()
    .select({ id: sheetTabs.id })
    .from(sheetTabs)
    .where(and(eq(sheetTabs.id, input.tabId), eq(sheetTabs.spreadsheetId, spreadsheet.id)))
    .limit(1);
  if (!tab) throw new SheetsError("not_found", "Onglet introuvable.");

  for (const update of updates) {
    assertCell(update);
  }

  const deletions = updates.filter((update) => update.value === "");
  const upserts = updates.filter((update) => update.value !== "");

  await withTransaction(async (tx) => {
    if (deletions.length > 0) {
      const rows = sql.join(
        deletions.map((update) => sql`${update.row}`),
        sql`, `,
      );
      const cols = sql.join(
        deletions.map((update) => sql`${update.col}`),
        sql`, `,
      );
      await tx.execute(sql`
        delete from ${sheetCells}
        where ${sheetCells.tabId} = ${tab.id}
          and (${sheetCells.row}, ${sheetCells.col}) in (
            select d.r, d.c
            from unnest(array[${rows}]::int[], array[${cols}]::int[]) as d(r, c)
          )
      `);
    }

    await upsertCells(tx, tab.id, upserts);
  });

  await touchEntry(actor, fileId).catch(() => undefined);
  return { saved: updates.length };
}

/**
 * Importe un texte CSV dans un onglet : le contenu actuel de l'onglet est
 * remplacé (suppression puis insertion par lots), les cellules vides n'étant
 * pas stockées. Passe par `parseCsv` (limites de la grille) puis contrôle le
 * plafond global de cellules avant toute écriture.
 */
export async function importCsv(
  actor: Actor,
  fileId: string,
  input: { tabId: string; text: string },
): Promise<{ imported: number }> {
  const { spreadsheet } = await requireSpreadsheet(actor, fileId);
  await requireEditor(actor, fileId);

  const [tab] = await db()
    .select({ id: sheetTabs.id })
    .from(sheetTabs)
    .where(and(eq(sheetTabs.id, input.tabId), eq(sheetTabs.spreadsheetId, spreadsheet.id)))
    .limit(1);
  if (!tab) throw new SheetsError("not_found", "Onglet introuvable.");

  const rows = parseCsv(input.text);
  // Une ligne vide n'est pas une donnée (le parseur restitue la ligne telle
  // quelle ; le service ne garde que les lignes qui portent au moins une cellule).
  const dataRows = rows.filter((row) => row.some((cell) => cell !== ""));
  if (dataRows.length === 0) {
    throw new SheetsError("validation", "Aucune donnée à importer.");
  }
  const total = dataRows.reduce((count, row) => count + row.length, 0);
  if (total > MAX_CELLS_PER_IMPORT) {
    throw new SheetsError("validation", `Import limité à ${MAX_CELLS_PER_IMPORT} cellules.`);
  }

  const updates: CellUpdate[] = [];
  dataRows.forEach((row, rowIndex) => {
    row.forEach((value, col) => {
      if (value !== "") updates.push({ row: rowIndex, col, value });
    });
  });
  for (const update of updates) assertCell(update);

  await withTransaction(async (tx) => {
    // Remplacement atomique : un import raté ne vide jamais l'onglet.
    await tx.delete(sheetCells).where(eq(sheetCells.tabId, tab.id));
    await upsertCells(tx, tab.id, updates);
  });

  await touchEntry(actor, fileId).catch(() => undefined);
  return { imported: updates.length };
}

export async function addTab(actor: Actor, fileId: string, name: string): Promise<TabView[]> {
  const { spreadsheet } = await requireSpreadsheet(actor, fileId);
  await requireEditor(actor, fileId);
  const clean = assertTabName(name);

  // Verrouillage de la feuille (SELECT … FOR UPDATE) : le décompte et
  // l'insertion sont ainsi sérialisés face aux ajouts concurrents.
  return withTransaction(async (tx) => {
    const [locked] = await tx
      .select({ id: spreadsheets.id })
      .from(spreadsheets)
      .where(eq(spreadsheets.id, spreadsheet.id))
      .for("update");
    if (!locked) throw new SheetsError("not_found", "Feuille de calcul introuvable.");

    const [countRow] = await tx
      .select({ value: sql<number>`count(*)`.mapWith(Number) })
      .from(sheetTabs)
      .where(eq(sheetTabs.spreadsheetId, spreadsheet.id));
    const count = countRow?.value ?? 0;
    if (count >= MAX_TABS) {
      throw new SheetsError("validation", `${MAX_TABS} onglets au maximum.`);
    }

    await tx
      .insert(sheetTabs)
      .values({ spreadsheetId: spreadsheet.id, name: clean, position: count });

    return tx
      .select({ id: sheetTabs.id, name: sheetTabs.name, position: sheetTabs.position })
      .from(sheetTabs)
      .where(eq(sheetTabs.spreadsheetId, spreadsheet.id))
      .orderBy(asc(sheetTabs.position));
  });
}

export async function renameTab(actor: Actor, tabId: string, name: string): Promise<void> {
  const { tab } = await requireTab(actor, tabId);
  await db()
    .update(sheetTabs)
    .set({ name: assertTabName(name) })
    .where(eq(sheetTabs.id, tab.id));
}

export async function deleteTab(actor: Actor, tabId: string): Promise<void> {
  const { tab } = await requireTab(actor, tabId);

  // Suppression conditionnelle en une seule instruction : la sous-requête
  // garantit qu'il reste au moins un onglet, même en cas de course (TOCTOU).
  const result = await db().execute(sql`
    delete from ${sheetTabs}
    where ${sheetTabs.id} = ${tab.id}
      and (
        select count(*) from ${sheetTabs} where ${sheetTabs.spreadsheetId} = ${tab.spreadsheetId}
      ) > 1
    returning ${sheetTabs.id}
  `);
  if (result.rows.length === 0) {
    throw new SheetsError("validation", "Une feuille doit conserver au moins un onglet.");
  }
}

// ---------------------------------------------------------------------------
// Export CSV (valeurs calculées)
// ---------------------------------------------------------------------------

/** Préfixes interprétés comme formules par Excel / Google Sheets. */
const CSV_FORMULA_PREFIX = /^[=+\-@\t\r]/;

/**
 * Neutralise l'injection de formule (préfixe `'`) puis cite la valeur si elle
 * contient un séparateur ou un guillemet. Exporté pour les tests.
 */
export function csvCell(value: string): string {
  const neutralized = CSV_FORMULA_PREFIX.test(value) ? `'${value}` : value;
  if (/[",\r\n;]/.test(neutralized)) {
    return `"${neutralized.replaceAll('"', '""')}"`;
  }
  return neutralized;
}

export async function exportSpreadsheetCsv(
  actor: Actor,
  fileId: string,
  tabId: string,
): Promise<{ name: string; contentType: string; body: string }> {
  const { entry, spreadsheet } = await requireSpreadsheet(actor, fileId);
  const [tab] = await db()
    .select()
    .from(sheetTabs)
    .where(and(eq(sheetTabs.id, tabId), eq(sheetTabs.spreadsheetId, spreadsheet.id)))
    .limit(1);
  if (!tab) throw new SheetsError("not_found", "Onglet introuvable.");

  const rows = await db()
    .select({ row: sheetCells.row, col: sheetCells.col, value: sheetCells.value })
    .from(sheetCells)
    .where(eq(sheetCells.tabId, tab.id))
    .limit(MAX_CELLS_PER_LOAD);

  const map: Record<string, string> = {};
  let maxRow = 0;
  let maxCol = 0;
  for (const cell of rows) {
    map[cellKey(cell.row, cell.col)] = cell.value;
    maxRow = Math.max(maxRow, cell.row);
    maxCol = Math.max(maxCol, cell.col);
  }
  const evaluated = evaluateCells(map);

  const lines: string[] = [];
  for (let row = 0; row <= maxRow; row += 1) {
    const cells: string[] = [];
    for (let col = 0; col <= maxCol; col += 1) {
      const value = evaluated.get(cellKey(row, col));
      cells.push(csvCell(value ? formatValue(value) : ""));
    }
    lines.push(cells.join(","));
  }

  return {
    name: `${entry.name} — ${tab.name}.csv`,
    contentType: "text/csv; charset=utf-8",
    body: `\uFEFF${lines.join("\n")}\n`,
  };
}

/** Renommage de la feuille (nom du fichier Drive + titre applicatif). */
export async function renameSpreadsheet(
  actor: Actor,
  fileId: string,
  title: string,
): Promise<DriveEntry> {
  const clean = assertTitle(title);
  await requireSpreadsheet(actor, fileId);
  return driveRename(actor, fileId, clean);
}

/** Feuilles visibles (fichiers Drive liés). */
export async function listSpreadsheets(
  actor: Actor,
): Promise<{ fileId: string; title: string; updatedAt: string; canEdit: boolean }[]> {
  const rows = await db()
    .select({ fileId: spreadsheets.fileId })
    .from(spreadsheets)
    .where(eq(spreadsheets.orgId, actor.orgId))
    .limit(200);

  const visible: { fileId: string; title: string; updatedAt: string; canEdit: boolean }[] = [];
  for (const row of rows) {
    try {
      const entry = await getEntry(actor, row.fileId);
      const role = await effectiveRole(actor, row.fileId);
      visible.push({
        fileId: entry.id,
        title: entry.name,
        updatedAt: entry.updatedAt.toISOString(),
        canEdit: roleSatisfies(role, "write"),
      });
    } catch {
      // Fichier supprimé ou non visible : ignoré.
    }
  }
  return visible.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}
