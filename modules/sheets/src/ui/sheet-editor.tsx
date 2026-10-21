import {
  Button,
  cn,
  Dialog,
  IconChevronDown,
  IconMore,
  IconPlus,
  IconRedo,
  IconUndo,
  Input,
  Label,
  LoadingState,
  Menu,
} from "@workspace/ui";
import {
  type ChangeEvent,
  type CSSProperties,
  type FormEvent,
  memo,
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { extractChartData } from "../chart.ts";
import { MAX_CELL_CHARS, MAX_ROWS } from "../csv.ts";
import { formatCustom } from "../custom-format.ts";
import {
  applyResize,
  clampSize,
  DIMENSION_LIMITS,
  type DimensionAxis,
  type DimensionSize,
  parseSizes,
  sizeKey,
  sizeOf,
} from "../dimensions.ts";
import { fillRange, fillTarget, shiftPasted } from "../fill.ts";
import {
  detectFilterRange,
  distinctValues,
  filterSummary,
  hiddenRows,
  isColumnFiltered,
  withColumnFilter,
} from "../filter.ts";
import { type CellMap, cellKey, evaluateCells, formatValue, parseKey } from "../formula.ts";
import {
  DEFAULT_FREEZE,
  type FreezeState,
  freezeAnnouncement,
  freezeButtonLabel,
  freezeClasses,
  freezeHint,
  toggleFreeze,
} from "../freeze.ts";
import { CELL_FORMATS, type CellFormatId, formatCellDisplay } from "../number-format.ts";
import {
  type CellAddress,
  type CellRange,
  clipboardError,
  copySummary,
  inRange,
  isSingleCell,
  jumpTarget,
  parseTsv,
  pasteSummary,
  pasteTargets,
  rangeFrom,
  rangeLabel,
  selectionStats,
  serializeTsv,
} from "../range.ts";
import type { CellStyle, CellStyleAlign } from "../schema.ts";
import {
  addTabFn,
  deleteColumnsFn,
  deleteRowsFn,
  deleteTabFn,
  getSpreadsheetFn,
  importCsvFn,
  insertColumnsFn,
  insertRowsFn,
  renameSpreadsheetFn,
  renameTabFn,
  type SpreadsheetDetail,
  saveCellsFn,
  setCellStyleFn,
  setDimensionSizesFn,
  setTabSettingsFn,
} from "../server.ts";
import { type SortDirection, sortRange, sortSummary } from "../sort.ts";
import {
  type StructureKind,
  type StructureMode,
  selectionAfter,
  structureMessage,
} from "../structure.ts";
import {
  CELL_STYLE_BACKGROUNDS,
  CELL_TEXT_COLORS,
  type CellStyleBackground,
  type CellTextColor,
  MAX_STYLE_CELLS,
} from "../style-palette.ts";
import type { ChartType, ColumnFilter, SheetChart, TabSettings } from "../tab-settings.ts";
import { type CellTone, toneOf } from "./cell-tone.ts";
import { CustomFormatDialog } from "./custom-format-dialog.tsx";
import { FilterPopover } from "./filter-popover.tsx";
import { useFormulaAssist } from "./formula-assist.tsx";
import { FormulaBar } from "./formula-bar.tsx";
import { ResizeHandle } from "./resize-handle.tsx";
import { ChartFrame } from "./sheet-chart.tsx";
import { SheetContextMenu, type SheetMenuItem } from "./sheet-context-menu.tsx";

/** Colonnes affichées (A à Z) et lignes (celles acceptées par le service). */
const COLS = 26;
const ROWS = MAX_ROWS;
/** Hauteur par défaut d'une ligne : celle du redimensionnement. */
const ROW_HEIGHT = DIMENSION_LIMITS.row.fallback;
/** Lignes rendues au-delà de la fenêtre visible (défilement fluide). */
const OVERSCAN_ROWS = 12;
/** Au-delà, une mise en forme ne vise que les cellules utilisées de la plage. */
const STYLE_RANGE_LIMIT = 2_000;
const COL_LETTERS = Array.from({ length: COLS }, (_, index) =>
  cellKey(0, index).replace(/\d+$/, ""),
);
/** Clés stables des lignes (évite l'index de tableau comme clé React). */
const ROW_KEYS = Array.from({ length: ROWS }, (_, index) => `ligne-${index + 1}`);
const SAVE_DEBOUNCE_MS = 700;
const SAVE_RETRY_MS = 3_000;
/** Les tailles de grille sont enregistrées sans attendre (glisser ponctuel). */
const SIZE_SAVE_DEBOUNCE_MS = 400;
/** Fenêtre de fusion des gestes répétés (frappe, collage, tri) dans l'historique. */
const COALESCE_MS = 600;
/** Profondeur maximale de la pile d'annulation. */
const HISTORY_LIMIT = 50;
/** Plafond d'écritures par appel (contrat de `saveCellsFn`). */
const SAVE_CELLS_CHUNK = 2_000;

/** Classes Tailwind statiques des fonds de cellule (jetons de palette → teinte). */
const STYLE_BACKGROUND_CLASSES: Record<CellStyleBackground, string> = {
  accent: "bg-accent",
  attention: "bg-attention/30",
  danger: "bg-destructive/10",
  muted: "bg-muted",
};
/** Pastilles de la barre de mise en forme (teinte pleine du jeton). */
const STYLE_SWATCH_CLASSES: Record<CellStyleBackground, string> = {
  accent: "bg-accent",
  attention: "bg-attention",
  danger: "bg-destructive",
  muted: "bg-muted",
};
const STYLE_SWATCH_LABELS: Record<CellStyleBackground, string> = {
  accent: "Accent",
  attention: "Attention",
  danger: "Danger",
  muted: "Neutre",
};

/** Classes de couleur de TEXTE par jeton (le défaut est une absence de clé). */
const STYLE_TEXT_CLASSES: Record<CellTextColor, string> = {
  accent: "text-primary",
  attention: "text-attention",
  danger: "text-destructive",
  muted: "text-muted-foreground",
};
/** Pastilles de couleur de texte (teinte pleine du jeton). */
const STYLE_TEXT_SWATCH_CLASSES: Record<CellTextColor, string> = {
  accent: "bg-primary",
  attention: "bg-attention",
  danger: "bg-destructive",
  muted: "bg-muted-foreground",
};
const STYLE_TEXT_LABELS: Record<CellTextColor, string> = {
  accent: "Accent",
  attention: "Attention",
  danger: "Rouge",
  muted: "Gris",
};

type SaveStatus = "idle" | "saving" | "saved" | "error";
type MoveDirection = "down" | "up" | "right" | "left" | "none";

/** Cible du menu contextuel : une cellule, une colonne ou une ligne. */
type ContextTarget =
  | { kind: "cell"; row: number; col: number }
  | { kind: "row"; index: number }
  | { kind: "col"; index: number };

/** Tailles de grille d'un onglet, par axe de redimensionnement. */
type SheetSizes = {
  col: Map<number, number>;
  row: Map<number, number>;
};

/** Retire un attribut d'un style ; `null` si le style devient vide. */
function withoutKey(
  style: CellStyle,
  key: "align" | "background" | "color" | "format" | "numberFormat",
): CellStyle | null {
  const next = { ...style };
  delete next[key];
  return Object.keys(next).length > 0 ? next : null;
}

/** Instantané de l'historique : contenu et mise en forme, onglet par onglet. */
type EditorSnapshot = {
  cells: Map<string, Map<string, string>>;
  styles: Map<string, Map<string, CellStyle>>;
};

/** Écriture groupée de styles : un onglet, une valeur cible, ses cellules. */
type StyleWriteGroup = { tabId: string; style: CellStyle | null; cells: CellAddress[] };

/** Vrai quand l'évènement vient d'un champ de saisie (raccourcis natifs). */
function isTypingTarget(target: EventTarget | null): boolean {
  const element = target instanceof HTMLElement ? target : null;
  if (!element) return false;
  return (
    element.tagName === "INPUT" ||
    element.tagName === "TEXTAREA" ||
    element.tagName === "SELECT" ||
    element.isContentEditable
  );
}

/** Vrai quand l'évènement vient d'une fenêtre modale (elle garde son clavier). */
function isInsideDialog(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest("dialog") !== null;
}

/** Découpe une clé locale « ligne:colonne » en coordonnées de cellule. */
function cellOfKey(key: string): CellAddress {
  const [row, col] = key.split(":").map(Number);
  return { row: row ?? 0, col: col ?? 0 };
}

/** Index de la ligne qui contient le décalage vertical `y` (recherche dichotomique). */
function rowIndexAt(offsets: readonly number[], y: number): number {
  let low = 0;
  let high = offsets.length - 2;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if ((offsets[middle] ?? 0) <= y) low = middle;
    else high = middle - 1;
  }
  return Math.max(0, low);
}

/** Jeu de cartes vide, partagé tant qu'aucune taille n'est choisie. */
const EMPTY_SIZES: SheetSizes = { col: new Map(), row: new Map() };
const EMPTY_SETTINGS: TabSettings = {};

type GridCellProps = {
  row: number;
  col: number;
  raw: string;
  display: string;
  tone: CellTone;
  cellStyle: CellStyle | null;
  selected: boolean;
  /** Cellule comprise dans la plage de sélection étendue (TASK-004/006). */
  inRange: boolean;
  canEdit: boolean;
  editing: boolean;
  /**
   * Brouillon initial de l'édition : la touche tapée sur une cellule
   * sélectionnée remplace son contenu (mode « saisie » d'Excel), `null` ouvre
   * l'édition sur la valeur existante (F2, double-clic, Entrée).
   */
  initialDraft: string | null;
  /** Appui du pointeur : sélection (Maj = étendre) et début du glisser. */
  onPointerSelect: (row: number, col: number, extend: boolean) => void;
  /** Survol pendant un glisser de sélection. */
  onPointerExtend: (row: number, col: number) => void;
  /** Clic sur la cellule déjà active, double-clic : ouvre l'édition. */
  onEditRequest: (row: number, col: number) => void;
  onCommit: (row: number, col: number, value: string, move: MoveDirection) => void;
  onCancel: () => void;
  /** Clic droit ou touche Menu : ouvre le menu contextuel de la cellule. */
  onRequestMenu: (
    row: number,
    col: number,
    anchor: DOMRect,
    pointer?: { x: number; y: number },
  ) => void;
};

/** Champ d'édition d'une cellule, avec l'aide à la saisie des formules. */
function CellInput({
  row,
  col,
  raw,
  initialDraft,
  onCommit,
  onCancel,
}: Pick<GridCellProps, "row" | "col" | "raw" | "initialDraft" | "onCommit" | "onCancel">) {
  const [draft, setDraft] = useState(initialDraft ?? raw);
  const skipBlurRef = useRef(false);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  // Mode « saisie » (frappe directe) : les flèches valident et déplacent,
  // comme dans Excel. Mode « édition » (F2) : elles déplacent le curseur.
  const enterMode = initialDraft !== null;
  const assist = useFormulaAssist(draft, setDraft);

  // Démontage sans validation explicite (défilement, changement d'onglet) :
  // la saisie n'est jamais perdue. Les valeurs vivent dans une référence pour
  // que l'effet ne s'exécute qu'au démontage.
  // Le démontage est confirmé après une micro-tâche : en mode strict, React
  // démonte puis remonte aussitôt l'effet, ce qui validait la première frappe
  // (« 1 » au lieu de « 10 ») et fermait le champ.
  const latestRef = useRef({ row, col, raw, onCommit });
  latestRef.current = { row, col, raw, onCommit };
  const mountedRef = useRef(false);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      queueMicrotask(() => {
        if (mountedRef.current || skipBlurRef.current) return;
        const latest = latestRef.current;
        if (draftRef.current !== latest.raw) {
          latest.onCommit(latest.row, latest.col, draftRef.current, "none");
        }
      });
    };
  }, []);

  function commit(move: MoveDirection) {
    skipBlurRef.current = true;
    onCommit(row, col, draft, move);
  }

  return (
    <div className="relative h-full">
      <input
        // biome-ignore lint/a11y/noAutofocus: édition de cellule demandée explicitement
        autoFocus
        aria-label={`Cellule ${cellKey(row, col)}`}
        aria-autocomplete="list"
        value={draft}
        spellCheck={false}
        onChange={(event) => setDraft(event.target.value)}
        onFocus={(event) => {
          // Saisie directe : le curseur après le caractère tapé.
          const length = event.currentTarget.value.length;
          event.currentTarget.setSelectionRange(length, length);
        }}
        onBlur={() => {
          if (skipBlurRef.current) return;
          skipBlurRef.current = true;
          onCommit(row, col, draft, "none");
        }}
        onKeyDown={(event) => {
          if (assist.onKeyDown(event)) return;
          if (event.key === "Enter") {
            event.preventDefault();
            commit(event.shiftKey ? "up" : "down");
          } else if (event.key === "Tab") {
            event.preventDefault();
            commit(event.shiftKey ? "left" : "right");
          } else if (event.key === "Escape") {
            event.preventDefault();
            skipBlurRef.current = true;
            onCancel();
          } else if (enterMode && !draft.startsWith("=")) {
            const moves: Record<string, MoveDirection> = {
              ArrowDown: "down",
              ArrowUp: "up",
              ArrowLeft: "left",
              ArrowRight: "right",
            };
            const move = moves[event.key];
            if (move) {
              event.preventDefault();
              commit(move);
            }
          }
        }}
        className="block h-full w-full bg-background px-2 text-sm outline-2 outline-primary"
      />
      {assist.popup}
    </div>
  );
}

/**
 * Cellule mémoïsée : le brouillon d'édition reste local, donc la frappe ne
 * re-rend que cette cellule. Modèle Excel : un clic sélectionne, un second
 * clic (ou un double-clic, F2, Entrée) édite, la frappe remplace ; la
 * validation se fait au blur, à Entrée (descente), Tab (droite), Échap annule.
 */
const GridCell = memo(function GridCell({
  row,
  col,
  raw,
  display,
  tone,
  cellStyle,
  selected,
  inRange,
  canEdit,
  editing,
  initialDraft,
  onPointerSelect,
  onPointerExtend,
  onEditRequest,
  onCommit,
  onCancel,
  onRequestMenu,
}: GridCellProps) {
  // Vrai quand l'appui a eu lieu sur la cellule déjà active : le clic qui suit
  // ouvre l'édition (et le premier clic ne fait que sélectionner).
  const wasActiveRef = useRef(false);

  if (editing) {
    return (
      <CellInput
        row={row}
        col={col}
        raw={raw}
        initialDraft={initialDraft}
        onCommit={onCommit}
        onCancel={onCancel}
      />
    );
  }

  return (
    <button
      type="button"
      aria-label={`Cellule ${cellKey(row, col)}`}
      // La cellule active est signalée sans dépendre d'un rôle ARIA de grille.
      aria-current={selected ? "true" : undefined}
      data-cell-row={row}
      data-cell-col={col}
      tabIndex={selected ? 0 : -1}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        wasActiveRef.current = selected && !inRange && !event.shiftKey;
        onPointerSelect(row, col, event.shiftKey);
      }}
      onPointerEnter={(event) => {
        if (event.buttons === 1) onPointerExtend(row, col);
      }}
      onClick={(event) => {
        // Clic clavier (Entrée/Espace sur le bouton) : detail = 0 → édition.
        if (event.detail === 0 || wasActiveRef.current) {
          wasActiveRef.current = false;
          if (canEdit) onEditRequest(row, col);
        }
      }}
      onDoubleClick={() => {
        if (canEdit) onEditRequest(row, col);
      }}
      onContextMenu={(event) => {
        // Le menu contextuel est le seul propriétaire du clic droit : on ouvre
        // à la position du pointeur plutôt que d'afficher le menu natif.
        event.preventDefault();
        onRequestMenu(row, col, event.currentTarget.getBoundingClientRect(), {
          x: event.clientX,
          y: event.clientY,
        });
      }}
      onKeyDown={(event) => {
        // Équivalent clavier du clic droit : touche Menu ou Maj+F10.
        if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
          event.preventDefault();
          onRequestMenu(row, col, event.currentTarget.getBoundingClientRect());
        }
      }}
      title={raw || undefined}
      style={{
        fontWeight: cellStyle?.bold ? 700 : undefined,
        fontStyle: cellStyle?.italic ? "italic" : undefined,
        textDecoration:
          [cellStyle?.underline ? "underline" : null, cellStyle?.strike ? "line-through" : null]
            .filter((value): value is string => value !== null)
            .join(" ") || undefined,
        textAlign: cellStyle?.align,
      }}
      className={cn(
        "block h-full w-full select-none truncate px-2 text-sm leading-[23px] outline-none",
        tone === "number"
          ? "text-right tabular-nums"
          : tone === "boolean"
            ? "text-center"
            : "text-left",
        cellStyle?.background ? STYLE_BACKGROUND_CLASSES[cellStyle.background] : undefined,
        cellStyle?.color ? STYLE_TEXT_CLASSES[cellStyle.color] : undefined,
        inRange && !selected && "bg-primary/10",
        selected && "relative z-[1] shadow-[inset_0_0_0_2px_var(--primary)]",
        canEdit ? "cursor-cell" : "cursor-default",
        tone === "error" && "text-destructive",
      )}
    >
      {display}
    </button>
  );
});

