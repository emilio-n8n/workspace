import { recordAudit } from "@workspace/audit";
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
import { and, asc, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { MAX_CELL_CHARS, MAX_COLS, MAX_ROWS, parseCsv } from "./csv.ts";
import {
  DIMENSION_INDEX_MAX,
  type DimensionAxis,
  type DimensionSize,
  isCustomSize,
  MAX_DIMENSION_SIZES,
  sizeKey,
  validateSize,
} from "./dimensions.ts";
import { cellKey, evaluateCells, formatValue } from "./formula.ts";
import {
  CELL_STYLE_BACKGROUNDS,
  type CellStyle,
  type SheetTabRow,
  sheetCells,
  sheetDimensions,
  sheetTabs,
  spreadsheets,
} from "./schema.ts";
import { checkStructure, type StructureKind, type StructureMode } from "./structure.ts";

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

/** Nombre maximal de cellules mises en forme par appel (v1 mono-cellule côté UI). */
import { MAX_STYLE_CELLS } from "./style-palette.ts";

export { MAX_STYLE_CELLS } from "./style-palette.ts";

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
export type CellView = { row: number; col: number; value: string; style: CellStyle | null };

export type SpreadsheetDetail = {
  fileId: string;
  title: string;
  canEdit: boolean;
  tabs: TabView[];
  cells: (CellView & { tabId: string })[];
  /** Tailles de colonnes et de lignes qui diffèrent du défaut, par onglet. */
  sizes: (DimensionSize & { tabId: string })[];
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

  await recordAudit({
    orgId: actor.orgId,
    actorUserId: actor.userId,
    action: "sheets.spreadsheet.create",
    resourceType: "spreadsheet",
    resourceId: entry.id,
    result: "success",
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
            style: sheetCells.style,
          })
          .from(sheetCells)
          .where(inArray(sheetCells.tabId, tabIds))
          .orderBy(asc(sheetCells.tabId), asc(sheetCells.row), asc(sheetCells.col))
          .limit(MAX_CELLS_PER_LOAD)
      : [];

  const sizes =
    tabIds.length > 0
      ? await db()
          .select({
            tabId: sheetDimensions.tabId,
            axis: sheetDimensions.axis,
            index: sheetDimensions.index,
            size: sheetDimensions.size,
          })
          .from(sheetDimensions)
          .where(inArray(sheetDimensions.tabId, tabIds))
          .limit(MAX_CELLS_PER_LOAD)
      : [];

  return {
    fileId: entry.id,
    title: entry.name,
    canEdit: roleSatisfies(role, "write"),
    tabs,
    cells,
    sizes,
    truncated: cells.length >= MAX_CELLS_PER_LOAD,
  };
}

// ---------------------------------------------------------------------------
// Écriture de cellules (sauvegarde et import)
// ---------------------------------------------------------------------------

type CellUpdate = { row: number; col: number; value: string };

/** Position de cellule dans les bornes de la grille. */
function assertPosition(row: number, col: number): void {
  if (
    !Number.isInteger(row) ||
    !Number.isInteger(col) ||
    row < 0 ||
    row >= MAX_ROWS ||
    col < 0 ||
    col >= MAX_COLS
  ) {
    throw new SheetsError("validation", "Cellule hors limites.");
  }
}

/** Cellule dans les bornes de la grille et sous la limite de caractères. */
function assertCell(update: CellUpdate): void {
  assertPosition(update.row, update.col);
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

/**
 * Sauvegarde par lots de cellules (mise à jour creuse, valeur vide = efface).
 * Volontairement NON journalisée dans l'audit : l'autosave produit un appel
 * par frappe (volume incompatible avec un journal d'audit lisible) ; les
 * opérations structurantes (création, onglets, import, renommage, style) le
 * sont.
 */
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

// ---------------------------------------------------------------------------
// Mise en forme des cellules (v1 : gras, italique, alignement, jetons de fond)
// ---------------------------------------------------------------------------

const STYLE_KEYS: ReadonlySet<string> = new Set(["bold", "italic", "align", "background"]);
const CELL_ALIGNS: ReadonlySet<string> = new Set(["left", "center", "right"]);

/**
 * Valide strictement un style de cellule : clés inconnues et valeurs hors du
 * jeu fixé sont refusées. `null` (ou un objet sans attribut utile) efface.
 */
export function normalizeCellStyle(style: unknown): CellStyle | null {
  if (style === null) return null;
  if (typeof style !== "object" || Array.isArray(style)) {
    throw new SheetsError("validation", "Style de cellule invalide.");
  }
  const raw = style as Record<string, unknown>;
  for (const key of Object.keys(raw)) {
    if (!STYLE_KEYS.has(key)) {
      throw new SheetsError("validation", `Clé de style inconnue : ${key}.`);
    }
  }

  const clean: CellStyle = {};
  if (raw.bold !== undefined) {
    if (raw.bold !== true) throw new SheetsError("validation", "« bold » doit valoir true.");
    clean.bold = true;
  }
  if (raw.italic !== undefined) {
    if (raw.italic !== true) throw new SheetsError("validation", "« italic » doit valoir true.");
    clean.italic = true;
  }
  if (raw.align !== undefined) {
    if (typeof raw.align !== "string" || !CELL_ALIGNS.has(raw.align)) {
      throw new SheetsError("validation", "Alignement invalide (left, center ou right).");
    }
    clean.align = raw.align as CellStyle["align"];
  }
  if (raw.background !== undefined) {
    if (
      typeof raw.background !== "string" ||
      !(CELL_STYLE_BACKGROUNDS as readonly string[]).includes(raw.background)
    ) {
      throw new SheetsError("validation", "Fond invalide (jeton de palette inconnu).");
    }
    clean.background = raw.background as CellStyle["background"];
  }
  return Object.keys(clean).length > 0 ? clean : null;
}

/**
 * Applique un style à un lot de cellules d'un onglet, ou l'efface
 * (`style: null`). Une cellule vide mise en forme crée une ligne creuse
 * (valeur "") qui porte le style ; la valeur existante n'est jamais touchée.
 */
export async function setCellStyle(
  actor: Actor,
  fileId: string,
  input: { tabId: string; cells: { row: number; col: number }[]; style: CellStyle | null },
): Promise<{ styled: number }> {
  const { spreadsheet } = await requireSpreadsheet(actor, fileId);
  await requireEditor(actor, fileId);
  const style = normalizeCellStyle(input.style);

  // Dédoublonnage par cellule : l'upsert multi-lignes refuse deux fois la
  // même cible (tab_id, row, col) dans un même lot.
  const deduped = new Map<string, { row: number; col: number }>();
  for (const cell of input.cells) {
    deduped.set(`${cell.row}:${cell.col}`, cell);
  }
  const cells = [...deduped.values()];
  if (cells.length === 0) {
    throw new SheetsError("validation", "Aucune cellule à mettre en forme.");
  }
  if (cells.length > MAX_STYLE_CELLS) {
    throw new SheetsError("validation", `Mise en forme limitée à ${MAX_STYLE_CELLS} cellules.`);
  }
  for (const cell of cells) {
    assertPosition(cell.row, cell.col);
  }

  const [tab] = await db()
    .select({ id: sheetTabs.id })
    .from(sheetTabs)
    .where(and(eq(sheetTabs.id, input.tabId), eq(sheetTabs.spreadsheetId, spreadsheet.id)))
    .limit(1);
  if (!tab) throw new SheetsError("not_found", "Onglet introuvable.");

  await withTransaction(async (tx) => {
    for (let offset = 0; offset < cells.length; offset += SAVE_CHUNK) {
      const chunk = cells.slice(offset, offset + SAVE_CHUNK);
      await tx
        .insert(sheetCells)
        .values(
          chunk.map((cell) => ({
            tabId: tab.id,
            row: cell.row,
            col: cell.col,
            value: "",
            style,
          })),
        )
        .onConflictDoUpdate({
          target: [sheetCells.tabId, sheetCells.row, sheetCells.col],
          set: { style },
        });
    }
  });

  await touchEntry(actor, fileId).catch(() => undefined);
  return { styled: cells.length };
}

// ---------------------------------------------------------------------------
// Dimensions de la grille (redimensionnement des colonnes et des lignes)
// ---------------------------------------------------------------------------

type Tx = Parameters<Parameters<typeof withTransaction>[0]>[0];

/** Vérifie et dédoublonne un lot de tailles (messages français du module). */
function assertSizes(sizes: DimensionSize[]): DimensionSize[] {
  if (sizes.length === 0) {
    throw new SheetsError("validation", "Aucune taille à enregistrer.");
  }
  if (sizes.length > MAX_DIMENSION_SIZES) {
    throw new SheetsError(
      "validation",
      `Redimensionnement limité à ${MAX_DIMENSION_SIZES} tailles.`,
    );
  }
  const deduped = new Map<string, DimensionSize>();
  for (const entry of sizes) {
    const message = validateSize(entry.axis, entry.index, entry.size);
    if (message) throw new SheetsError("validation", message);
    deduped.set(sizeKey(entry.axis, entry.index), entry);
  }
  return [...deduped.values()];
}

/**
 * Écrit des tailles par lots : une taille qui revient au défaut retire sa
 * ligne plutôt que de la stocker (la base ne garde que les écarts).
 */
async function writeDimensionSizes(tx: Tx, tabId: string, sizes: DimensionSize[]): Promise<void> {
  for (const axis of ["col", "row"] as const) {
    const upserts = sizes.filter((entry) => entry.axis === axis && isCustomSize(axis, entry.size));
    for (let offset = 0; offset < upserts.length; offset += SAVE_CHUNK) {
      const chunk = upserts.slice(offset, offset + SAVE_CHUNK);
      await tx
        .insert(sheetDimensions)
        .values(
          chunk.map((entry) => ({
            tabId,
            axis: entry.axis,
            index: entry.index,
            size: entry.size,
          })),
        )
        .onConflictDoUpdate({
          target: [sheetDimensions.tabId, sheetDimensions.axis, sheetDimensions.index],
          set: { size: sql`excluded.size` },
        });
    }
    const reset = sizes
      .filter((entry) => entry.axis === axis && !isCustomSize(axis, entry.size))
      .map((entry) => entry.index);
    for (let offset = 0; offset < reset.length; offset += SAVE_CHUNK) {
      await tx
        .delete(sheetDimensions)
        .where(
          and(
            eq(sheetDimensions.tabId, tabId),
            eq(sheetDimensions.axis, axis),
            inArray(sheetDimensions.index, reset.slice(offset, offset + SAVE_CHUNK)),
          ),
        );
    }
  }
}

/**
 * Enregistre les largeurs de colonnes et hauteurs de lignes choisies au
 * glisser (ou au clavier). Le lot est limité : l'interface envoie uniquement
 * les tailles modifiées depuis la dernière sauvegarde.
 */
export async function setDimensionSizes(
  actor: Actor,
  fileId: string,
  input: { tabId: string; sizes: DimensionSize[] },
): Promise<{ sized: number }> {
  const { spreadsheet } = await requireSpreadsheet(actor, fileId);
  await requireEditor(actor, fileId);
  const sizes = assertSizes(input.sizes);

  const [tab] = await db()
    .select({ id: sheetTabs.id })
    .from(sheetTabs)
    .where(and(eq(sheetTabs.id, input.tabId), eq(sheetTabs.spreadsheetId, spreadsheet.id)))
    .limit(1);
  if (!tab) throw new SheetsError("not_found", "Onglet introuvable.");

  await withTransaction(async (tx) => {
    await writeDimensionSizes(tx, tab.id, sizes);
  });

  await touchEntry(actor, fileId).catch(() => undefined);
  return { sized: sizes.length };
}

// ---------------------------------------------------------------------------
// Opérations structurelles (insertion / suppression de lignes et colonnes)
// ---------------------------------------------------------------------------

/**
 * Décale d'un pas les cellules et les tailles d'un onglet à partir de `start`.
 *
 * L'ordre des mises à jour est essentiel : l'index unique (onglet, axe, index)
 * refuse deux fois la même position. Une insertion traite donc les index du
 * plus grand au plus petit (la case cible est déjà libérée), une suppression
 * du plus petit au plus grand (même raison, en remontant). Les index sont
 * relevés avant la boucle : ils décrivent l'état d'origine, pas le résultat.
 */
async function shiftAxis(
  tx: Tx,
  tabId: string,
  axis: DimensionAxis,
  start: number,
  delta: number,
  order: "asc" | "desc",
): Promise<void> {
  const column = axis === "row" ? sheetCells.row : sheetCells.col;
  const ordering = order === "desc" ? desc(column) : asc(column);

  const cellIndexes = await tx
    .selectDistinct({ value: column })
    .from(sheetCells)
    .where(and(eq(sheetCells.tabId, tabId), gte(column, start)))
    .orderBy(ordering);
  for (const entry of cellIndexes) {
    const target = entry.value + delta;
    await tx
      .update(sheetCells)
      .set(axis === "row" ? { row: target } : { col: target })
      .where(and(eq(sheetCells.tabId, tabId), eq(column, entry.value)));
  }

  const sizeIndexes = await tx
    .selectDistinct({ value: sheetDimensions.index })
    .from(sheetDimensions)
    .where(
      and(
        eq(sheetDimensions.tabId, tabId),
        eq(sheetDimensions.axis, axis),
        gte(sheetDimensions.index, start),
      ),
    )
    .orderBy(order === "desc" ? desc(sheetDimensions.index) : asc(sheetDimensions.index));
  for (const entry of sizeIndexes) {
    await tx
      .update(sheetDimensions)
      .set({ index: entry.value + delta })
      .where(
        and(
          eq(sheetDimensions.tabId, tabId),
          eq(sheetDimensions.axis, axis),
          eq(sheetDimensions.index, entry.value),
        ),
      );
  }
}

/** Supprime les cellules et les tailles d'une plage d'index (bornes incluses). */
async function removeAxisRange(
  tx: Tx,
  tabId: string,
  axis: DimensionAxis,
  start: number,
  end: number,
): Promise<void> {
  const column = axis === "row" ? sheetCells.row : sheetCells.col;
  await tx
    .delete(sheetCells)
    .where(and(eq(sheetCells.tabId, tabId), gte(column, start), lte(column, end)));
  await tx
    .delete(sheetDimensions)
    .where(
      and(
        eq(sheetDimensions.tabId, tabId),
        eq(sheetDimensions.axis, axis),
        gte(sheetDimensions.index, start),
        lte(sheetDimensions.index, end),
      ),
    );
}

/** Plus grand index occupé sur un axe (0 si l'onglet est vide). */
async function maxAxisIndex(tx: Tx, tabId: string, axis: DimensionAxis): Promise<number> {
  const column = axis === "row" ? sheetCells.row : sheetCells.col;
  const [row] = await tx
    .select({ value: sql<number>`max(${column})`.mapWith(Number) })
    .from(sheetCells)
    .where(eq(sheetCells.tabId, tabId));
  const value = row?.value;
  return typeof value === "number" ? value : 0;
}

async function requireTabForStructure(
  actor: Actor,
  fileId: string,
  tabId: string,
): Promise<{ id: string }> {
  const { spreadsheet } = await requireSpreadsheet(actor, fileId);
  await requireEditor(actor, fileId);
  const [tab] = await db()
    .select({ id: sheetTabs.id })
    .from(sheetTabs)
    .where(and(eq(sheetTabs.id, tabId), eq(sheetTabs.spreadsheetId, spreadsheet.id)))
    .limit(1);
  if (!tab) throw new SheetsError("not_found", "Onglet introuvable.");
  return tab;
}

/**
 * Insère ou supprime des lignes ou des colonnes dans un onglet : les cellules
 * existantes (valeurs et styles) suivent le décalage, ainsi que les tailles
 * de la grille. Une insertion qui pousserait des cellules hors des limites de
 * la feuille est refusée — jamais de perte silencieuse.
 */
async function mutateStructure(
  actor: Actor,
  fileId: string,
  input: { tabId: string; kind: StructureKind; mode: StructureMode; index: number; count: number },
): Promise<void> {
  const { kind, mode, index, count } = input;
  const axis: DimensionAxis = kind;
  const message = checkStructure(kind, mode, index, count);
  if (message) throw new SheetsError("validation", message);

  const tab = await requireTabForStructure(actor, fileId, input.tabId);

  await withTransaction(async (tx) => {
    if (mode === "insert") {
      const highest = await maxAxisIndex(tx, tab.id, axis);
      if (highest + count >= DIMENSION_INDEX_MAX[axis]) {
        throw new SheetsError(
          "validation",
          `Insertion impossible : elle dépasserait les ${DIMENSION_INDEX_MAX[axis]} ${kind === "row" ? "lignes" : "colonnes"} de la feuille.`,
        );
      }
      if (index < DIMENSION_INDEX_MAX[axis]) {
        await shiftAxis(tx, tab.id, axis, index, count, "desc");
      }
    } else {
      const end = index + count - 1;
      await removeAxisRange(tx, tab.id, axis, index, end);
      if (end + 1 < DIMENSION_INDEX_MAX[axis]) {
        await shiftAxis(tx, tab.id, axis, end + 1, -count, "asc");
      }
    }
  });

  await touchEntry(actor, fileId).catch(() => undefined);

  await recordAudit({
    orgId: actor.orgId,
    actorUserId: actor.userId,
    action: `sheets.${kind === "row" ? "rows" : "cols"}.${mode}`,
    resourceType: "tab",
    resourceId: tab.id,
    result: "success",
    metadata: { fileId, index, count },
  });
}

export function insertRows(
  actor: Actor,
  fileId: string,
  input: { tabId: string; index: number; count?: number },
): Promise<void> {
  return mutateStructure(actor, fileId, {
    ...input,
    kind: "row",
    mode: "insert",
    count: input.count ?? 1,
  });
}

export function insertColumns(
  actor: Actor,
  fileId: string,
  input: { tabId: string; index: number; count?: number },
): Promise<void> {
  return mutateStructure(actor, fileId, {
    ...input,
    kind: "col",
    mode: "insert",
    count: input.count ?? 1,
  });
}

export function deleteRows(
  actor: Actor,
  fileId: string,
  input: { tabId: string; index: number; count?: number },
): Promise<void> {
  return mutateStructure(actor, fileId, {
    ...input,
    kind: "row",
    mode: "delete",
    count: input.count ?? 1,
  });
}

export function deleteColumns(
  actor: Actor,
  fileId: string,
  input: { tabId: string; index: number; count?: number },
): Promise<void> {
  return mutateStructure(actor, fileId, {
    ...input,
    kind: "col",
    mode: "delete",
    count: input.count ?? 1,
  });
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

  await recordAudit({
    orgId: actor.orgId,
    actorUserId: actor.userId,
    action: "sheets.csv.import",
    resourceType: "spreadsheet",
    resourceId: fileId,
    result: "success",
    metadata: { imported: updates.length },
  });

  return { imported: updates.length };
}

export async function addTab(actor: Actor, fileId: string, name: string): Promise<TabView[]> {
  const { spreadsheet } = await requireSpreadsheet(actor, fileId);
  await requireEditor(actor, fileId);
  const clean = assertTabName(name);

  // Verrouillage de la feuille (SELECT … FOR UPDATE) : le décompte et
  // l'insertion sont ainsi sérialisés face aux ajouts concurrents.
  const { tabs, tabId } = await withTransaction(async (tx) => {
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

    const [created] = await tx
      .insert(sheetTabs)
      .values({ spreadsheetId: spreadsheet.id, name: clean, position: count })
      .returning({ id: sheetTabs.id });

    const rows = await tx
      .select({ id: sheetTabs.id, name: sheetTabs.name, position: sheetTabs.position })
      .from(sheetTabs)
      .where(eq(sheetTabs.spreadsheetId, spreadsheet.id))
      .orderBy(asc(sheetTabs.position));
    return { tabs: rows, tabId: created?.id ?? null };
  });

  await recordAudit({
    orgId: actor.orgId,
    actorUserId: actor.userId,
    action: "sheets.tab.add",
    resourceType: "tab",
    resourceId: tabId,
    result: "success",
    metadata: { fileId, name: clean },
  });

  return tabs;
}

export async function renameTab(actor: Actor, tabId: string, name: string): Promise<void> {
  const { tab, fileId } = await requireTab(actor, tabId);
  const clean = assertTabName(name);
  await db().update(sheetTabs).set({ name: clean }).where(eq(sheetTabs.id, tab.id));

  await recordAudit({
    orgId: actor.orgId,
    actorUserId: actor.userId,
    action: "sheets.tab.rename",
    resourceType: "tab",
    resourceId: tab.id,
    result: "success",
    metadata: { fileId, name: clean },
  });
}

export async function deleteTab(actor: Actor, tabId: string): Promise<void> {
  const { tab, fileId } = await requireTab(actor, tabId);

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

  await recordAudit({
    orgId: actor.orgId,
    actorUserId: actor.userId,
    action: "sheets.tab.delete",
    resourceType: "tab",
    resourceId: tab.id,
    result: "success",
    metadata: { fileId, name: tab.name },
  });
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
  const entry = await driveRename(actor, fileId, clean);

  await recordAudit({
    orgId: actor.orgId,
    actorUserId: actor.userId,
    action: "sheets.spreadsheet.rename",
    resourceType: "spreadsheet",
    resourceId: fileId,
    result: "success",
    metadata: { title: clean },
  });

  return entry;
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