/**
 * Éditeur de feuille : grille creuse qui remplit le viewport (elle seule
 * défile), formules calculées à l'affichage (SUM/AVG/MIN/MAX/COUNT), autosave
 * par lots, historique annuler/rétablir, barre d'outils unique et onglets.
 */
export function SheetEditor({ fileId }: { fileId: string }) {
  const [detail, setDetail] = useState<SpreadsheetDetail | null>(null);
  const [title, setTitle] = useState("");
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [cellsByTab, setCellsByTab] = useState<Map<string, Map<string, string>>>(new Map());
  const [editing, setEditing] = useState<{
    row: number;
    col: number;
    /** Brouillon initial (frappe directe) ; `null` = valeur existante. */
    draft: string | null;
  } | null>(null);
  const [selected, setSelected] = useState<{ row: number; col: number } | null>(null);
  // Coin opposé de la plage (la cellule active reste fixe, comme dans Excel) :
  // nul pour une cellule seule, rempli par Maj + clic, Maj + flèche, glisser
  // ou clic sur un en-tête (TASK-004/006).
  const [rangeAnchor, setRangeAnchor] = useState<CellAddress | null>(null);
  const rangeAnchorRef = useRef<CellAddress | null>(null);
  /** Zone de défilement de la grille et fenêtre visible (virtualisation des lignes). */
  const scrollRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ top: 0, height: 800 });
  /** Décalage vertical cumulé de chaque ligne (ROWS + 1 entrées). */
  const rowOffsetsRef = useRef<number[]>(
    Array.from({ length: ROWS + 1 }, (_, index) => index * ROW_HEIGHT),
  );
  /** Glisser de sélection en cours (bouton gauche maintenu). */
  const draggingRef = useRef(false);
  /** Aperçu de la poignée de recopie pendant le glisser. */
  const [fillPreview, setFillPreview] = useState<CellRange | null>(null);
  /** Presse-papiers interne : permet de décaler les formules collées. */
  const clipboardRef = useRef<{ text: string; origin: CellAddress; cut: CellRange | null } | null>(
    null,
  );
  // Repères figés au défilement (TASK-005) : session en cours, défaut figé.
  const [freeze, setFreeze] = useState<FreezeState>(DEFAULT_FREEZE);
  const [stylesByTab, setStylesByTab] = useState<Map<string, Map<string, CellStyle>>>(new Map());
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [styleBusy, setStyleBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tabDialog, setTabDialog] = useState<"add" | "rename" | null>(null);
  const [tabName, setTabName] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [importBusy, setImportBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const pendingRef = useRef(new Map<string, { row: number; col: number; value: string }>());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeTabIdRef = useRef<string | null>(null);
  const canEditRef = useRef(false);
  // Dernière cellule active, lue par les rappels stables d'étirement de plage.
  const selectedRef = useRef<CellAddress | null>(null);
  const flushRef = useRef<(tabId: string | null) => Promise<void>>(async () => undefined);
  // Tailles de colonnes et de lignes, par onglet ; le glisser n'écrit qu'à la fin.
  const [sizesByTab, setSizesByTab] = useState<Map<string, SheetSizes>>(new Map());
  const [preview, setPreview] = useState<{
    axis: DimensionAxis;
    index: number;
    size: number;
  } | null>(null);
  const pendingSizesRef = useRef(new Map<string, DimensionSize>());
  const sizeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sizeFlushRef = useRef<(tabId: string | null) => Promise<void>>(async () => undefined);
  // Aperçu pendant le glisser : une seule image d'animation par mouvement.
  const previewFrameRef = useRef<number | null>(null);
  const previewValueRef = useRef<{ axis: DimensionAxis; index: number; size: number } | null>(null);
  // Menu contextuel (position d'écran et cible).
  const [menu, setMenu] = useState<{ x: number; y: number; target: ContextTarget } | null>(null);
  // Brouillon de la barre de formule, rattaché à sa cellule : un brouillon
  // d'une autre cellule est ignoré, donc la saisie ne fuit jamais d'une
  // cellule à la suivante.
  const [barDraft, setBarDraft] = useState<{ key: string; value: string } | null>(null);
  const [announcement, setAnnouncement] = useState("");
  // Filtre automatique : panneau ouvert sur une colonne (position d'écran).
  const [filterMenu, setFilterMenu] = useState<{ col: number; left: number; top: number } | null>(
    null,
  );
  const [formatDialogOpen, setFormatDialogOpen] = useState(false);
  const toggleFilterRef = useRef<() => void>(() => undefined);
  // Hauteur mesurée de la ligne des lettres et position des colonnes figées.
  const headerCellRef = useRef<HTMLTableCellElement>(null);
  const [headerHeight, setHeaderHeight] = useState(25);
  const [frozenLefts, setFrozenLefts] = useState<number[]>([]);
  const [structureBusy, setStructureBusy] = useState(false);
  // Historique annuler/rétablir : instantanés empilés et bornés ; les gestes
  // répétés (frappe, collage, tri) fusionnent dans la même entrée.
  const pastRef = useRef<EditorSnapshot[]>([]);
  const futureRef = useRef<EditorSnapshot[]>([]);
  const lastPushRef = useRef<{ kind: string; at: number } | null>(null);
  const [historyVersion, setHistoryVersion] = useState(0);
  // Vues de référence du contenu et des styles, lues par les rappels stables.
  const cellsRef = useRef(cellsByTab);
  const detailRef = useRef<SpreadsheetDetail | null>(null);
  const stylesRef = useRef(stylesByTab);

  // Valeurs dérivées du chargement : déclarées avant les rappels qui s'en
  // servent, pour qu'aucune action ne lise une valeur encore indéfinie.
  const activeTab = detail?.tabs.find((tab) => tab.id === activeTabId) ?? null;
  const canEdit = detail?.canEdit ?? false;
  const selectedKey = selected ? `${selected.row}:${selected.col}` : null;
  // Plage sélectionnée : une cellule seule tant que l'ancre est nulle.
  const selectionRange = useMemo<CellRange | null>(
    () => (rangeAnchor && selected ? rangeFrom(rangeAnchor, selected) : null),
    [rangeAnchor, selected],
  );
  const statusLabel =
    status === "saving"
      ? "Enregistrement…"
      : status === "saved"
        ? "Enregistré"
        : status === "error"
          ? "Erreur de sauvegarde"
          : "";

  useEffect(() => {
    activeTabIdRef.current = activeTabId;
  }, [activeTabId]);

  useEffect(() => {
    canEditRef.current = detail?.canEdit ?? false;
    detailRef.current = detail;
  }, [detail]);

  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);

  useEffect(() => {
    rangeAnchorRef.current = rangeAnchor;
  }, [rangeAnchor]);

  useEffect(() => {
    cellsRef.current = cellsByTab;
  }, [cellsByTab]);

  useEffect(() => {
    stylesRef.current = stylesByTab;
  }, [stylesByTab]);

  const load = useCallback(async () => {
    try {
      const data = await getSpreadsheetFn({ data: { fileId } });
      const byTab = new Map<string, Map<string, string>>();
      const styles = new Map<string, Map<string, CellStyle>>();
      for (const cell of data.cells) {
        const map = byTab.get(cell.tabId) ?? new Map<string, string>();
        map.set(`${cell.row}:${cell.col}`, cell.value);
        byTab.set(cell.tabId, map);
        if (cell.style) {
          const styleMap = styles.get(cell.tabId) ?? new Map<string, CellStyle>();
          styleMap.set(`${cell.row}:${cell.col}`, cell.style);
          styles.set(cell.tabId, styleMap);
        }
      }
      for (const tab of data.tabs) {
        if (!byTab.has(tab.id)) byTab.set(tab.id, new Map());
        if (!styles.has(tab.id)) styles.set(tab.id, new Map());
      }
      setDetail(data);
      setTitle(data.title);
      setCellsByTab(byTab);
      setStylesByTab(styles);
      setSizesByTab(parseSizes(data.sizes));
      // Un rechargement (opération structurelle, import) invalide l'historique :
      // les instantanés pointeraient sur des cellules décalées.
      pastRef.current = [];
      futureRef.current = [];
      lastPushRef.current = null;
      setHistoryVersion((version) => version + 1);
      setActiveTabId((current) =>
        current && data.tabs.some((tab) => tab.id === current)
          ? current
          : (data.tabs[0]?.id ?? null),
      );
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Chargement impossible.");
    }
  }, [fileId]);

  useEffect(() => {
    void load();
  }, [load]);

  // -------------------------------------------------------------------------
  // Historique annuler / rétablir (Ctrl+Z, Ctrl+Maj+Z, Ctrl+Y)
  // -------------------------------------------------------------------------

  /** Instantané de l'état courant (références partagées : copies immuables). */
  const captureSnapshot = useCallback(
    (): EditorSnapshot => ({ cells: cellsRef.current, styles: stylesRef.current }),
    [],
  );

  /** Empile l'état courant avant une action ; les gestes répétés fusionnent. */
  const pushHistory = useCallback(
    (kind: string) => {
      const now = Date.now();
      const last = lastPushRef.current;
      if (last && last.kind === kind && now - last.at < COALESCE_MS) {
        last.at = now;
        return;
      }
      pastRef.current = [...pastRef.current, captureSnapshot()].slice(-HISTORY_LIMIT);
      futureRef.current = [];
      lastPushRef.current = { kind, at: now };
      setHistoryVersion((version) => version + 1);
    },
    [captureSnapshot],
  );

  /**
   * Rejoue sur le serveur le différentiel entre deux instantanés : les cellules
   * effacées partent en chaîne vide (suppression côté service), les styles
   * changés sont regroupés par onglet et par valeur cible.
   */
  const persistSnapshotDiff = useCallback(
    async (before: EditorSnapshot, after: EditorSnapshot) => {
      setStatus("saving");
      try {
        const tabIds = new Set([...before.cells.keys(), ...after.cells.keys()]);
        for (const tabId of tabIds) {
          const previous = before.cells.get(tabId) ?? new Map<string, string>();
          const next = after.cells.get(tabId) ?? new Map<string, string>();
          const updates: { row: number; col: number; value: string }[] = [];
          for (const [key, value] of next) {
            if (previous.get(key) === value) continue;
            updates.push({ ...cellOfKey(key), value });
          }
          for (const key of previous.keys()) {
            if (!next.has(key)) updates.push({ ...cellOfKey(key), value: "" });
          }
          for (let offset = 0; offset < updates.length; offset += SAVE_CELLS_CHUNK) {
            await saveCellsFn({
              data: {
                fileId,
                tabId,
                updates: updates.slice(offset, offset + SAVE_CELLS_CHUNK),
              },
            });
          }
        }
        // Styles : une écriture par onglet et par style cible.
        const groups = new Map<string, StyleWriteGroup>();
        const styleTabIds = new Set([...before.styles.keys(), ...after.styles.keys()]);
        for (const tabId of styleTabIds) {
          const previous = before.styles.get(tabId) ?? new Map<string, CellStyle>();
          const next = after.styles.get(tabId) ?? new Map<string, CellStyle>();
          const changed: { key: string; style: CellStyle | null }[] = [];
          for (const [key, style] of next) {
            if (JSON.stringify(previous.get(key) ?? null) === JSON.stringify(style)) continue;
            changed.push({ key, style });
          }
          for (const key of previous.keys()) {
            if (!next.has(key)) changed.push({ key, style: null });
          }
          for (const entry of changed) {
            const groupKey = `${tabId}|${JSON.stringify(entry.style)}`;
            const group: StyleWriteGroup = groups.get(groupKey) ?? {
              tabId,
              style: entry.style,
              cells: [],
            };
            group.cells.push(cellOfKey(entry.key));
            groups.set(groupKey, group);
          }
        }
        for (const group of groups.values()) {
          for (let offset = 0; offset < group.cells.length; offset += MAX_STYLE_CELLS) {
            await setCellStyleFn({
              data: {
                fileId,
                tabId: group.tabId,
                cells: group.cells.slice(offset, offset + MAX_STYLE_CELLS),
                style: group.style,
              },
            });
          }
        }
        setStatus("saved");
        setError(null);
      } catch (caught) {
        setStatus("error");
        setError(caught instanceof Error ? caught.message : "Restauration impossible.");
      }
    },
    [fileId],
  );

  /** Remet un instantané en place et rejoue son différentiel sur le serveur. */
  const restoreSnapshot = useCallback(
    (snapshot: EditorSnapshot) => {
      const before = captureSnapshot();
      cellsRef.current = snapshot.cells;
      stylesRef.current = snapshot.styles;
      setCellsByTab(snapshot.cells);
      setStylesByTab(snapshot.styles);
      setEditing(null);
      setBarDraft(null);
      setMenu(null);
      // Les écritures en attente rejoueraient la valeur annulée : le
      // différentiel restauré les remplace.
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      pendingRef.current = new Map();
      void persistSnapshotDiff(before, snapshot);
    },
    [captureSnapshot, persistSnapshotDiff],
  );

  const doUndo = useCallback(() => {
    const previous = pastRef.current[pastRef.current.length - 1];
    if (!previous) return;
    pastRef.current = pastRef.current.slice(0, -1);
    futureRef.current = [captureSnapshot(), ...futureRef.current].slice(0, HISTORY_LIMIT);
    restoreSnapshot(previous);
    setHistoryVersion((version) => version + 1);
    setAnnouncement("Modification annulée.");
  }, [captureSnapshot, restoreSnapshot]);

  const doRedo = useCallback(() => {
    const [next, ...rest] = futureRef.current;
    if (!next) return;
    futureRef.current = rest;
    pastRef.current = [...pastRef.current, captureSnapshot()].slice(-HISTORY_LIMIT);
    restoreSnapshot(next);
    setHistoryVersion((version) => version + 1);
    setAnnouncement("Modification rétablie.");
  }, [captureSnapshot, restoreSnapshot]);

  const canUndo = historyVersion >= 0 && pastRef.current.length > 0;
  const canRedo = historyVersion >= 0 && futureRef.current.length > 0;

  const activeMap = useMemo(
    () =>
      activeTabId
        ? (cellsByTab.get(activeTabId) ?? new Map<string, string>())
        : new Map<string, string>(),
    [activeTabId, cellsByTab],
  );

  const activeStyles = useMemo(
    () =>
      activeTabId
        ? (stylesByTab.get(activeTabId) ?? new Map<string, CellStyle>())
        : new Map<string, CellStyle>(),
    [activeTabId, stylesByTab],
  );

  // Autres onglets du classeur, par nom : références `Feuil2!A1` (S16).
  const otherSheets = useMemo(() => {
    const sheets: Record<string, CellMap> = {};
    for (const tab of detail?.tabs ?? []) {
      if (tab.id === activeTabId) continue;
      const map = cellsByTab.get(tab.id);
      const raw: CellMap = {};
      for (const [key, value] of map ?? []) {
        const [row, col] = key.split(":").map(Number);
        raw[cellKey(row ?? 0, col ?? 0)] = value;
      }
      sheets[tab.name] = raw;
    }
    return sheets;
  }, [detail?.tabs, activeTabId, cellsByTab]);

  const evaluated = useMemo(() => {
    const raw: Record<string, string> = {};
    for (const [key, value] of activeMap) {
      const [row, col] = key.split(":").map(Number);
      raw[cellKey(row ?? 0, col ?? 0)] = value;
    }
    return evaluateCells(raw, { sheets: otherSheets, sheetName: activeTab?.name });
  }, [activeMap, otherSheets, activeTab?.name]);

  /** Style de la cellule active (v1 : la grille ne met en forme qu'une cellule). */
  const selectedStyle = selectedKey ? (activeStyles.get(selectedKey) ?? null) : null;

  // Réglages persistés de l'onglet : volets figés, filtre, graphiques (v3.1).
  const activeSettings: TabSettings = activeTab?.settings ?? EMPTY_SETTINGS;
  const frozenRows = Math.min(activeSettings.frozen?.rows ?? 0, ROWS);
  const frozenCols = Math.min(activeSettings.frozen?.cols ?? 0, COLS);
  const autoFilter = activeSettings.filter;

  /** Texte affiché d'une cellule (formule calculée, format appliqué). */
  const displayAt = useCallback(
    (row: number, col: number): string => {
      const value = evaluated.get(cellKey(row, col));
      if (!value) return "";
      const style = activeStyles.get(`${row}:${col}`);
      const text = formatValue(value);
      if (style?.numberFormat) {
        return formatCustom(text, style.numberFormat, value.kind === "number" ? value.value : null)
          .text;
      }
      return formatCellDisplay(text, style?.format ?? "auto");
    },
    [evaluated, activeStyles],
  );

  const filteredRows = useMemo(
    () => (autoFilter ? hiddenRows(autoFilter, displayAt) : new Set<number>()),
    [autoFilter, displayAt],
  );

  /** Remplace les réglages de l'onglet actif (optimiste, puis serveur). */
  const updateTabSettings = useCallback(
    async (mutate: (current: TabSettings) => TabSettings) => {
      const tabId = activeTabIdRef.current;
      if (!tabId || !canEditRef.current) return;
      const before = detailRef.current?.tabs.find((tab) => tab.id === tabId)?.settings ?? {};
      const next = mutate(before);
      setDetail((current) =>
        current
          ? {
              ...current,
              tabs: current.tabs.map((tab) =>
                tab.id === tabId ? { ...tab, settings: next } : tab,
              ),
            }
          : current,
      );
      try {
        const saved = await setTabSettingsFn({ data: { tabId, settings: next } });
        setDetail((current) =>
          current
            ? {
                ...current,
                tabs: current.tabs.map((tab) =>
                  tab.id === tabId ? { ...tab, settings: saved } : tab,
                ),
              }
            : current,
        );
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Réglage de l'onglet impossible.");
        void load();
      }
    },
    [load],
  );

  const flush = useCallback(
    async (tabId: string | null) => {
      if (!tabId || pendingRef.current.size === 0) return;
      const updates = [...pendingRef.current.values()];
      pendingRef.current = new Map();
      setStatus("saving");
      try {
        await saveCellsFn({ data: { fileId, tabId, updates } });
        if (retryRef.current) {
          clearTimeout(retryRef.current);
          retryRef.current = null;
        }
        setStatus("saved");
      } catch (caught) {
        setStatus("error");
        setError(caught instanceof Error ? caught.message : "Sauvegarde impossible.");
        // Les cellules non re-modifiées entre-temps repartent en attente.
        for (const update of updates) {
          const key = `${update.row}:${update.col}`;
          if (!pendingRef.current.has(key)) pendingRef.current.set(key, update);
        }
        // Nouvelle tentative automatique : le statut reste « error » jusqu'à succès.
        if (!retryRef.current) {
          retryRef.current = setTimeout(() => {
            retryRef.current = null;
            void flushRef.current(activeTabIdRef.current);
          }, SAVE_RETRY_MS);
        }
      }
    },
    [fileId],
  );

  useEffect(() => {
    flushRef.current = flush;
  }, [flush]);

  // Au démontage : on coupe les minuteurs et on tente une dernière sauvegarde.
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      if (retryRef.current) {
        clearTimeout(retryRef.current);
        retryRef.current = null;
      }
      void flushRef.current(activeTabIdRef.current);
    };
  }, []);

  const queueSave = useCallback(
    (tabId: string, update: { row: number; col: number; value: string }) => {
      pendingRef.current.set(`${update.row}:${update.col}`, update);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        void flush(tabId);
      }, SAVE_DEBOUNCE_MS);
    },
    [flush],
  );

  // -------------------------------------------------------------------------
  // Persistance des tailles de colonnes et de lignes (TASK-001)
  // -------------------------------------------------------------------------

  const flushSizes = useCallback(
    async (tabId: string | null) => {
      if (!tabId || pendingSizesRef.current.size === 0) return;
      const sizes = [...pendingSizesRef.current.values()];
      pendingSizesRef.current = new Map();
      try {
        await setDimensionSizesFn({ data: { fileId, tabId, sizes } });
      } catch (caught) {
        setError(
          caught instanceof Error ? caught.message : "Enregistrement des tailles impossible.",
        );
        // Les tailles non re-modifiées entre-temps repartent en attente.
        for (const entry of sizes) {
          const key = sizeKey(entry.axis, entry.index);
          if (!pendingSizesRef.current.has(key)) pendingSizesRef.current.set(key, entry);
        }
      }
    },
    [fileId],
  );

  useEffect(() => {
    sizeFlushRef.current = flushSizes;
  }, [flushSizes]);

  // Au démontage : on coule la dernière sauvegarde de tailles.
  useEffect(() => {
    return () => {
      if (sizeTimerRef.current) {
        clearTimeout(sizeTimerRef.current);
        sizeTimerRef.current = null;
      }
      if (previewFrameRef.current !== null) {
        cancelAnimationFrame(previewFrameRef.current);
        previewFrameRef.current = null;
      }
      void sizeFlushRef.current(activeTabIdRef.current);
    };
  }, []);

  const queueSizeSave = useCallback((tabId: string, entry: DimensionSize) => {
    pendingSizesRef.current.set(sizeKey(entry.axis, entry.index), entry);
    if (sizeTimerRef.current) clearTimeout(sizeTimerRef.current);
    sizeTimerRef.current = setTimeout(() => {
      sizeTimerRef.current = null;
      void sizeFlushRef.current(tabId);
    }, SIZE_SAVE_DEBOUNCE_MS);
  }, []);

  /** Enregistre une taille choisie au glisser ou au clavier. */
  const commitSize = useCallback(
    (axis: DimensionAxis, index: number, size: number) => {
      const tabId = activeTabIdRef.current;
      if (!tabId || !canEditRef.current) return;
      const clamped = clampSize(axis, size);
      setPreview(null);
      setSizesByTab((current) => {
        const existing = current.get(tabId) ?? EMPTY_SIZES;
        const next = new Map(current);
        next.set(tabId, {
          ...existing,
          [axis]: applyResize(existing[axis], axis, index, clamped),
        });
        return next;
      });
      queueSizeSave(tabId, { axis, index, size: clamped });
    },
    [queueSizeSave],
  );

  /** Revient à la taille par défaut (double-clic, touche Origine). */
  const resetSize = useCallback(
    (axis: DimensionAxis, index: number) => {
      commitSize(axis, index, DIMENSION_LIMITS[axis].fallback);
    },
    [commitSize],
  );

  // Aperçu du glisser : borné à une image d'animation pour rester fluide.
  const onPreviewSize = useCallback((axis: DimensionAxis, index: number, size: number) => {
    previewValueRef.current = { axis, index, size };
    if (previewFrameRef.current !== null) return;
    previewFrameRef.current = requestAnimationFrame(() => {
      previewFrameRef.current = null;
      setPreview(previewValueRef.current);
    });
  }, []);

  const onSettlePreview = useCallback((axis: DimensionAxis, index: number) => {
    previewValueRef.current = null;
    if (previewFrameRef.current !== null) {
      cancelAnimationFrame(previewFrameRef.current);
      previewFrameRef.current = null;
    }
    setPreview((current) =>
      current && current.axis === axis && current.index === index ? null : current,
    );
  }, []);

  const commitCell = useCallback(
    (row: number, col: number, value: string) => {
      const tabId = activeTabIdRef.current;
      if (!tabId || !canEditRef.current) return;
      const key = `${row}:${col}`;
      // Une validation sans changement n'écrit rien et n'entre pas dans
      // l'historique.
      if ((cellsRef.current.get(tabId)?.get(key) ?? "") === value) return;
      pushHistory("cell");
      setCellsByTab((current) => {
        const next = new Map(current);
        const map = new Map(next.get(tabId) ?? []);
        if (value === "") map.delete(key);
        else map.set(key, value);
        next.set(tabId, map);
        return next;
      });
      setStatus("idle");
      queueSave(tabId, { row, col, value });
    },
    [pushHistory, queueSave],
  );

  /**
   * Écriture groupée (recopie, collage, effacement) : une seule entrée
   * d'historique, une seule mise à jour d'état, une file de sauvegarde.
   */
  const commitCells = useCallback(
    (updates: { row: number; col: number; value: string }[], kind = "batch") => {
      const tabId = activeTabIdRef.current;
      if (!tabId || !canEditRef.current) return 0;
      const existing = cellsRef.current.get(tabId) ?? new Map<string, string>();
      const changed = updates.filter(
        (update) =>
          update.row >= 0 &&
          update.col >= 0 &&
          update.row < ROWS &&
          update.col < COLS &&
          (existing.get(`${update.row}:${update.col}`) ?? "") !== update.value,
      );
      if (changed.length === 0) return 0;
      pushHistory(kind);
      setCellsByTab((current) => {
        const next = new Map(current);
        const map = new Map(next.get(tabId) ?? []);
        for (const update of changed) {
          const key = `${update.row}:${update.col}`;
          if (update.value === "") map.delete(key);
          else map.set(key, update.value);
        }
        next.set(tabId, map);
        return next;
      });
      setStatus("idle");
      for (const update of changed) queueSave(tabId, update);
      return changed.length;
    },
    [pushHistory, queueSave],
  );

  /** Fait défiler la grille pour que la cellule soit visible (sous les en-têtes). */
  const ensureVisible = useCallback((row: number, col: number) => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const header = scroller.querySelector<HTMLElement>("thead th, thead td");
    const headerHeight = header?.offsetHeight ?? 25;
    const top = headerHeight + (rowOffsetsRef.current[row] ?? 0);
    const bottom = headerHeight + (rowOffsetsRef.current[row + 1] ?? 0);
    if (top - headerHeight < scroller.scrollTop) scroller.scrollTop = top - headerHeight;
    else if (bottom > scroller.scrollTop + scroller.clientHeight) {
      scroller.scrollTop = bottom - scroller.clientHeight;
    }
    const columnHeader = scroller.querySelector<HTMLElement>(`[data-col-index="${col}"]`);
    const gutter = scroller.querySelector<HTMLElement>("thead td")?.offsetWidth ?? 44;
    if (columnHeader) {
      const left = columnHeader.offsetLeft;
      const right = left + columnHeader.offsetWidth;
      if (left - gutter < scroller.scrollLeft) scroller.scrollLeft = Math.max(0, left - gutter);
      else if (right > scroller.scrollLeft + scroller.clientWidth) {
        scroller.scrollLeft = right - scroller.clientWidth;
      }
    }
  }, []);

  /** Sélectionne une cellule, puis lui donne le focus une fois rendue. */
  const focusCell = useCallback(
    (row: number, col: number) => {
      ensureVisible(row, col);
      requestAnimationFrame(() => {
        const element = scrollRef.current?.querySelector<HTMLButtonElement>(
          `[data-cell-row="${row}"][data-cell-col="${col}"]`,
        );
        element?.focus({ preventScroll: true });
      });
    },
    [ensureVisible],
  );

  /** Appui du pointeur : sélection simple, Maj = étendre ; début du glisser. */
  const onPointerSelect = useCallback((row: number, col: number, extend: boolean) => {
    draggingRef.current = true;
    if (extend && selectedRef.current) {
      setRangeAnchor({ row, col });
      return;
    }
    setSelected({ row, col });
    setRangeAnchor(null);
  }, []);

  /** Glisser de sélection : la cellule active reste fixe, la plage suit. */
  const onPointerExtend = useCallback((row: number, col: number) => {
    if (!draggingRef.current || !selectedRef.current) return;
    const active = selectedRef.current;
    setRangeAnchor(active.row === row && active.col === col ? null : { row, col });
  }, []);

  useEffect(() => {
    const stop = () => {
      draggingRef.current = false;
    };
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
    return () => {
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
  }, []);

  /**
   * Édition demandée mais pas encore rendue : une frappe rapide (« 12 »)
   * arrive avant le montage du champ, elle complète alors le brouillon au
   * lieu de le remplacer.
   */
  const pendingEditRef = useRef<{ row: number; col: number; draft: string | null } | null>(null);

  const startEditing = useCallback((row: number, col: number, draft: string | null = null) => {
    if (!canEditRef.current) return;
    const pending = pendingEditRef.current;
    const next =
      pending && pending.row === row && pending.col === col && draft !== null
        ? { row, col, draft: (pending.draft ?? "") + draft }
        : { row, col, draft };
    pendingEditRef.current = next;
    setSelected({ row, col });
    setRangeAnchor(null);
    setEditing(next);
  }, []);

  // Le champ est rendu : les frappes suivantes vont directement dans le champ.
  useEffect(() => {
    if (!editing) pendingEditRef.current = null;
    else
      requestAnimationFrame(() => {
        pendingEditRef.current = null;
      });
  }, [editing]);

  const onEditRequest = useCallback(
    (row: number, col: number) => startEditing(row, col, null),
    [startEditing],
  );

  const cancelEditing = useCallback(() => {
    const current = selectedRef.current;
    setEditing(null);
    if (current) focusCell(current.row, current.col);
  }, [focusCell]);

  /**
   * Validation de la saisie : la sélection descend (Entrée), remonte
   * (Maj+Entrée) ou passe à droite / à gauche (Tab, Maj+Tab), comme dans
   * Excel — la cellule suivante est sélectionnée, pas éditée.
   */
  const commitEditing = useCallback(
    (row: number, col: number, value: string, move: MoveDirection) => {
      if (value.length > MAX_CELL_CHARS) {
        setError(`Cellule limitée à ${MAX_CELL_CHARS} caractères.`);
        return;
      }
      commitCell(row, col, value);
      setEditing((current) =>
        current && current.row === row && current.col === col ? null : current,
      );
      const nextRow =
        move === "down" ? Math.min(row + 1, ROWS - 1) : move === "up" ? Math.max(0, row - 1) : row;
      const nextCol =
        move === "right"
          ? Math.min(col + 1, COLS - 1)
          : move === "left"
            ? Math.max(0, col - 1)
            : col;
      setSelected({ row: nextRow, col: nextCol });
      setRangeAnchor(null);
      if (move !== "none") focusCell(nextRow, nextCol);
    },
    [commitCell, focusCell],
  );

  /**
   * Applique une mutation de style à toute la sélection (cellule ou plage),
   * en optimiste : la grille est mise à jour tout de suite puis rejouée côté
   * serveur par groupes de style identique ; en cas d'échec, l'ancien style
   * est restauré. Au-delà de `STYLE_RANGE_LIMIT` cellules (colonne entière,
   * Ctrl+A), seules les cellules utilisées de la plage sont visées.
   */
  const applyCellStyle = useCallback(
    async (mutate: (current: CellStyle | null) => CellStyle | null) => {
      const tabId = activeTabId;
      const target = selected;
      if (!tabId || !target || !canEdit || styleBusy) return;
      const range = selectionRange ?? rangeFrom(target, target);
      const styleMap = stylesByTab.get(tabId) ?? new Map<string, CellStyle>();
      const valueMap = cellsByTab.get(tabId) ?? new Map<string, string>();
      const size = (range.endRow - range.startRow + 1) * (range.endCol - range.startCol + 1);
      const keys: string[] = [];
      if (size <= STYLE_RANGE_LIMIT) {
        for (let row = range.startRow; row <= range.endRow; row += 1) {
          for (let col = range.startCol; col <= range.endCol; col += 1) keys.push(`${row}:${col}`);
        }
      } else {
        const used = new Set<string>([...valueMap.keys(), ...styleMap.keys()]);
        for (const key of used) {
          const { row, col } = cellOfKey(key);
          if (inRange(range, row, col)) keys.push(key);
        }
      }
      const previous = new Map(keys.map((key) => [key, styleMap.get(key) ?? null] as const));
      const nextStyles = new Map(
        keys.map((key) => [key, mutate(previous.get(key) ?? null)] as const),
      );
      const changed = keys.filter(
        (key) =>
          JSON.stringify(previous.get(key) ?? null) !== JSON.stringify(nextStyles.get(key) ?? null),
      );
      if (changed.length === 0) return;
      pushHistory("style");
      setStyleBusy(true);
      setError(null);
      const applyLocally = (source: Map<string, CellStyle | null>) =>
        setStylesByTab((current) => {
          const next = new Map(current);
          const map = new Map(next.get(tabId) ?? []);
          for (const key of changed) {
            const style = source.get(key) ?? null;
            if (style === null) map.delete(key);
            else map.set(key, style);
          }
          next.set(tabId, map);
          return next;
        });
      applyLocally(nextStyles);
      try {
        const groups = new Map<string, { style: CellStyle | null; cells: CellAddress[] }>();
        for (const key of changed) {
          const style = nextStyles.get(key) ?? null;
          const groupKey = JSON.stringify(style);
          const group = groups.get(groupKey) ?? { style, cells: [] };
          group.cells.push(cellOfKey(key));
          groups.set(groupKey, group);
        }
        for (const group of groups.values()) {
          for (let offset = 0; offset < group.cells.length; offset += MAX_STYLE_CELLS) {
            await setCellStyleFn({
              data: {
                fileId,
                tabId,
                cells: group.cells.slice(offset, offset + MAX_STYLE_CELLS),
                style: group.style,
              },
            });
          }
        }
      } catch (caught) {
        applyLocally(previous);
        setError(caught instanceof Error ? caught.message : "Mise en forme impossible.");
      } finally {
        setStyleBusy(false);
      }
    },
    [
      activeTabId,
      canEdit,
      cellsByTab,
      fileId,
      pushHistory,
      selected,
      selectionRange,
      styleBusy,
      stylesByTab,
    ],
  );

  // Les bascules suivent la cellule active, comme dans Excel : si elle est en
  // gras, toute la plage perd le gras ; sinon toute la plage le prend.
  const toggleFlag = useCallback(
    (flag: "bold" | "italic" | "underline" | "strike") => {
      const enable = selectedStyle?.[flag] !== true;
      void applyCellStyle((current) => {
        const next = { ...(current ?? {}) };
        if (enable) next[flag] = true;
        else delete next[flag];
        return Object.keys(next).length > 0 ? next : null;
      });
    },
    [applyCellStyle, selectedStyle],
  );

  const toggleAlign = useCallback(
    (align: CellStyleAlign) => {
      const remove = selectedStyle?.align === align;
      void applyCellStyle((current) =>
        remove ? withoutKey(current ?? {}, "align") : { ...(current ?? {}), align },
      );
    },
    [applyCellStyle, selectedStyle],
  );

  function toggleBackground(background: CellStyleBackground): void {
    const remove = selectedStyle?.background === background;
    void applyCellStyle((current) =>
      remove ? withoutKey(current ?? {}, "background") : { ...(current ?? {}), background },
    );
  }

  const toggleColor = useCallback(
    (color: CellTextColor) => {
      const remove = selectedStyle?.color === color;
      void applyCellStyle((current) =>
        remove ? withoutKey(current ?? {}, "color") : { ...(current ?? {}), color },
      );
    },
    [applyCellStyle, selectedStyle],
  );

  /** Format d'affichage : « auto » (ou re-clic) retire la clé, jamais de valeur par défaut stockée. */
  const toggleFormat = useCallback(
    (format: CellFormatId) => {
      const remove = format === "auto" || selectedStyle?.format === format;
      void applyCellStyle((current) => {
        const base = withoutKey(current ?? {}, "numberFormat") ?? {};
        return remove ? withoutKey(base, "format") : { ...base, format };
      });
    },
    [applyCellStyle, selectedStyle],
  );

  async function onRenameSpreadsheet() {
    if (!detail) return;
    const clean = title.trim();
    if (clean.length === 0 || clean === detail.title) {
      setTitle(detail.title);
      return;
    }
    try {
      const renamed = await renameSpreadsheetFn({ data: { fileId, title: clean } });
      setDetail({ ...detail, title: renamed.title });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Renommage impossible.");
      setTitle(detail.title);
    }
  }

  async function onSubmitTab(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail || tabName.trim().length === 0) return;
    setBusy(true);
    try {
      if (tabDialog === "add") {
        const tabs = await addTabFn({ data: { fileId, name: tabName.trim() } });
        setDetail({ ...detail, tabs });
        setCellsByTab((current) => {
          const next = new Map(current);
          for (const tab of tabs) if (!next.has(tab.id)) next.set(tab.id, new Map());
          return next;
        });
        setActiveTabId(tabs[tabs.length - 1]?.id ?? activeTabId);
      } else if (tabDialog === "rename" && activeTabId) {
        await renameTabFn({ data: { tabId: activeTabId, name: tabName.trim() } });
        setDetail({
          ...detail,
          tabs: detail.tabs.map((tab) =>
            tab.id === activeTabId ? { ...tab, name: tabName.trim() } : tab,
          ),
        });
      }
      setTabDialog(null);
      setTabName("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Opération impossible.");
    } finally {
      setBusy(false);
    }
  }

  async function onDeleteTab(tabId: string) {
    setBusy(true);
    try {
      await flush(activeTabId);
      await deleteTabFn({ data: { tabId } });
      setSelected(null);
      setRangeAnchor(null);
      setActiveTabId(null);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Suppression impossible.");
    } finally {
      setBusy(false);
    }
  }

  function onImportFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") setImportText(reader.result);
    };
    reader.onerror = () => setError("Lecture du fichier impossible.");
    reader.readAsText(file);
  }

  async function onImportCsv() {
    const tabId = activeTabIdRef.current;
    if (!tabId) return;
    setImportBusy(true);
    try {
      // Les modifications en attente d'autosave partiraient après l'import et
      // écraseraient ses cellules : on les sauvegarde d'abord.
      await flush(tabId);
      await flushSizes(tabId);
      await importCsvFn({ data: { fileId, tabId, text: importText } });
      setImportOpen(false);
      setImportText("");
      if (fileInputRef.current) fileInputRef.current.value = "";
      await load();
      setStatus("saved");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Import impossible.");
    } finally {
      setImportBusy(false);
    }
  }

  // -------------------------------------------------------------------------
  // Menu contextuel : insertion, suppression et mise en forme (TASK-002)
  // -------------------------------------------------------------------------

  /**
   * Exécute une opération structurelle. La sélection suivante est calculée
   * avant l'appel (logique pure de `structure.ts`), puis la feuille est
   * relue : les cellules ont été décalées côté serveur.
   */
  const runStructure = useCallback(
    async (kind: StructureKind, mode: StructureMode, index: number) => {
      const tabId = activeTabIdRef.current;
      if (!tabId || !canEditRef.current || structureBusy) return;
      setError(null);
      setStructureBusy(true);
      setSelected((current) => selectionAfter(kind, mode, index, 1, current));
      setRangeAnchor(null);
      setEditing(null);
      try {
        // Les cellules en attente seraient écrasées par le décalage.
        await flush(tabId);
        await flushSizes(tabId);
        await (kind === "row"
          ? mode === "insert"
            ? insertRowsFn
            : deleteRowsFn
          : mode === "insert"
            ? insertColumnsFn
            : deleteColumnsFn)({ data: { fileId, tabId, index } });
        await load();
        setAnnouncement(structureMessage(kind, mode, 1));
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Opération impossible.");
      } finally {
        setStructureBusy(false);
      }
    },
    [fileId, flush, flushSizes, load, structureBusy],
  );

  /** Ouvre le menu contextuel sur une cible, en coordonnées d'écran. */
  const openMenu = useCallback((target: ContextTarget, anchor: { left: number; top: number }) => {
    if (target.kind === "cell") {
      // Clic droit dans la plage sélectionnée : la plage est conservée (trier,
      // effacer, mettre en forme toute la plage), comme dans Excel.
      const active = selectedRef.current;
      const extent = rangeAnchorRef.current;
      const keep =
        active !== null &&
        extent !== null &&
        inRange(rangeFrom(active, extent), target.row, target.col);
      if (!keep) {
        setSelected({ row: target.row, col: target.col });
        setRangeAnchor(null);
      }
      setEditing(null);
    }
    setMenu({ x: anchor.left, y: anchor.top, target });
  }, []);

  const closeMenu = useCallback(() => setMenu(null), []);

  /** Intitulé du menu, lu par les lecteurs d'écran. */
  const menuLabel = useMemo(() => {
    if (!menu) return "";
    const target = menu.target;
    if (target.kind === "cell") return `Menu de la cellule ${cellKey(target.row, target.col)}`;
    if (target.kind === "row") return `Menu de la ligne ${target.index + 1}`;
    return `Menu de la colonne ${COL_LETTERS[target.index]}`;
  }, [menu]);

  /** Ouvre le menu depuis le clavier (touche Menu) sur la cellule active. */
  const requestCellMenu = useCallback(
    (row: number, col: number, anchor: DOMRect, pointer?: { x: number; y: number }) => {
      openMenu(
        { kind: "cell", row, col },
        pointer ? { left: pointer.x, top: pointer.y } : { left: anchor.left, top: anchor.bottom },
      );
    },
    [openMenu],
  );

  // -------------------------------------------------------------------------
  // Barre de formule (TASK-003)
  // -------------------------------------------------------------------------

  const activeSizes = sizesByTab.get(activeTabId ?? "") ?? EMPTY_SIZES;
  // Pendant le glisser, la taille aperçue remplace celle enregistrée.
  const colSizes =
    preview?.axis === "col"
      ? applyResize(activeSizes.col, "col", preview.index, preview.size)
      : activeSizes.col;
  const rowSizes =
    preview?.axis === "row"
      ? applyResize(activeSizes.row, "row", preview.index, preview.size)
      : activeSizes.row;

  const columnTracks = useMemo(
    () =>
      Array.from({ length: COLS }, (_, col) => {
        const size = colSizes.get(col);
        return size === undefined ? "minmax(var(--sheet-col-min), 1fr)" : `minmax(0, ${size}px)`;
      }).join(" "),
    [colSizes],
  );

  // Virtualisation des lignes : décalages cumulés, puis fenêtre rendue (les
  // lignes hors écran sont remplacées par deux espaceurs de même hauteur).
  // Lignes masquées par le filtre : hauteur nulle (et non rendues).
  const rowOffsets = useMemo(() => {
    const offsets = new Array<number>(ROWS + 1);
    offsets[0] = 0;
    for (let row = 0; row < ROWS; row += 1) {
      const height = filteredRows.has(row) ? 0 : (rowSizes.get(row) ?? ROW_HEIGHT);
      offsets[row + 1] = (offsets[row] ?? 0) + height;
    }
    return offsets;
  }, [rowSizes, filteredRows]);
  rowOffsetsRef.current = rowOffsets;

  const firstRow = Math.max(0, rowIndexAt(rowOffsets, viewport.top) - OVERSCAN_ROWS);
  const lastRow = Math.min(
    ROWS - 1,
    rowIndexAt(rowOffsets, viewport.top + viewport.height) + OVERSCAN_ROWS,
  );
  // Fenêtre rendue : lignes figées d'abord (toujours rendues, collantes), puis
  // les lignes visibles ; les lignes filtrées sont absentes du rendu.
  const windowStart = Math.max(frozenRows, firstRow);
  const topSpacer = Math.max(0, (rowOffsets[windowStart] ?? 0) - (rowOffsets[frozenRows] ?? 0));
  const bottomSpacer = Math.max(
    0,
    (rowOffsets[ROWS] ?? 0) - (rowOffsets[Math.max(lastRow, windowStart - 1) + 1] ?? 0),
  );
  const renderPlan = useMemo(() => {
    const frozen: number[] = [];
    for (let row = 0; row < frozenRows; row += 1) if (!filteredRows.has(row)) frozen.push(row);
    const windowRows: number[] = [];
    for (let row = windowStart; row <= lastRow; row += 1) {
      if (!filteredRows.has(row)) windowRows.push(row);
    }
    // Ligne de grille CSS (1-basée) de chaque ligne rendue : en-tête = 1,
    // lignes figées ensuite, espaceur, puis la fenêtre.
    const lineOf = new Map<number, number>();
    for (const [index, row] of frozen.entries()) lineOf.set(row, 2 + index);
    for (const [index, row] of windowRows.entries()) lineOf.set(row, 3 + frozen.length + index);
    return { frozen, windowRows, lineOf };
  }, [frozenRows, filteredRows, windowStart, lastRow]);
  const rowTracks = useMemo(() => {
    const height = (row: number) => `${rowSizes.get(row) ?? ROW_HEIGHT}px`;
    return {
      frozen: renderPlan.frozen.map(height).join(" "),
      window: renderPlan.windowRows.map(height).join(" "),
    };
  }, [renderPlan, rowSizes]);

  // Mesures des volets figés : hauteur de la ligne des lettres et bord gauche
  // de chaque colonne figée (les colonnes sont fluides, on lit le rendu).
  // biome-ignore lint/correctness/useExhaustiveDependencies: les tailles de colonnes et le chargement déplacent les bords mesurés.
  useLayoutEffect(() => {
    const corner = headerCellRef.current;
    if (corner) setHeaderHeight(corner.offsetHeight);
    const table = corner?.closest("table");
    if (!table || frozenCols === 0) {
      setFrozenLefts((current) => (current.length === 0 ? current : []));
      return;
    }
    const lefts: number[] = [];
    for (let col = 0; col < frozenCols; col += 1) {
      const th = table.querySelector<HTMLElement>(`th[data-col-index="${col}"]`);
      lefts.push(th?.offsetLeft ?? 44);
    }
    setFrozenLefts((current) =>
      current.length === lefts.length && current.every((value, index) => value === lefts[index])
        ? current
        : lefts,
    );
  }, [frozenCols, colSizes, detail, freeze]);

  /** Style collant d'une cellule figée (ligne, colonne ou les deux). */
  const frozenStyle = (row: number | null, col: number | null): CSSProperties | undefined => {
    const stickyRow = row !== null && row < frozenRows;
    const stickyCol = col !== null && col < frozenCols;
    if (!stickyRow && !stickyCol) return undefined;
    const style: CSSProperties = { position: "sticky" };
    if (stickyRow && row !== null) {
      style.top = (freeze.header ? headerHeight : 0) + (rowOffsets[row] ?? 0);
    }
    if (stickyCol && col !== null) {
      style.left = (frozenLefts[col] ?? 44) - (freeze.firstColumn ? 0 : 44);
    }
    return style;
  };

  // Fenêtre visible : suivie au défilement (une image d'animation au plus) et
  // au redimensionnement de la zone. Relancé au chargement : la zone de
  // défilement n'existe qu'une fois la feuille lue.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `detail` signale le montage de la zone de défilement.
  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    let frame: number | null = null;
    const sync = () => {
      frame = null;
      setViewport((current) =>
        current.top === scroller.scrollTop && current.height === scroller.clientHeight
          ? current
          : { top: scroller.scrollTop, height: scroller.clientHeight },
      );
    };
    const onScroll = () => {
      if (frame === null) frame = requestAnimationFrame(sync);
    };
    sync();
    scroller.addEventListener("scroll", onScroll, { passive: true });
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(onScroll);
    observer?.observe(scroller);
    return () => {
      scroller.removeEventListener("scroll", onScroll);
      observer?.disconnect();
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [detail]);

  const currentBarDraft = barDraft?.key === selectedKey ? barDraft.value : null;

  /** Valeur affichée par la barre de formule, aperçu de formule compris. */
  const barResult = useMemo(() => {
    if (!selectedKey) return null;
    if (currentBarDraft === null) {
      const value = evaluated.get(selectedKey);
      return value ? formatValue(value) : "";
    }
    // Pendant la saisie, on évalue la formule en cours sans toucher la grille.
    // Le moteur attend des références « A1 » (et non des clés « ligne:col »).
    const raw: Record<string, string> = {};
    for (const [key, value] of activeMap) {
      const { row, col } = cellOfKey(key);
      raw[cellKey(row, col)] = value;
    }
    const reference = selected ? cellKey(selected.row, selected.col) : "";
    raw[reference] = currentBarDraft;
    const previewValue = evaluateCells(raw).get(reference);
    return previewValue ? formatValue(previewValue) : "";
  }, [activeMap, currentBarDraft, evaluated, selected, selectedKey]);

  // -------------------------------------------------------------------------
  // Tri de la plage sélectionnée (TASK-006) et figement (TASK-005)
  // -------------------------------------------------------------------------

  /**
   * Trie la plage sélectionnée selon la colonne de la cellule active : les
   * lignes entières se déplacent, puis la mise à jour passe par l'autosave.
   */
  /** Trie les lignes d'une plage selon une colonne (sélection ou filtre). */
  const sortBy = useCallback(
    (range: CellRange, column: number, direction: SortDirection) => {
      if (!canEditRef.current || !activeTabIdRef.current) return;
      const values = new Map<string, string>();
      for (const [key, value] of activeMap) values.set(key, value);
      const result = sortRange({
        range,
        column,
        direction,
        values,
        bounds: { rows: ROWS, cols: COLS },
      });
      for (const update of result.updates) {
        commitCell(update.row, update.col, update.value);
      }
      setEditing(null);
      setMenu(null);
      setAnnouncement(sortSummary(result.moved, direction));
    },
    [activeMap, commitCell],
  );

  const runSort = useCallback(
    (direction: SortDirection) => {
      const range = selectionRange;
      if (!range || !selected || !canEditRef.current || !activeTabIdRef.current) return;
      const values = new Map<string, string>();
      for (const [key, value] of activeMap) values.set(key, value);
      const result = sortRange({
        range,
        column: selected.col,
        direction,
        values,
        bounds: { rows: ROWS, cols: COLS },
      });
      for (const update of result.updates) {
        commitCell(update.row, update.col, update.value);
      }
      setEditing(null);
      setMenu(null);
      setAnnouncement(sortSummary(result.moved, direction));
    },
    [activeMap, commitCell, selected, selectionRange],
  );

  /** Inverse un repère figé et l'annonce aux lecteurs d'écran. */
  function changeFreeze(part: keyof FreezeState) {
    const next = toggleFreeze(freeze, part);
    setFreeze(next);
    setAnnouncement(freezeAnnouncement(next));
  }

  function submitBarValue(value: string, move: MoveDirection) {
    if (!selected) return;
    if (value.length > MAX_CELL_CHARS) {
      setError(`Cellule limitée à ${MAX_CELL_CHARS} caractères.`);
      return;
    }
    commitCell(selected.row, selected.col, value);
    if (move === "none") {
      setEditing(null);
      return;
    }
    const nextRow = move === "down" ? Math.min(selected.row + 1, ROWS - 1) : selected.row;
    const nextCol = move === "right" ? Math.min(selected.col + 1, COLS - 1) : selected.col;
    setEditing(null);
    setSelected({ row: nextRow, col: nextCol });
    setRangeAnchor(null);
    focusCell(nextRow, nextCol);
  }

  function goToReference(reference: string) {
    const target = parseKey(reference);
    if (!target) {
      setError(`Référence « ${reference} » invalide.`);
      return;
    }
    if (target.row >= ROWS || target.col >= COLS) {
      setError(
        `Référence hors de la grille affichée (lignes 1 à ${ROWS}, colonnes A à ${COL_LETTERS[COLS - 1]}).`,
      );
      return;
    }
    setError(null);
    setEditing(null);
    setSelected({ row: target.row, col: target.col });
    setRangeAnchor(null);
    focusCell(target.row, target.col);
  }

  /**
   * Navigation clavier. `extend` (Maj + flèche) déplace le coin opposé de la
   * plage, la cellule active restant fixe (comme Excel) ; sinon la sélection
   * redevient une cellule seule.
   */
  const moveSelection = useCallback(
    (row: number, col: number, extend = false) => {
      const next = {
        row: Math.max(0, Math.min(ROWS - 1, row)),
        col: Math.max(0, Math.min(COLS - 1, col)),
      };
      if (extend && selectedRef.current) {
        const active = selectedRef.current;
        setRangeAnchor(active.row === next.row && active.col === next.col ? null : next);
        ensureVisible(next.row, next.col);
        return;
      }
      setRangeAnchor(null);
      setSelected(next);
      focusCell(next.row, next.col);
    },
    [ensureVisible, focusCell],
  );

  /** Valeurs brutes d'une plage, ligne par ligne. */
  const rangeValues = useCallback(
    (range: CellRange) => {
      const rows: string[][] = [];
      for (let row = range.startRow; row <= range.endRow; row += 1) {
        const line: string[] = [];
        for (let col = range.startCol; col <= range.endCol; col += 1) {
          line.push(activeMap.get(`${row}:${col}`) ?? "");
        }
        rows.push(line);
      }
      return rows;
    },
    [activeMap],
  );

  /** Copie (ou coupe) la cellule ou la plage active en TSV (TASK-004). */
  const copySelection = useCallback(
    async (cut = false) => {
      const active = selectedRef.current;
      const range = selectionRange ?? (active ? rangeFrom(active, active) : null);
      if (!range) return;
      const rows = rangeValues(range);
      const count = (range.endRow - range.startRow + 1) * (range.endCol - range.startCol + 1);
      const text = serializeTsv(rows);
      clipboardRef.current = {
        text,
        origin: { row: range.startRow, col: range.startCol },
        cut: cut ? range : null,
      };
      try {
        if (!navigator.clipboard?.writeText) throw new Error("API presse-papiers indisponible");
        await navigator.clipboard.writeText(text);
        setError(null);
        setAnnouncement(cut ? `${count} cellule(s) coupée(s).` : copySummary(count));
      } catch (caught) {
        setError(clipboardError("copy", caught));
      }
    },
    [rangeValues, selectionRange],
  );

  /**
   * Colle un TSV depuis le presse-papiers à partir de la cellule active
   * (TASK-004). Collage interne : les formules voient leurs références
   * relatives décalées ; après « Couper », la source est vidée. Une valeur
   * seule collée sur une plage remplit toute la plage.
   */
  const pasteSelection = useCallback(async () => {
    if (!canEditRef.current || !activeTabIdRef.current) return;
    try {
      if (!navigator.clipboard?.readText) throw new Error("API presse-papiers indisponible");
      const text = await navigator.clipboard.readText();
      let values = parseTsv(text);
      if (values.length === 0) return;
      const active = selectedRef.current ?? { row: 0, col: 0 };
      const extent = rangeAnchorRef.current;
      const range = extent ? rangeFrom(active, extent) : rangeFrom(active, active);
      const origin = { row: range.startRow, col: range.startCol };
      const internal = clipboardRef.current?.text === text ? clipboardRef.current : null;
      const updates: { row: number; col: number; value: string }[] = [];
      if (internal?.cut) {
        // Déplacement : la source est vidée, les formules gardent leurs références.
        for (let row = internal.cut.startRow; row <= internal.cut.endRow; row += 1) {
          for (let col = internal.cut.startCol; col <= internal.cut.endCol; col += 1) {
            updates.push({ row, col, value: "" });
          }
        }
        clipboardRef.current = null;
      } else if (internal) {
        values = shiftPasted(
          values,
          origin.row - internal.origin.row,
          origin.col - internal.origin.col,
        );
      }
      const single = values.length === 1 && values[0]?.length === 1;
      if (single && !isSingleCell(range)) {
        const model = values[0]?.[0] ?? "";
        for (let row = range.startRow; row <= range.endRow; row += 1) {
          for (let col = range.startCol; col <= range.endCol; col += 1) {
            const value =
              internal && model.startsWith("=")
                ? (shiftPasted([[model]], row - origin.row, col - origin.col)[0]?.[0] ?? model)
                : model;
            updates.push({ row, col, value });
          }
        }
      } else {
        for (const target of pasteTargets(values, origin, { rows: ROWS, cols: COLS })) {
          updates.push(target);
        }
      }
      // Les écritures de la cible l'emportent sur l'effacement de la source.
      const merged = new Map(updates.map((update) => [`${update.row}:${update.col}`, update]));
      commitCells([...merged.values()], "paste");
      setError(null);
      setAnnouncement(pasteSummary(merged.size));
    } catch (caught) {
      setError(clipboardError("paste", caught));
    }
  }, [commitCells]);

  /** Efface le contenu de la sélection (Suppr / Retour arrière). */
  const clearSelection = useCallback(() => {
    const active = selectedRef.current;
    if (!active || !canEditRef.current) return;
    const range = rangeAnchorRef.current
      ? rangeFrom(active, rangeAnchorRef.current)
      : rangeFrom(active, active);
    const updates: { row: number; col: number; value: string }[] = [];
    for (const key of activeMap.keys()) {
      const { row, col } = cellOfKey(key);
      if (inRange(range, row, col)) updates.push({ row, col, value: "" });
    }
    const count = commitCells(updates, "clear");
    if (count > 0) setAnnouncement(`${count} cellule(s) effacée(s).`);
  }, [activeMap, commitCells]);

  /** Recopie (poignée, Ctrl+D, Ctrl+R) : écrit la série et sélectionne la cible. */
  const applyFill = useCallback(
    (source: CellRange, target: CellRange) => {
      const updates = fillRange(source, target, activeMap);
      const count = commitCells(updates, "fill");
      setSelected({ row: target.startRow, col: target.startCol });
      setRangeAnchor(
        target.startRow === target.endRow && target.startCol === target.endCol
          ? null
          : { row: target.endRow, col: target.endCol },
      );
      if (count > 0) setAnnouncement(`${count} cellule(s) recopiée(s).`);
    },
    [activeMap, commitCells],
  );

  /** Ctrl+D (vers le bas) et Ctrl+R (vers la droite) sur la sélection. */
  const fillFromSelection = useCallback(
    (direction: "down" | "right") => {
      const active = selectedRef.current;
      if (!active || !canEditRef.current) return;
      const range = rangeAnchorRef.current ? rangeFrom(active, rangeAnchorRef.current) : null;
      if (direction === "down") {
        // Cellule seule : recopie la cellule du dessus, comme Excel.
        const source =
          range && range.endRow > range.startRow
            ? { ...range, endRow: range.startRow }
            : {
                startRow: active.row - 1,
                endRow: active.row - 1,
                startCol: active.col,
                endCol: active.col,
              };
        if (source.startRow < 0) return;
        const target =
          range && range.endRow > range.startRow ? range : { ...source, endRow: active.row };
        const updates = fillRange(source, target, activeMap).map((update) => ({
          ...update,
          value: activeMap.get(`${source.startRow}:${update.col}`)?.startsWith("=")
            ? update.value
            : (activeMap.get(`${source.startRow}:${update.col}`) ?? ""),
        }));
        commitCells(updates, "fill");
      } else {
        const source =
          range && range.endCol > range.startCol
            ? { ...range, endCol: range.startCol }
            : {
                startRow: active.row,
                endRow: active.row,
                startCol: active.col - 1,
                endCol: active.col - 1,
              };
        if (source.startCol < 0) return;
        const target =
          range && range.endCol > range.startCol ? range : { ...source, endCol: active.col };
        const updates = fillRange(source, target, activeMap).map((update) => ({
          ...update,
          value: activeMap.get(`${update.row}:${source.startCol}`)?.startsWith("=")
            ? update.value
            : (activeMap.get(`${update.row}:${source.startCol}`) ?? ""),
        }));
        commitCells(updates, "fill");
      }
    },
    [activeMap, commitCells],
  );

  /** Sélection d'une colonne ou d'une ligne entière (clic sur l'en-tête). */
  const selectWhole = useCallback((kind: "row" | "col", index: number, extend: boolean) => {
    setEditing(null);
    const active = selectedRef.current;
    if (kind === "col") {
      if (extend && active) {
        setSelected({ row: 0, col: active.col });
        setRangeAnchor({ row: ROWS - 1, col: index });
      } else {
        setSelected({ row: 0, col: index });
        setRangeAnchor({ row: ROWS - 1, col: index });
      }
    } else if (extend && active) {
      setSelected({ row: active.row, col: 0 });
      setRangeAnchor({ row: index, col: COLS - 1 });
    } else {
      setSelected({ row: index, col: 0 });
      setRangeAnchor({ row: index, col: COLS - 1 });
    }
  }, []);

  const onGridKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLElement>) => {
      const pending = pendingEditRef.current;
      if (
        pending &&
        pending.draft !== null &&
        event.key.length === 1 &&
        !event.ctrlKey &&
        !event.metaKey &&
        !isTypingTarget(event.target)
      ) {
        event.preventDefault();
        startEditing(pending.row, pending.col, event.key);
        return;
      }
      if (editing) return;
      if (isTypingTarget(event.target)) return;
      const mod = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      const current = selected ?? { row: 0, col: 0 };
      // Filtre automatique : Ctrl+Maj+L, comme Excel.
      if (mod && event.shiftKey && !event.altKey && key === "l" && canEdit) {
        event.preventDefault();
        toggleFilterRef.current();
        return;
      }
      // Presse-papiers : Ctrl+C copie, Ctrl+X coupe, Ctrl+V colle.
      if (mod && !event.altKey && (key === "c" || key === "x" || key === "v")) {
        event.preventDefault();
        if (key === "v") void pasteSelection();
        else void copySelection(key === "x");
        return;
      }
      if (mod && !event.altKey && canEdit && (key === "b" || key === "i" || key === "u")) {
        event.preventDefault();
        toggleFlag(key === "b" ? "bold" : key === "i" ? "italic" : "underline");
        return;
      }
      if (mod && !event.altKey && key === "a") {
        event.preventDefault();
        setSelected({ row: 0, col: 0 });
        setRangeAnchor({ row: ROWS - 1, col: COLS - 1 });
        return;
      }
      if (mod && !event.altKey && canEdit && (key === "d" || key === "r")) {
        event.preventDefault();
        fillFromSelection(key === "d" ? "down" : "right");
        return;
      }
      if (mod && !event.altKey && event.key === ";" && canEdit && selected) {
        // Ctrl+; : date du jour, comme dans Excel.
        event.preventDefault();
        commitCell(selected.row, selected.col, new Date().toLocaleDateString("fr-FR"));
        return;
      }
      const deltas: Record<string, [number, number]> = {
        ArrowUp: [-1, 0],
        ArrowDown: [1, 0],
        ArrowLeft: [0, -1],
        ArrowRight: [0, 1],
      };
      const delta = deltas[event.key];
      if (delta) {
        event.preventDefault();
        const base = event.shiftKey && rangeAnchorRef.current ? rangeAnchorRef.current : current;
        // Ctrl (ou Cmd) + flèche : bord de la zone de données, comme Excel.
        const target = mod
          ? jumpTarget(activeMap, base, delta, { rows: ROWS, cols: COLS })
          : { row: base.row + delta[0], col: base.col + delta[1] };
        moveSelection(target.row, target.col, event.shiftKey);
        return;
      }
      if (event.key === "Tab") {
        event.preventDefault();
        moveSelection(current.row, current.col + (event.shiftKey ? -1 : 1));
        return;
      }
      if (event.key === "PageDown" || event.key === "PageUp") {
        event.preventDefault();
        const page = Math.max(1, Math.floor(viewport.height / ROW_HEIGHT) - 1);
        moveSelection(
          current.row + (event.key === "PageDown" ? page : -page),
          current.col,
          event.shiftKey,
        );
        return;
      }
      if (event.key === "Home" && mod) {
        event.preventDefault();
        moveSelection(0, 0);
      } else if (event.key === "End" && mod) {
        event.preventDefault();
        let lastRow = 0;
        let lastCol = 0;
        for (const cellKeyValue of activeMap.keys()) {
          const { row, col } = cellOfKey(cellKeyValue);
          lastRow = Math.max(lastRow, row);
          lastCol = Math.max(lastCol, col);
        }
        moveSelection(lastRow, lastCol);
      } else if (event.key === "Home") {
        event.preventDefault();
        moveSelection(current.row, 0);
      } else if ((event.key === "Enter" || event.key === "F2") && selected && canEdit) {
        event.preventDefault();
        startEditing(selected.row, selected.col, null);
      } else if ((event.key === "Delete" || event.key === "Backspace") && canEdit) {
        event.preventDefault();
        clearSelection();
      } else if (event.key === "Escape" && rangeAnchorRef.current) {
        setRangeAnchor(null);
      } else if (
        canEdit &&
        selected &&
        !mod &&
        !event.altKey &&
        event.key.length === 1 &&
        event.key !== " "
      ) {
        // Frappe directe : la saisie remplace le contenu (mode « saisie »).
        event.preventDefault();
        startEditing(selected.row, selected.col, event.key);
      }
    },
    [
      activeMap,
      canEdit,
      clearSelection,
      commitCell,
      copySelection,
      editing,
      fillFromSelection,
      moveSelection,
      pasteSelection,
      selected,
      startEditing,
      toggleFlag,
      viewport.height,
    ],
  );

  // -------------------------------------------------------------------------
  // Construction du menu contextuel (TASK-002)
  // -------------------------------------------------------------------------

  /** Menu contextuel d'une cellule : lignes, colonnes, formats et tailles. */
  const menuItems = useMemo<SheetMenuItem[]>(() => {
    if (!menu) return [];
    const items: SheetMenuItem[] = [];
    const insert = (kind: StructureKind, index: number, label: string) => ({
      type: "item" as const,
      id: `inserer-${kind}-${index}`,
      label,
      disabled: !canEdit || structureBusy,
      onSelect: () => void runStructure(kind, "insert", index),
    });
    const remove = (kind: StructureKind, index: number, label: string) => ({
      type: "item" as const,
      id: `supprimer-${kind}`,
      label,
      disabled: !canEdit || structureBusy,
      destructive: true,
      onSelect: () => void runStructure(kind, "delete", index),
    });
    const format = (id: string, label: string, checked: boolean, action: () => void) => ({
      type: "item" as const,
      id,
      label,
      checked,
      disabled: !canEdit || styleBusy,
      onSelect: action,
    });

    const target = menu.target;
    if (target.kind === "cell") {
      items.push({
        type: "item",
        id: "couper",
        label: "Couper (Ctrl+X)",
        disabled: !canEdit,
        onSelect: () => void copySelection(true),
      });
      items.push({
        type: "item",
        id: "copier",
        label: "Copier (Ctrl+C)",
        onSelect: () => void copySelection(false),
      });
      items.push({
        type: "item",
        id: "coller",
        label: "Coller (Ctrl+V)",
        disabled: !canEdit,
        onSelect: () => void pasteSelection(),
      });
      items.push({
        type: "item",
        id: "effacer-contenu",
        label: "Effacer le contenu (Suppr)",
        disabled: !canEdit,
        onSelect: clearSelection,
      });
      items.push({
        type: "item",
        id: "recopier-bas",
        label: "Recopier vers le bas (Ctrl+D)",
        disabled: !canEdit,
        onSelect: () => fillFromSelection("down"),
      });
      items.push({ type: "separator", id: "lignes" });
      items.push(insert("row", target.row, "Insérer une ligne au-dessus"));
      items.push(insert("row", target.row + 1, "Insérer une ligne en dessous"));
      items.push({ type: "separator", id: "colonnes" });
      items.push(insert("col", target.col, "Insérer une colonne à gauche"));
      items.push(insert("col", target.col + 1, "Insérer une colonne à droite"));
      items.push({ type: "separator", id: "suppressions" });
      items.push(remove("row", target.row, "Supprimer la ligne"));
      items.push(remove("col", target.col, "Supprimer la colonne"));
      if (selectionRange && !isSingleCell(selectionRange)) {
        const scope = rangeLabel(selectionRange, (col) => COL_LETTERS[col] ?? "");
        items.push({ type: "separator", id: "tri" });
        items.push({
          type: "item",
          id: "trier-croissant",
          label: `Trier ${scope} (croissant)`,
          disabled: !canEdit || structureBusy,
          onSelect: () => runSort("asc"),
        });
        items.push({
          type: "item",
          id: "trier-decroissant",
          label: `Trier ${scope} (décroissant)`,
          disabled: !canEdit || structureBusy,
          onSelect: () => runSort("desc"),
        });
      }
      items.push({ type: "separator", id: "formats" });
      items.push(format("gras", "Gras", selectedStyle?.bold === true, () => toggleFlag("bold")));
      items.push(
        format("italique", "Italique", selectedStyle?.italic === true, () => toggleFlag("italic")),
      );
      items.push(
        format("souligne", "Souligné", selectedStyle?.underline === true, () =>
          toggleFlag("underline"),
        ),
      );
      items.push(
        format("barre", "Barré", selectedStyle?.strike === true, () => toggleFlag("strike")),
      );
      items.push({ type: "separator", id: "formats-numeriques" });
      items.push(
        format(
          "format-auto",
          "Format automatique",
          (selectedStyle?.format ?? "auto") === "auto",
          () => toggleFormat("auto"),
        ),
      );
      items.push(
        format("format-nombre", "Nombre (2 décimales)", selectedStyle?.format === "number", () =>
          toggleFormat("number"),
        ),
      );
      items.push(
        format("format-entier", "Entier", selectedStyle?.format === "integer", () =>
          toggleFormat("integer"),
        ),
      );
      items.push(
        format("format-pourcent", "Pourcentage", selectedStyle?.format === "percent", () =>
          toggleFormat("percent"),
        ),
      );
      items.push(
        format("format-euro", "Euro", selectedStyle?.format === "currency", () =>
          toggleFormat("currency"),
        ),
      );
      items.push(
        format(
          "format-milliers",
          "Séparateur de milliers",
          selectedStyle?.format === "thousands",
          () => toggleFormat("thousands"),
        ),
      );
      items.push(
        format("format-date", "Date", selectedStyle?.format === "date", () => toggleFormat("date")),
      );
      items.push(
        format("gauche", "Aligner à gauche", selectedStyle?.align === "left", () =>
          toggleAlign("left"),
        ),
      );
      items.push(
        format("centre", "Centrer", selectedStyle?.align === "center", () => toggleAlign("center")),
      );
      items.push(
        format("droite", "Aligner à droite", selectedStyle?.align === "right", () =>
          toggleAlign("right"),
        ),
      );
      items.push({
        type: "item",
        id: "effacer-format",
        label: "Effacer le format",
        disabled: !canEdit || styleBusy || !selectedStyle,
        onSelect: () => void applyCellStyle(() => null),
      });
    } else if (target.kind === "row") {
      items.push(insert("row", target.index, "Insérer une ligne au-dessus"));
      items.push(insert("row", target.index + 1, "Insérer une ligne en dessous"));
      items.push({ type: "separator", id: "suppressions" });
      items.push(remove("row", target.index, "Supprimer la ligne"));
    } else {
      items.push(insert("col", target.index, "Insérer une colonne à gauche"));
      items.push(insert("col", target.index + 1, "Insérer une colonne à droite"));
      items.push({ type: "separator", id: "suppressions" });
      items.push(remove("col", target.index, "Supprimer la colonne"));
    }

    if (!canEdit) {
      items.push({ type: "separator", id: "lecture-seule" });
      items.push({
        type: "item",
        id: "lecture-seule-info",
        label: "Feuille en lecture seule",
        disabled: true,
        onSelect: () => undefined,
      });
    }
    return items;
  }, [
    applyCellStyle,
    canEdit,
    clearSelection,
    copySelection,
    fillFromSelection,
    menu,
    pasteSelection,
    runSort,
    runStructure,
    selectedStyle,
    selectionRange,
    structureBusy,
    styleBusy,
    toggleAlign,
    toggleFlag,
    toggleFormat,
  ]);

  // Raccourcis d'historique, partout dans l'éditeur : Ctrl+Z annule,
  // Ctrl+Maj+Z et Ctrl+Y rétablissent. Les champs de saisie (édition de
  // cellule, barre de formule) et les dialogues gardent leur clavier natif.
  useEffect(() => {
    if (!canEdit) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      const target = event.target as Element | null;
      if (isTypingTarget(target) || isInsideDialog(target)) return;
      const key = event.key.toLowerCase();
      if (key === "z") {
        event.preventDefault();
        if (event.shiftKey) doRedo();
        else doUndo();
      } else if (key === "y") {
        event.preventDefault();
        doRedo();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [canEdit, doRedo, doUndo]);

  /**
   * Poignée de recopie : glisser depuis le petit carré du cadre, la cible suit
   * la cellule survolée (direction dominante), le relâcher écrit la série.
   */
  function startFillDrag(event: React.PointerEvent<HTMLSpanElement>, source: CellRange) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    let target = source;
    setFillPreview(source);
    const onMove = (move: PointerEvent) => {
      const element = document
        .elementFromPoint(move.clientX, move.clientY)
        ?.closest<HTMLElement>("[data-cell-row]");
      if (!element) return;
      const row = Number(element.dataset.cellRow);
      const col = Number(element.dataset.cellCol);
      target = fillTarget(source, row, col);
      setFillPreview(target);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setFillPreview(null);
      if (target !== source) applyFill(source, target);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  // Barre d'état : somme, moyenne et nombre de la plage sélectionnée.
  const statusStats = (() => {
    if (!selectionRange || isSingleCell(selectionRange)) return null;
    const numbers: number[] = [];
    let filled = 0;
    for (const [key, raw] of activeMap) {
      if (raw === "") continue;
      const { row, col } = cellOfKey(key);
      if (!inRange(selectionRange, row, col)) continue;
      filled += 1;
      const value = evaluated.get(cellKey(row, col));
      if (value?.kind === "number") numbers.push(value.value);
    }
    return selectionStats(numbers, filled);
  })();

  const freezeClass = freezeClasses(freeze);

  /** Active le filtre automatique sur la sélection (ou la région de données). */
  function toggleAutoFilter() {
    if (autoFilter) {
      void updateTabSettings(({ filter: _removed, ...rest }) => rest);
      setAnnouncement("Filtre retiré.");
      return;
    }
    const origin = selected ?? { row: 0, col: 0 };
    const range = detectFilterRange(
      selectionRange ?? rangeFrom(origin, origin),
      (row, col) => (activeMap.get(`${row}:${col}`) ?? "") !== "",
      { rows: ROWS, cols: COLS },
    );
    void updateTabSettings((current) => ({ ...current, filter: { range, columns: {} } }));
    setAnnouncement(`Filtre activé sur ${rangeLabel(range, (col) => COL_LETTERS[col] ?? "")}.`);
  }

  toggleFilterRef.current = toggleAutoFilter;

  function setFrozen(rows: number, cols: number) {
    void updateTabSettings(({ frozen: _previous, ...rest }) =>
      rows > 0 || cols > 0 ? { ...rest, frozen: { rows, cols } } : rest,
    );
    setAnnouncement(
      rows === 0 && cols === 0
        ? "Volets libérés."
        : `${rows} ligne${rows > 1 ? "s" : ""} et ${cols} colonne${cols > 1 ? "s" : ""} figée${rows + cols > 1 ? "s" : ""}.`,
    );
  }

  function insertChart(type: ChartType) {
    const origin = selected ?? { row: 0, col: 0 };
    const range =
      selectionRange && !isSingleCell(selectionRange)
        ? selectionRange
        : detectFilterRange(
            rangeFrom(origin, origin),
            (row, col) => (activeMap.get(`${row}:${col}`) ?? "") !== "",
            { rows: ROWS, cols: COLS },
          );
    const table = headerCellRef.current?.closest("table");
    // Sous les données, aligné sur leur première colonne (ne masque rien).
    const th = table?.querySelector<HTMLElement>(`th[data-col-index="${range.startCol}"]`);
    const charts = activeSettings.charts ?? [];
    const belowRow = Math.min(range.endRow + 2, ROWS);
    const chart: SheetChart = {
      id: `graphique-${Date.now().toString(36)}`,
      type,
      range,
      title: "",
      x: Math.max(0, Math.round((th?.offsetLeft ?? 44) + charts.length * 24)),
      y: Math.max(0, Math.round(headerHeight + (rowOffsets[belowRow] ?? 0) + charts.length * 24)),
      width: 480,
      height: 300,
    };
    void updateTabSettings((current) => ({
      ...current,
      charts: [...(current.charts ?? []), chart],
    }));
    setAnnouncement(`Graphique inséré (${rangeLabel(range, (col) => COL_LETTERS[col] ?? "")}).`);
  }

  const formatValueAt = (row: number, col: number) => {
    const value = evaluated.get(cellKey(row, col));
    return value ? formatValue(value) : "";
  };

  const chartReader = (row: number, col: number) => {
    const value = evaluated.get(cellKey(row, col));
    return {
      text: displayAt(row, col),
      number: value?.kind === "number" ? value.value : null,
    };
  };

  /** Une ligne de la grille (en-tête de ligne + cellules), figée ou non. */
  const renderRow = (row: number) => {
    const rowHighlighted =
      selected !== null &&
      (selectionRange
        ? row >= selectionRange.startRow && row <= selectionRange.endRow
        : row === selected.row);
    return (
      <tr key={ROW_KEYS[row]} className="contents" aria-rowindex={row + 2}>
        <th
          scope="row"
          data-row-index={row}
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            if ((event.target as HTMLElement).closest("[data-resize-handle]")) return;
            selectWhole("row", row, event.shiftKey);
          }}
          onContextMenu={(event) => {
            event.preventDefault();
            openMenu({ kind: "row", index: row }, { left: event.clientX, top: event.clientY });
          }}
          style={
            row < frozenRows ? { position: "sticky", top: frozenStyle(row, null)?.top } : undefined
          }
          className={cn(
            freezeClass.firstColumn,
            "cursor-pointer border-r border-border px-2 text-right text-[11px] font-normal leading-[23px] tabular-nums text-muted-foreground",
            rowHighlighted ? "bg-accent text-accent-foreground" : "bg-muted",
            row < ROWS - 1 && "border-b",
            row < frozenRows && "z-[12]",
            row === frozenRows - 1 && "border-b-2 border-b-muted-foreground/40",
            autoFilter &&
              filteredRows.size > 0 &&
              row > autoFilter.range.startRow &&
              row <= autoFilter.range.endRow &&
              !rowHighlighted &&
              "text-primary",
          )}
        >
          {row + 1}
          <ResizeHandle
            axis="row"
            index={row}
            label={`Redimensionner la ligne ${row + 1}`}
            current={sizeOf(rowSizes, row, "row")}
            preview={preview?.axis === "row" && preview.index === row ? preview.size : null}
            disabled={!canEdit}
            onPreview={onPreviewSize}
            onCommit={commitSize}
            onSettle={onSettlePreview}
            onReset={resetSize}
          />
        </th>
        {Array.from({ length: COLS }, (_, col) => {
          const key = cellKey(row, col);
          const raw = activeMap.get(`${row}:${col}`) ?? "";
          const value = evaluated.get(key);
          const isEditing = editing?.row === row && editing?.col === col;
          const isSelected = selected?.row === row && selected?.col === col;
          const cellStyle = activeStyles.get(`${row}:${col}`) ?? null;
          const sticky = frozenStyle(row, col);
          const filterHeader =
            autoFilter !== undefined &&
            row === autoFilter.range.startRow &&
            col >= autoFilter.range.startCol &&
            col <= autoFilter.range.endCol;
          const custom =
            value && cellStyle?.numberFormat
              ? formatCustom(
                  formatValue(value),
                  cellStyle.numberFormat,
                  value.kind === "number" ? value.value : null,
                )
              : null;
          return (
            <td
              key={isEditing ? `${key}:edition` : key}
              style={sticky}
              className={cn(
                "min-w-0 p-0",
                sticky && "bg-background",
                sticky && (row < frozenRows && col < frozenCols ? "z-[7]" : "z-[6]"),
                row === frozenRows - 1 && "border-b-2 border-b-muted-foreground/40",
                col === frozenCols - 1 && "border-r-2 border-r-muted-foreground/40",
                filterHeader && !sticky && "relative",
                isEditing ? "relative z-20 overflow-visible" : "overflow-hidden",
                !isEditing && row !== ROWS - 1 && "border-b border-border",
                !isEditing && col !== COLS - 1 && "border-r border-border",
                !isEditing && cellStyle?.background
                  ? STYLE_BACKGROUND_CLASSES[cellStyle.background]
                  : undefined,
              )}
            >
              <GridCell
                row={row}
                col={col}
                raw={raw}
                display={
                  custom
                    ? custom.text
                    : value
                      ? formatCellDisplay(formatValue(value), cellStyle?.format ?? "auto")
                      : ""
                }
                tone={toneOf(value)}
                cellStyle={
                  custom?.tone && cellStyle
                    ? {
                        ...cellStyle,
                        color: custom.tone === "negative" ? "danger" : "accent",
                      }
                    : cellStyle
                }
                selected={isSelected}
                inRange={selectionRange !== null && inRange(selectionRange, row, col)}
                canEdit={canEdit}
                editing={isEditing}
                initialDraft={isEditing ? (editing?.draft ?? null) : null}
                onPointerSelect={onPointerSelect}
                onPointerExtend={onPointerExtend}
                onEditRequest={onEditRequest}
                onCommit={commitEditing}
                onCancel={cancelEditing}
                onRequestMenu={requestCellMenu}
              />
              {filterHeader ? (
                <button
                  type="button"
                  aria-label={`Filtrer la colonne ${COL_LETTERS[col] ?? ""}`}
                  aria-haspopup="dialog"
                  aria-pressed={isColumnFiltered(autoFilter, col)}
                  title="Filtrer et trier"
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    const rect = event.currentTarget.getBoundingClientRect();
                    setFilterMenu({ col, left: rect.left, top: rect.bottom + 4 });
                  }}
                  className={cn(
                    "absolute top-0.5 right-0.5 z-[2] grid size-5 place-items-center rounded-sm border border-border bg-card text-muted-foreground hover:bg-muted",
                    isColumnFiltered(autoFilter, col) &&
                      "border-primary bg-primary text-primary-foreground hover:bg-primary",
                  )}
                >
                  <IconChevronDown className="size-3" />
                </button>
              ) : null}
            </td>
          );
        })}
      </tr>
    );
  };

  return (
    <div className="sheet-editor flex h-full min-h-0 flex-1 flex-col">
      <header className="flex flex-wrap items-center gap-2 border-b border-border bg-card px-3 py-2">
        <a
          href="/"
          className="rounded-md px-1.5 py-1 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          ← Feuilles
        </a>
        <input
          aria-label="Titre de la feuille"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          onBlur={() => void onRenameSpreadsheet()}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
          disabled={!canEdit}
          className="min-w-40 flex-1 border-none bg-transparent px-1 font-display text-base font-medium tracking-tight outline-none"
        />
        <span
          role="status"
          className={cn(
            "text-xs",
            status === "error" ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {statusLabel}
        </span>
        <div className="ml-auto flex items-center gap-2">
          {detail && !detail.canEdit ? (
            <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">
              Lecture seule
            </span>
          ) : null}
          {activeTabId ? (
            <a href={`/api/sheets/export/${fileId}?tab=${activeTabId}`}>
              <Button size="sm" variant="outline">
                Exporter CSV
              </Button>
            </a>
          ) : null}
          {detail?.canEdit && activeTabId ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setImportText("");
                setImportOpen(true);
              }}
            >
              Importer CSV
            </Button>
          ) : null}
        </div>
      </header>

      {error ? (
        <div className="px-3 pt-3">
          <p
            role="alert"
            className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive"
          >
            {error}
          </p>
        </div>
      ) : null}

      {detail ? (
        <>
          {/* Barre d'outils unique : historique, figement, mise en forme
              contextuelle — une rangée compacte, défilante si nécessaire. */}
          <div
            role="toolbar"
            aria-label="Outils de la feuille"
            className="flex flex-nowrap items-center gap-0.5 border-b border-border bg-card px-2 py-1"
          >
            <div className="flex min-w-0 flex-1 flex-nowrap items-center gap-0.5 overflow-x-auto [&>*]:shrink-0">
              <Button
                size="sm"
                variant="ghost"
                aria-label="Annuler"
                title="Annuler (Ctrl+Z)"
                disabled={!canEdit || !canUndo}
                onClick={doUndo}
              >
                <IconUndo />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                aria-label="Rétablir"
                title="Rétablir (Ctrl+Maj+Z)"
                disabled={!canEdit || !canRedo}
                onClick={doRedo}
              >
                <IconRedo />
              </Button>
              <span aria-hidden className="mx-1 h-4 w-px shrink-0 bg-border" />

              {/* Repères figés : préférence d'affichage, toujours à portée. */}
              <Button
                size="sm"
                variant={freeze.header ? "secondary" : "ghost"}
                aria-pressed={freeze.header}
                title={freezeHint(freeze)}
                onClick={() => changeFreeze("header")}
              >
                {freezeButtonLabel("header")}
              </Button>
              <Button
                size="sm"
                variant={freeze.firstColumn ? "secondary" : "ghost"}
                aria-pressed={freeze.firstColumn}
                title={freezeHint(freeze)}
                onClick={() => changeFreeze("firstColumn")}
              >
                {freezeButtonLabel("firstColumn")}
              </Button>
              <span aria-hidden className="mx-1 h-4 w-px shrink-0 bg-border" />

              {/* Mise en forme contextuelle : elle suit la cellule active. */}
              {!canEdit ? (
                <span className="px-1 text-xs text-muted-foreground">
                  Feuille en lecture seule.
                </span>
              ) : selected ? (
                <>
                  <span className="px-1 text-xs font-medium tabular-nums text-muted-foreground">
                    {selectionRange && !isSingleCell(selectionRange)
                      ? rangeLabel(selectionRange, (col) => COL_LETTERS[col] ?? "")
                      : cellKey(selected.row, selected.col)}
                  </span>
                  <Button
                    size="sm"
                    variant={selectedStyle?.bold ? "secondary" : "ghost"}
                    aria-pressed={selectedStyle?.bold === true}
                    aria-label="Gras"
                    title="Gras"
                    disabled={styleBusy}
                    onClick={() => toggleFlag("bold")}
                  >
                    <strong>B</strong>
                  </Button>
                  <Button
                    size="sm"
                    variant={selectedStyle?.italic ? "secondary" : "ghost"}
                    aria-pressed={selectedStyle?.italic === true}
                    aria-label="Italique"
                    title="Italique"
                    disabled={styleBusy}
                    onClick={() => toggleFlag("italic")}
                  >
                    <em>I</em>
                  </Button>
                  <Button
                    size="sm"
                    variant={selectedStyle?.underline ? "secondary" : "ghost"}
                    aria-pressed={selectedStyle?.underline === true}
                    aria-label="Souligné"
                    title="Souligné"
                    disabled={styleBusy}
                    onClick={() => toggleFlag("underline")}
                  >
                    <span className="underline">U</span>
                  </Button>
                  <Button
                    size="sm"
                    variant={selectedStyle?.strike ? "secondary" : "ghost"}
                    aria-pressed={selectedStyle?.strike === true}
                    aria-label="Barré"
                    title="Barré"
                    disabled={styleBusy}
                    onClick={() => toggleFlag("strike")}
                  >
                    <span className="line-through">S</span>
                  </Button>
                  <span aria-hidden className="mx-1 h-4 w-px shrink-0 bg-border" />
                  <Button
                    size="sm"
                    variant={selectedStyle?.align === "left" ? "secondary" : "ghost"}
                    aria-pressed={selectedStyle?.align === "left"}
                    aria-label="Aligner à gauche"
                    title="Aligner à gauche"
                    disabled={styleBusy}
                    onClick={() => toggleAlign("left")}
                  >
                    Gauche
                  </Button>
                  <Button
                    size="sm"
                    variant={selectedStyle?.align === "center" ? "secondary" : "ghost"}
                    aria-pressed={selectedStyle?.align === "center"}
                    aria-label="Centrer"
                    title="Centrer"
                    disabled={styleBusy}
                    onClick={() => toggleAlign("center")}
                  >
                    Centre
                  </Button>
                  <Button
                    size="sm"
                    variant={selectedStyle?.align === "right" ? "secondary" : "ghost"}
                    aria-pressed={selectedStyle?.align === "right"}
                    aria-label="Aligner à droite"
                    title="Aligner à droite"
                    disabled={styleBusy}
                    onClick={() => toggleAlign("right")}
                  >
                    Droite
                  </Button>
                  <span aria-hidden className="mx-1 h-4 w-px shrink-0 bg-border" />
                  {CELL_STYLE_BACKGROUNDS.map((background) => (
                    <button
                      key={background}
                      type="button"
                      aria-label={`Fond ${STYLE_SWATCH_LABELS[background]}`}
                      aria-pressed={selectedStyle?.background === background}
                      title={`Fond ${STYLE_SWATCH_LABELS[background]}`}
                      disabled={styleBusy}
                      onClick={() => toggleBackground(background)}
                      className={cn(
                        "size-5 rounded-sm border border-border disabled:opacity-50",
                        STYLE_SWATCH_CLASSES[background],
                        selectedStyle?.background === background && "ring-2 ring-ring",
                      )}
                    />
                  ))}
                  <span aria-hidden className="mx-1 h-4 w-px shrink-0 bg-border" />
                  {/* Couleur de texte : la pastille « A » remet le défaut (jeton absent). */}
                  <button
                    type="button"
                    aria-label="Couleur par défaut"
                    aria-pressed={selectedStyle?.color === undefined}
                    title="Couleur par défaut"
                    disabled={styleBusy}
                    onClick={() =>
                      void applyCellStyle((current) => withoutKey(current ?? {}, "color"))
                    }
                    className={cn(
                      "size-5 rounded-sm border border-border text-[10px] font-bold leading-none disabled:opacity-50",
                      selectedStyle?.color === undefined && "ring-2 ring-ring",
                    )}
                  >
                    A
                  </button>
                  {CELL_TEXT_COLORS.map((color) => (
                    <button
                      key={color}
                      type="button"
                      aria-label={`Couleur ${STYLE_TEXT_LABELS[color]}`}
                      aria-pressed={selectedStyle?.color === color}
                      title={`Couleur ${STYLE_TEXT_LABELS[color]}`}
                      disabled={styleBusy}
                      onClick={() => toggleColor(color)}
                      className={cn(
                        "size-5 rounded-sm border border-border disabled:opacity-50",
                        STYLE_TEXT_SWATCH_CLASSES[color],
                        selectedStyle?.color === color && "ring-2 ring-ring",
                      )}
                    />
                  ))}
                  <span aria-hidden className="mx-1 h-4 w-px shrink-0 bg-border" />
                  {/* Formats d'affichage : le nombre stocké ne change jamais. */}
                  {CELL_FORMATS.map((format) => (
                    <Button
                      key={format.id}
                      size="sm"
                      variant={
                        (selectedStyle?.format ?? "auto") === format.id ? "secondary" : "ghost"
                      }
                      aria-pressed={(selectedStyle?.format ?? "auto") === format.id}
                      aria-label={format.label}
                      title={format.label}
                      disabled={styleBusy}
                      onClick={() => toggleFormat(format.id)}
                    >
                      <span className="tabular-nums">{format.glyph}</span>
                    </Button>
                  ))}
                </>
              ) : (
                <span className="px-1 text-xs text-muted-foreground">
                  Sélectionnez une cellule pour la mettre en forme.
                </span>
              )}
            </div>

            {/* Données : filtre, volets figés, graphiques, format personnalisé. */}
            {canEdit ? (
              <Menu
                label="Données"
                align="end"
                triggerClassName="h-8 shrink-0 border-transparent bg-transparent px-2 text-sm hover:bg-muted focus-visible:ring-offset-0"
                items={[
                  {
                    id: "filtre",
                    label: autoFilter ? "Retirer le filtre" : "Filtrer",
                    shortcut: "Ctrl+Maj+L",
                    onSelect: toggleAutoFilter,
                  },
                  {
                    id: "figer-ligne",
                    label: "Figer la première ligne",
                    separated: true,
                    onSelect: () => setFrozen(1, 0),
                  },
                  {
                    id: "figer-colonne",
                    label: "Figer la première colonne",
                    onSelect: () => setFrozen(0, 1),
                  },
                  {
                    id: "figer-selection",
                    label: selected
                      ? `Figer les volets (au-dessus et à gauche de ${cellKey(selected.row, selected.col)})`
                      : "Figer les volets",
                    disabled: !selected || (selected.row === 0 && selected.col === 0),
                    onSelect: () => {
                      if (selected)
                        setFrozen(Math.min(selected.row, 50), Math.min(selected.col, 50));
                    },
                  },
                  {
                    id: "liberer",
                    label: "Libérer les volets",
                    disabled: frozenRows === 0 && frozenCols === 0,
                    onSelect: () => setFrozen(0, 0),
                  },
                  {
                    id: "graphique-colonnes",
                    label: "Insérer un histogramme",
                    separated: true,
                    onSelect: () => insertChart("column"),
                  },
                  {
                    id: "graphique-barres",
                    label: "Insérer un graphique en barres",
                    onSelect: () => insertChart("bar"),
                  },
                  {
                    id: "graphique-courbes",
                    label: "Insérer un graphique en courbes",
                    onSelect: () => insertChart("line"),
                  },
                  {
                    id: "graphique-secteurs",
                    label: "Insérer un graphique en secteurs",
                    onSelect: () => insertChart("pie"),
                  },
                  {
                    id: "format-personnalise",
                    label: "Format personnalisé…",
                    separated: true,
                    disabled: !selected,
                    onSelect: () => setFormatDialogOpen(true),
                  },
                ]}
              />
            ) : null}

            {/* Actions rares de la sélection : structure et format, au menu. */}
            {canEdit && selected ? (
              <Menu
                label="Autres actions"
                align="end"
                triggerIcon={<IconMore />}
                triggerClassName="h-8 w-8 shrink-0 border-transparent bg-transparent px-0 hover:bg-muted focus-visible:ring-offset-0"
                items={[
                  {
                    id: "inserer-ligne-dessus",
                    label: "Insérer une ligne au-dessus",
                    disabled: structureBusy,
                    onSelect: () => void runStructure("row", "insert", selected.row),
                  },
                  {
                    id: "inserer-ligne-dessous",
                    label: "Insérer une ligne en dessous",
                    disabled: structureBusy,
                    onSelect: () => void runStructure("row", "insert", selected.row + 1),
                  },
                  {
                    id: "inserer-colonne-gauche",
                    label: "Insérer une colonne à gauche",
                    separated: true,
                    disabled: structureBusy,
                    onSelect: () => void runStructure("col", "insert", selected.col),
                  },
                  {
                    id: "inserer-colonne-droite",
                    label: "Insérer une colonne à droite",
                    disabled: structureBusy,
                    onSelect: () => void runStructure("col", "insert", selected.col + 1),
                  },
                  {
                    id: "supprimer-ligne",
                    label: "Supprimer la ligne",
                    separated: true,
                    destructive: true,
                    disabled: structureBusy,
                    onSelect: () => void runStructure("row", "delete", selected.row),
                  },
                  {
                    id: "supprimer-colonne",
                    label: "Supprimer la colonne",
                    destructive: true,
                    disabled: structureBusy,
                    onSelect: () => void runStructure("col", "delete", selected.col),
                  },
                  ...(selectionRange && !isSingleCell(selectionRange)
                    ? [
                        {
                          id: "trier-croissant",
                          label: `Trier ${rangeLabel(selectionRange, (col) => COL_LETTERS[col] ?? "")} (croissant)`,
                          separated: true,
                          disabled: structureBusy,
                          onSelect: () => runSort("asc"),
                        },
                        {
                          id: "trier-decroissant",
                          label: `Trier ${rangeLabel(selectionRange, (col) => COL_LETTERS[col] ?? "")} (décroissant)`,
                          disabled: structureBusy,
                          onSelect: () => runSort("desc"),
                        },
                      ]
                    : []),
                  {
                    id: "effacer-format",
                    label: "Effacer le format",
                    separated: true,
                    disabled: styleBusy || !selectedStyle,
                    onSelect: () => void applyCellStyle(() => null),
                  },
                ]}
              />
            ) : null}
          </div>

          <FormulaBar
            reference={selected ? cellKey(selected.row, selected.col) : ""}
            value={selectedKey ? (activeMap.get(selectedKey) ?? "") : ""}
            result={barResult}
            tone={toneOf(selectedKey ? evaluated.get(selectedKey) : undefined)}
            disabled={!canEdit}
            onSubmit={submitBarValue}
            onGoTo={goToReference}
            onDraftChange={(value) =>
              setBarDraft(value === null || !selectedKey ? null : { key: selectedKey, value })
            }
          />

          {/* La grille remplit la hauteur restante ; elle seule défile. */}
          <div ref={scrollRef} className="relative min-h-0 flex-1 overflow-auto">
            {/*
              Tableau natif (en-têtes de colonne et de ligne, cellules) disposé
              en grille CSS : `display: contents` sur les enveloppes fait des
              cellules les éléments de la grille, donc la mise en page reste
              celle d'une grille et la sémantique celle d'un tableau. Seules
              les lignes visibles sont rendues (deux espaceurs encadrent la
              fenêtre) ; le cadre de sélection et la poignée de recopie sont
              posés en absolu sur les lignes de la grille.
            */}
            <table
              // biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: rôle « grid » du motif ARIA, posé sur le tableau natif pour que les lecteurs d'écran annoncent une grille navigable.
              role="grid"
              aria-label="Grille de la feuille"
              aria-rowcount={ROWS + 1}
              aria-colcount={COLS + 1}
              aria-readonly={!canEdit}
              aria-multiselectable
              className="relative grid select-none"
              onKeyDown={onGridKeyDown}
              style={
                {
                  "--sheet-gutter": "44px",
                  "--sheet-col-min": "96px",
                  gridTemplateColumns: `var(--sheet-gutter) ${columnTracks}`,
                  gridTemplateRows: `auto ${rowTracks.frozen} ${topSpacer}px ${rowTracks.window} ${bottomSpacer}px`,
                  width: "max-content",
                  minWidth: "100%",
                } as CSSProperties
              }
            >
              <caption className="sr-only">
                Grille de la feuille — flèches pour parcourir les cellules, saisie directe pour
                remplacer le contenu, Entrée ou F2 pour modifier, Maj + flèche ou glisser pour
                étendre la sélection, Suppr pour effacer, Ctrl+C, Ctrl+X et Ctrl+V pour copier,
                couper et coller, Ctrl+D pour recopier vers le bas, touche Menu pour les actions.
              </caption>
              <thead className="contents">
                <tr className="contents" aria-rowindex={1}>
                  <td
                    ref={headerCellRef}
                    className={cn(
                      freezeClass.corner,
                      "border-b border-r border-border bg-muted p-0",
                    )}
                  >
                    <button
                      type="button"
                      aria-label="Tout sélectionner"
                      tabIndex={-1}
                      onClick={() => {
                        setEditing(null);
                        setSelected({ row: 0, col: 0 });
                        setRangeAnchor({ row: ROWS - 1, col: COLS - 1 });
                      }}
                      className="block size-full"
                    />
                  </td>
                  {COL_LETTERS.map((letter, col) => {
                    const highlighted =
                      selected !== null &&
                      (selectionRange
                        ? col >= selectionRange.startCol && col <= selectionRange.endCol
                        : col === selected.col);
                    return (
                      <th
                        key={letter}
                        scope="col"
                        data-col-index={col}
                        onPointerDown={(event) => {
                          if (event.button !== 0) return;
                          if ((event.target as HTMLElement).closest("[data-resize-handle]")) return;
                          selectWhole("col", col, event.shiftKey);
                        }}
                        onContextMenu={(event) => {
                          event.preventDefault();
                          openMenu(
                            { kind: "col", index: col },
                            { left: event.clientX, top: event.clientY },
                          );
                        }}
                        style={
                          col < frozenCols
                            ? { position: "sticky", left: frozenStyle(null, col)?.left }
                            : undefined
                        }
                        className={cn(
                          freezeClass.header,
                          col < frozenCols && "z-[12]",
                          col === frozenCols - 1 && "border-r-2 border-r-muted-foreground/40",
                          "cursor-pointer border-b border-border px-2 py-1 text-center text-[11px] font-medium text-muted-foreground",
                          highlighted ? "bg-accent text-accent-foreground" : "bg-muted",
                          col < COLS - 1 && "border-r",
                        )}
                      >
                        {letter}
                        <ResizeHandle
                          axis="col"
                          index={col}
                          label={`Redimensionner la colonne ${letter}`}
                          current={sizeOf(colSizes, col, "col")}
                          preview={
                            preview?.axis === "col" && preview.index === col ? preview.size : null
                          }
                          disabled={!canEdit}
                          onPreview={onPreviewSize}
                          onCommit={commitSize}
                          onSettle={onSettlePreview}
                          onReset={resetSize}
                        />
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody className="contents">
                {renderPlan.frozen.map((row) => renderRow(row))}
                <tr aria-hidden className="contents">
                  <td className="p-0" style={{ gridColumn: "1 / -1", height: topSpacer }} />
                </tr>
                {renderPlan.windowRows.map((row) => renderRow(row))}
                <tr aria-hidden className="contents">
                  <td className="p-0" style={{ gridColumn: "1 / -1", height: bottomSpacer }} />
                </tr>
                {/* Cadre de la sélection et poignée de recopie (hors flux). */}
                {selected && !editing
                  ? (() => {
                      const range = fillPreview ?? selectionRange ?? rangeFrom(selected, selected);
                      // Premières et dernières lignes rendues dans la plage
                      // (lignes figées, fenêtre visible, lignes filtrées exclues).
                      let topLine: number | null = null;
                      let bottomLine: number | null = null;
                      for (const [row, line] of renderPlan.lineOf) {
                        if (row < range.startRow || row > range.endRow) continue;
                        if (topLine === null || line < topLine) topLine = line;
                        if (bottomLine === null || line > bottomLine) bottomLine = line;
                      }
                      if (topLine === null || bottomLine === null) return null;
                      return (
                        <tr aria-hidden className="contents">
                          <td
                            className={cn(
                              "pointer-events-none absolute inset-0 z-10 p-0",
                              fillPreview
                                ? "border-2 border-dashed border-primary"
                                : "border-2 border-primary",
                            )}
                            style={{
                              gridRow: `${topLine} / ${bottomLine + 1}`,
                              gridColumn: `${2 + range.startCol} / ${3 + range.endCol}`,
                            }}
                          >
                            {canEdit && !fillPreview && range.endRow <= lastRow ? (
                              <span
                                data-fill-handle
                                title="Recopier (glisser)"
                                onPointerDown={(event) => startFillDrag(event, range)}
                                className="pointer-events-auto absolute -right-1 -bottom-1 size-2 cursor-crosshair border border-card bg-primary"
                              />
                            ) : null}
                          </td>
                        </tr>
                      );
                    })()
                  : null}
              </tbody>
            </table>
            {(activeSettings.charts ?? []).map((chart) => (
              <ChartFrame
                key={chart.id}
                chart={chart}
                data={extractChartData(chart.range, chartReader)}
                canEdit={canEdit}
                onChange={(next) =>
                  void updateTabSettings((current) => ({
                    ...current,
                    charts: (current.charts ?? []).map((entry) =>
                      entry.id === next.id ? next : entry,
                    ),
                  }))
                }
                onDelete={() =>
                  void updateTabSettings((current) => {
                    const charts = (current.charts ?? []).filter((entry) => entry.id !== chart.id);
                    const { charts: _old, ...rest } = current;
                    return charts.length > 0 ? { ...rest, charts } : rest;
                  })
                }
              />
            ))}
          </div>

          {/* Onglets de la feuille : bande basse ; les actions rares (renommer,
              supprimer) vivent dans son menu, jamais en pavés de boutons. */}
          <div className="flex flex-nowrap items-center gap-1 border-t border-border bg-card px-2 py-1">
            <div className="flex min-w-0 flex-1 flex-nowrap items-center gap-1 overflow-x-auto py-0.5">
              {detail.tabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => {
                    void flush(activeTabId);
                    setActiveTabId(tab.id);
                    setEditing(null);
                    setSelected(null);
                    setRangeAnchor(null);
                  }}
                  className={cn(
                    "shrink-0 rounded-md border px-3 py-1 text-xs font-medium transition-colors",
                    tab.id === activeTabId
                      ? "border-primary bg-accent text-accent-foreground"
                      : "border-border bg-card text-muted-foreground hover:bg-muted",
                  )}
                >
                  {tab.name}
                </button>
              ))}
            </div>
            {autoFilter ? (
              <p className="shrink-0 px-2 text-xs tabular-nums text-muted-foreground">
                {filterSummary(autoFilter, filteredRows)}
              </p>
            ) : null}
            {statusStats ? (
              <p
                aria-live="polite"
                className="shrink-0 px-2 text-xs tabular-nums text-muted-foreground"
              >
                {statusStats.numeric > 0
                  ? `Somme : ${formatValue({ kind: "number", value: statusStats.sum })} · Moyenne : ${
                      statusStats.average === null
                        ? "—"
                        : formatValue({ kind: "number", value: statusStats.average })
                    } · `
                  : ""}
                Nombre : {statusStats.count}
              </p>
            ) : null}
            {canEdit ? (
              <Button
                size="sm"
                variant="ghost"
                className="shrink-0"
                onClick={() => {
                  setTabName("");
                  setTabDialog("add");
                }}
              >
                <IconPlus />
                Onglet
              </Button>
            ) : null}
            {canEdit && activeTab ? (
              <Menu
                label="Actions de l'onglet"
                align="end"
                // Le panneau s'ouvre vers le haut : la bande d'onglets est en
                // bas de fenêtre, un menu vers le bas serait hors écran.
                className="[&>[role=menu]]:top-auto [&>[role=menu]]:bottom-full [&>[role=menu]]:mt-0 [&>[role=menu]]:mb-1"
                triggerIcon={<IconMore />}
                triggerClassName="h-8 w-8 shrink-0 border-transparent bg-transparent px-0 hover:bg-muted focus-visible:ring-offset-0"
                items={[
                  {
                    id: "renommer-onglet",
                    label: "Renommer l'onglet",
                    onSelect: () => {
                      setTabName(activeTab.name);
                      setTabDialog("rename");
                    },
                  },
                  {
                    id: "supprimer-onglet",
                    label: "Supprimer l'onglet",
                    separated: true,
                    destructive: true,
                    disabled: detail.tabs.length <= 1,
                    onSelect: () => void onDeleteTab(activeTab.id),
                  },
                ]}
              />
            ) : null}
          </div>

          {autoFilter && filterMenu ? (
            <FilterPopover
              column={COL_LETTERS[filterMenu.col] ?? ""}
              anchor={{ left: filterMenu.left, top: filterMenu.top }}
              values={distinctValues(autoFilter, filterMenu.col, displayAt)}
              current={autoFilter.columns[String(filterMenu.col)]}
              onClose={() => setFilterMenu(null)}
              onSort={(direction) => {
                sortBy(
                  {
                    startRow: autoFilter.range.startRow + 1,
                    endRow: autoFilter.range.endRow,
                    startCol: autoFilter.range.startCol,
                    endCol: autoFilter.range.endCol,
                  },
                  filterMenu.col,
                  direction,
                );
                setFilterMenu(null);
              }}
              onApply={(criteria: ColumnFilter | null) => {
                const col = filterMenu.col;
                void updateTabSettings((current) =>
                  current.filter
                    ? { ...current, filter: withColumnFilter(current.filter, col, criteria) }
                    : current,
                );
                setFilterMenu(null);
              }}
            />
          ) : null}
          <CustomFormatDialog
            open={formatDialogOpen}
            initial={selectedStyle?.numberFormat ?? ""}
            sample={selected ? formatValueAt(selected.row, selected.col) : ""}
            onClose={() => setFormatDialogOpen(false)}
            onApply={(pattern) => {
              setFormatDialogOpen(false);
              void applyCellStyle((current) => {
                const base = withoutKey(withoutKey(current ?? {}, "numberFormat") ?? {}, "format");
                return pattern ? { ...(base ?? {}), numberFormat: pattern } : base;
              });
            }}
          />

          <SheetContextMenu
            open={menu !== null}
            x={menu?.x ?? 0}
            y={menu?.y ?? 0}
            label={menuLabel}
            items={menuItems}
            onClose={closeMenu}
            footer={
              canEdit
                ? "Clic droit ou touche Menu sur une cellule pour ces actions."
                : "Cette feuille est en lecture seule."
            }
          />
          <p aria-live="polite" className="sr-only">
            {announcement}
          </p>
        </>
      ) : !error ? (
        <LoadingState className="py-12" label="Chargement de la feuille…" />
      ) : null}

      <Dialog open={importOpen} onClose={() => setImportOpen(false)} title="Importer un CSV">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="csv-file">Fichier CSV</Label>
            <input
              ref={fileInputRef}
              id="csv-file"
              type="file"
              aria-label="Fichier CSV"
              accept=".csv,text/csv"
              onChange={onImportFile}
              className="text-sm text-muted-foreground file:mr-2 file:rounded-md file:border file:border-input file:bg-background file:px-3 file:py-1.5 file:text-sm file:text-foreground"
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="csv-text">Contenu CSV</Label>
            <textarea
              id="csv-text"
              aria-label="Contenu CSV"
              value={importText}
              onChange={(event) => setImportText(event.target.value)}
              rows={8}
              spellCheck={false}
              placeholder={"Nom,Quantité\nPommes,3"}
              className="w-full resize-y rounded-md border border-input bg-background px-3 py-2 font-mono text-xs text-foreground shadow-soft transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
            />
          </div>
          <p className="text-xs text-muted-foreground">L'onglet actuel sera remplacé.</p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setImportOpen(false)}>
              Annuler
            </Button>
            <Button
              type="button"
              loading={importBusy}
              disabled={importText.length === 0}
              onClick={() => void onImportCsv()}
            >
              Importer
            </Button>
          </div>
        </div>
      </Dialog>

      <Dialog
        open={tabDialog !== null}
        onClose={() => setTabDialog(null)}
        title={tabDialog === "add" ? "Nouvel onglet" : "Renommer l'onglet"}
      >
        <form onSubmit={onSubmitTab} method="post" className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="tab-name">Nom de l'onglet</Label>
            <Input
              id="tab-name"
              value={tabName}
              onChange={(event) => setTabName(event.target.value)}
              placeholder="Dépenses"
              maxLength={120}
              autoFocus
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setTabDialog(null)}>
              Annuler
            </Button>
            <Button type="submit" loading={busy} disabled={tabName.trim().length === 0}>
              {tabDialog === "add" ? "Ajouter" : "Renommer"}
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
