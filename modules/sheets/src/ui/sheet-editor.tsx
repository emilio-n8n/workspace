import { Button, cn, Dialog, Input, Label } from "@workspace/ui";
import {
  type ChangeEvent,
  type CSSProperties,
  type FormEvent,
  memo,
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { MAX_CELL_CHARS } from "../csv.ts";
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
import { cellKey, evaluateCells, formatValue, parseKey } from "../formula.ts";
import {
  CELL_STYLE_BACKGROUNDS,
  type CellStyle,
  type CellStyleAlign,
  type CellStyleBackground,
} from "../schema.ts";
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
} from "../server.ts";
import {
  type StructureKind,
  type StructureMode,
  selectionAfter,
  structureMessage,
} from "../structure.ts";
import { toneOf } from "./cell-tone.ts";
import { FormulaBar } from "./formula-bar.tsx";
import { ResizeHandle } from "./resize-handle.tsx";
import { SheetContextMenu, type SheetMenuItem } from "./sheet-context-menu.tsx";

const COLS = 20;
const ROWS = 100;
const COL_LETTERS = Array.from({ length: COLS }, (_, index) =>
  cellKey(0, index).replace(/\d+$/, ""),
);
/** Clés stables des lignes (évite l'index de tableau comme clé React). */
const ROW_KEYS = Array.from({ length: ROWS }, (_, index) => `ligne-${index + 1}`);
const SAVE_DEBOUNCE_MS = 700;
const SAVE_RETRY_MS = 3_000;
/** Les tailles de grille sont enregistrées sans attendre (glisser ponctuel). */
const SIZE_SAVE_DEBOUNCE_MS = 400;

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

type SaveStatus = "idle" | "saving" | "saved" | "error";
type MoveDirection = "down" | "right" | "none";
type CellTone = "number" | "error" | "text";

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
function withoutKey(style: CellStyle, key: "align" | "background"): CellStyle | null {
  const next = { ...style };
  delete next[key];
  return Object.keys(next).length > 0 ? next : null;
}

/** Jeu de cartes vide, partagé tant qu'aucune taille n'est choisie. */
const EMPTY_SIZES: SheetSizes = { col: new Map(), row: new Map() };

type GridCellProps = {
  row: number;
  col: number;
  raw: string;
  display: string;
  tone: CellTone;
  cellStyle: CellStyle | null;
  selected: boolean;
  canEdit: boolean;
  editing: boolean;
  onStart: (row: number, col: number) => void;
  onCommit: (row: number, col: number, value: string, move: MoveDirection) => void;
  onCancel: () => void;
  /** Clic droit ou touche Menu : ouvre le menu contextuel de la cellule. */
  onRequestMenu: (row: number, col: number, anchor: DOMRect) => void;
};

/**
 * Cellule mémoïsée : le brouillon d'édition reste local, donc la frappe ne
 * re-rend que cette cellule (pas les 2 000 de la grille). L'édition est validée
 * au blur ou à Entrée (descente), Tab (droite) et annulée avec Échap.
 * La mise en forme (v1) rend gras/italique/alignement/fond de jeton.
 */
const GridCell = memo(function GridCell({
  row,
  col,
  raw,
  display,
  tone,
  cellStyle,
  selected,
  canEdit,
  editing,
  onStart,
  onCommit,
  onCancel,
  onRequestMenu,
}: GridCellProps) {
  const [draft, setDraft] = useState(raw);
  const skipBlurRef = useRef(false);

  if (editing) {
    return (
      <input
        // biome-ignore lint/a11y/noAutofocus: édition de cellule demandée explicitement
        autoFocus
        aria-label={`Cellule ${cellKey(row, col)}`}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          if (skipBlurRef.current) return;
          onCommit(row, col, draft, "none");
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            skipBlurRef.current = true;
            onCommit(row, col, draft, "down");
          } else if (event.key === "Tab") {
            event.preventDefault();
            skipBlurRef.current = true;
            onCommit(row, col, draft, "right");
          } else if (event.key === "Escape") {
            event.preventDefault();
            skipBlurRef.current = true;
            onCancel();
          }
        }}
        className="block w-full bg-background px-2 py-1 text-sm outline-2 outline-ring"
      />
    );
  }

  return (
    <button
      type="button"
      aria-label={`Cellule ${cellKey(row, col)}`}
      // La cellule active est signalée sans dépendre d'un rôle ARIA de grille.
      aria-current={selected ? "true" : undefined}
      onClick={() => onStart(row, col)}
      onContextMenu={(event) => {
        // Le menu contextuel est le seul propriétaire du clic droit : on ouvre
        // à la position du pointeur plutôt que d'afficher le menu natif.
        event.preventDefault();
        onRequestMenu(row, col, event.currentTarget.getBoundingClientRect());
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
        textAlign: cellStyle?.align,
      }}
      className={cn(
        "block w-full truncate px-2 py-1 text-sm",
        tone === "number" ? "text-right tabular-nums" : "text-left",
        cellStyle?.background ? STYLE_BACKGROUND_CLASSES[cellStyle.background] : undefined,
        canEdit ? "cursor-cell hover:bg-muted/60" : "cursor-default",
        tone === "error" && "text-destructive",
      )}
    >
      {display}
    </button>
  );
});

/**
 * Éditeur de feuille : grille creuse, formules calculées à l'affichage
 * (SUM/AVG/MIN/MAX/COUNT), autosave par lots et onglets.
 */
export function SheetEditor({ fileId }: { fileId: string }) {
  const [detail, setDetail] = useState<SpreadsheetDetail | null>(null);
  const [title, setTitle] = useState("");
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [cellsByTab, setCellsByTab] = useState<Map<string, Map<string, string>>>(new Map());
  const [editing, setEditing] = useState<{ row: number; col: number } | null>(null);
  const [selected, setSelected] = useState<{ row: number; col: number } | null>(null);
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
  const [structureBusy, setStructureBusy] = useState(false);
  const gridRef = useRef<HTMLDivElement>(null);

  // Valeurs dérivées du chargement : déclarées avant les rappels qui s'en
  // servent, pour qu'aucune action ne lise une valeur encore indéfinie.
  const activeTab = detail?.tabs.find((tab) => tab.id === activeTabId) ?? null;
  const canEdit = detail?.canEdit ?? false;
  const selectedKey = selected ? `${selected.row}:${selected.col}` : null;
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
  }, [detail]);

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

  const evaluated = useMemo(() => {
    const raw: Record<string, string> = {};
    for (const [key, value] of activeMap) {
      const [row, col] = key.split(":").map(Number);
      raw[cellKey(row ?? 0, col ?? 0)] = value;
    }
    return evaluateCells(raw);
  }, [activeMap]);

  /** Style de la cellule active (v1 : la grille ne met en forme qu'une cellule). */
  const selectedStyle = selectedKey ? (activeStyles.get(selectedKey) ?? null) : null;

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
      setCellsByTab((current) => {
        const next = new Map(current);
        const map = new Map(next.get(tabId) ?? []);
        const key = `${row}:${col}`;
        if (value === "") map.delete(key);
        else map.set(key, value);
        next.set(tabId, map);
        return next;
      });
      setStatus("idle");
      queueSave(tabId, { row, col, value });
    },
    [queueSave],
  );

  const startEditing = useCallback((row: number, col: number) => {
    if (!canEditRef.current) return;
    setSelected({ row, col });
    setEditing({ row, col });
  }, []);

  const cancelEditing = useCallback(() => setEditing(null), []);

  const commitEditing = useCallback(
    (row: number, col: number, value: string, move: MoveDirection) => {
      commitCell(row, col, value);
      if (move === "none") {
        setEditing(null);
        setSelected({ row, col });
        return;
      }
      const nextRow = move === "down" ? Math.min(row + 1, ROWS - 1) : row;
      const nextCol = move === "right" ? Math.min(col + 1, COLS - 1) : col;
      setEditing({ row: nextRow, col: nextCol });
      setSelected({ row: nextRow, col: nextCol });
    },
    [commitCell],
  );

  /** Met à jour localement le style d'une cellule (même carte que la lecture). */
  const setCellStyleLocally = useCallback((tabId: string, key: string, style: CellStyle | null) => {
    setStylesByTab((current) => {
      const next = new Map(current);
      const map = new Map(next.get(tabId) ?? []);
      if (style === null) map.delete(key);
      else map.set(key, style);
      next.set(tabId, map);
      return next;
    });
  }, []);

  /**
   * Applique une mutation au style de la cellule sélectionnée (v1 : une seule
   * cellule), en optimiste : la grille est mise à jour tout de suite puis
   * rejouée à l'identique côté serveur ; en cas d'échec, l'ancien style est
   * restauré.
   */
  const applyCellStyle = useCallback(
    async (mutate: (current: CellStyle | null) => CellStyle | null) => {
      const tabId = activeTabId;
      const target = selected;
      if (!tabId || !target || !canEdit || styleBusy) return;
      const key = `${target.row}:${target.col}`;
      const previous = stylesByTab.get(tabId)?.get(key) ?? null;
      const next = mutate(previous);
      setStyleBusy(true);
      setError(null);
      setCellStyleLocally(tabId, key, next);
      try {
        await setCellStyleFn({
          data: { fileId, tabId, cells: [{ row: target.row, col: target.col }], style: next },
        });
      } catch (caught) {
        setCellStyleLocally(tabId, key, previous);
        setError(caught instanceof Error ? caught.message : "Mise en forme impossible.");
      } finally {
        setStyleBusy(false);
      }
    },
    [activeTabId, canEdit, fileId, selected, setCellStyleLocally, styleBusy, stylesByTab],
  );

  const toggleFlag = useCallback(
    (flag: "bold" | "italic") => {
      void applyCellStyle((current) => {
        const next = { ...(current ?? {}) };
        if (next[flag]) delete next[flag];
        else next[flag] = true;
        return Object.keys(next).length > 0 ? next : null;
      });
    },
    [applyCellStyle],
  );

  const toggleAlign = useCallback(
    (align: CellStyleAlign) => {
      void applyCellStyle((current) =>
        current?.align === align ? withoutKey(current, "align") : { ...(current ?? {}), align },
      );
    },
    [applyCellStyle],
  );

  function toggleBackground(background: CellStyleBackground): void {
    void applyCellStyle((current) =>
      current?.background === background
        ? withoutKey(current, "background")
        : { ...(current ?? {}), background },
    );
  }

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
      setSelected({ row: target.row, col: target.col });
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
    (row: number, col: number, anchor: DOMRect) => {
      openMenu({ kind: "cell", row, col }, { left: anchor.left, top: anchor.bottom });
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

  const rowTracks = useMemo(
    () =>
      Array.from({ length: ROWS }, (_, row) => {
        const size = rowSizes.get(row);
        return size === undefined ? "auto" : `${size}px`;
      }).join(" "),
    [rowSizes],
  );

  const currentBarDraft = barDraft?.key === selectedKey ? barDraft.value : null;

  /** Valeur affichée par la barre de formule, aperçu de formule compris. */
  const barResult = useMemo(() => {
    if (!selectedKey) return null;
    if (currentBarDraft === null) {
      const value = evaluated.get(selectedKey);
      return value ? formatValue(value) : "";
    }
    // Pendant la saisie, on évalue la formule en cours sans toucher la grille.
    const raw: Record<string, string> = {};
    for (const [key, value] of activeMap) raw[key] = value;
    raw[selectedKey] = currentBarDraft;
    const previewValue = evaluateCells(raw).get(selectedKey);
    return previewValue ? formatValue(previewValue) : "";
  }, [activeMap, currentBarDraft, evaluated, selectedKey]);

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
      items.push(insert("row", target.row, "Insérer une ligne au-dessus"));
      items.push(insert("row", target.row + 1, "Insérer une ligne en dessous"));
      items.push({ type: "separator", id: "colonnes" });
      items.push(insert("col", target.col, "Insérer une colonne à gauche"));
      items.push(insert("col", target.col + 1, "Insérer une colonne à droite"));
      items.push({ type: "separator", id: "suppressions" });
      items.push(remove("row", target.row, "Supprimer la ligne"));
      items.push(remove("col", target.col, "Supprimer la colonne"));
      items.push({ type: "separator", id: "formats" });
      items.push(format("gras", "Gras", selectedStyle?.bold === true, () => toggleFlag("bold")));
      items.push(
        format("italique", "Italique", selectedStyle?.italic === true, () => toggleFlag("italic")),
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
    menu,
    runStructure,
    selectedStyle,
    structureBusy,
    styleBusy,
    toggleAlign,
    toggleFlag,
  ]);

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
    focusCell(target.row, target.col);
  }

  /** Donne le focus à une cellule de la grille (navigation clavier). */
  const focusCell = useCallback((row: number, col: number) => {
    const element = gridRef.current?.querySelector<HTMLButtonElement>(
      `[data-cell-row="${row}"][data-cell-col="${col}"]`,
    );
    element?.focus();
  }, []);

  /** Navigation clavier de la grille quand aucune cellule n'est en édition. */
  const moveSelection = useCallback(
    (row: number, col: number) => {
      const next = {
        row: Math.max(0, Math.min(ROWS - 1, row)),
        col: Math.max(0, Math.min(COLS - 1, col)),
      };
      setSelected(next);
      focusCell(next.row, next.col);
    },
    [focusCell],
  );

  const onGridKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (editing) return;
      const deltas: Record<string, [number, number]> = {
        ArrowUp: [-1, 0],
        ArrowDown: [1, 0],
        ArrowLeft: [0, -1],
        ArrowRight: [0, 1],
      };
      const delta = deltas[event.key];
      if (delta) {
        event.preventDefault();
        // Ctrl (ou Cmd) étend le pas d'une page entière de la grille visible.
        const stride = event.ctrlKey || event.metaKey ? 5 : 1;
        const current = selected ?? { row: 0, col: 0 };
        moveSelection(current.row + delta[0] * stride, current.col + delta[1] * stride);
        return;
      }
      if (event.key === "Home" && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        moveSelection(0, 0);
      } else if (event.key === "End" && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        moveSelection(ROWS - 1, COLS - 1);
      } else if (event.key === "Escape" && selected) {
        setSelected(null);
      }
    },
    [editing, moveSelection, selected],
  );

  return (
    <div className="flex flex-col gap-3">
      <header className="flex flex-wrap items-center gap-2">
        <a href="/" className="text-sm text-muted-foreground hover:text-foreground">
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
          className="min-w-40 border-none bg-transparent font-display text-lg font-semibold tracking-tight outline-none"
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
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive"
        >
          {error}
        </p>
      ) : null}

      {detail ? (
        <>
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

          <div className="flex flex-wrap items-center gap-2">
            {detail.tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => {
                  void flush(activeTabId);
                  setActiveTabId(tab.id);
                  setEditing(null);
                  setSelected(null);
                }}
                className={cn(
                  "rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
                  tab.id === activeTabId
                    ? "border-primary bg-accent text-accent-foreground"
                    : "border-border bg-card text-muted-foreground hover:bg-muted",
                )}
              >
                {tab.name}
              </button>
            ))}
            {activeTabId ? (
              <a
                href={`/api/sheets/export/${fileId}?tab=${activeTabId}`}
                download
                className="rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted"
              >
                Exporter CSV
              </a>
            ) : null}
            {canEdit ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setTabName("");
                  setTabDialog("add");
                }}
              >
                ＋ Onglet
              </Button>
            ) : null}
            {canEdit && activeTab ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setTabName(activeTab.name);
                  setTabDialog("rename");
                }}
              >
                Renommer
              </Button>
            ) : null}
            {canEdit && activeTab && detail.tabs.length > 1 ? (
              <Button
                size="sm"
                variant="ghost"
                className="text-destructive"
                loading={busy}
                onClick={() => void onDeleteTab(activeTab.id)}
              >
                Supprimer l'onglet
              </Button>
            ) : null}
            <span className="ml-auto text-xs text-muted-foreground">
              Formules : =SUM(A1:A5), =AVG(B1:B3), + − × ÷, références A1
            </span>
          </div>

          {canEdit && selected ? (
            <div
              role="toolbar"
              aria-label="Mise en forme de la cellule"
              className="flex flex-wrap items-center gap-1 rounded-xl border border-border bg-card px-2 py-1.5"
            >
              <span className="px-1 text-xs font-medium tabular-nums text-muted-foreground">
                {cellKey(selected.row, selected.col)}
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
              <span aria-hidden className="mx-1 h-5 w-px bg-border" />
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
              <span aria-hidden className="mx-1 h-5 w-px bg-border" />
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
              <Button
                size="sm"
                variant="ghost"
                className="ml-auto"
                disabled={styleBusy || !selectedStyle}
                onClick={() => void applyCellStyle(() => null)}
              >
                Effacer le format
              </Button>
            </div>
          ) : null}

          {/*
              Tableau natif (en-têtes de colonne et de ligne, cellules) disposé
              en grille CSS : `display: contents` sur les enveloppes fait des
              cellules les éléments de la grille, donc la mise en page reste
              celle d'une grille et la sémantique celle d'un tableau.
            */}
          <table
            // biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: rôle « grid » du motif ARIA, posé sur le tableau natif pour que les lecteurs d'écran annoncent une grille navigable.
            role="grid"
            aria-label="Grille de la feuille"
            aria-rowcount={ROWS + 1}
            aria-colcount={COLS + 1}
            aria-readonly={!canEdit}
            className="grid"
            onKeyDown={onGridKeyDown}
            style={
              {
                "--sheet-gutter": "44px",
                "--sheet-col-min": "96px",
                gridTemplateColumns: `var(--sheet-gutter) ${columnTracks}`,
                gridTemplateRows: `auto ${rowTracks}`,
                width: "max-content",
                minWidth: "100%",
              } as CSSProperties
            }
          >
            <caption className="sr-only">
              Grille de la feuille — flèches pour parcourir les cellules, Entrée pour modifier,
              touche Menu pour les actions de la cellule.
            </caption>
            <thead className="contents">
              <tr className="contents">
                <td className="sticky left-0 top-0 z-20 border-b border-r border-border bg-muted" />
                {COL_LETTERS.map((letter, col) => (
                  <th
                    key={letter}
                    scope="col"
                    data-col-index={col}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      openMenu(
                        { kind: "col", index: col },
                        { left: event.clientX, top: event.clientY },
                      );
                    }}
                    className={cn(
                      "sticky top-0 z-10 border-b border-border bg-muted px-2 py-1 text-center text-[11px] font-medium text-muted-foreground",
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
                ))}
              </tr>
            </thead>
            <tbody className="contents">
              {ROW_KEYS.map((rowKey, row) => (
                <tr key={rowKey} className="contents">
                  <th
                    scope="row"
                    data-row-index={row}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      openMenu(
                        { kind: "row", index: row },
                        { left: event.clientX, top: event.clientY },
                      );
                    }}
                    className={cn(
                      "sticky left-0 z-10 border-r border-border bg-muted px-2 py-1 text-right text-[11px] font-normal tabular-nums text-muted-foreground",
                      row < ROWS - 1 && "border-b",
                    )}
                  >
                    {row + 1}
                    <ResizeHandle
                      axis="row"
                      index={row}
                      label={`Redimensionner la ligne ${row + 1}`}
                      current={sizeOf(rowSizes, row, "row")}
                      preview={
                        preview?.axis === "row" && preview.index === row ? preview.size : null
                      }
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
                    return (
                      <td
                        key={isEditing ? `${key}:edition` : key}
                        className={cn(
                          "min-w-0 overflow-hidden p-0",
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
                          display={value ? formatValue(value) : ""}
                          tone={toneOf(value)}
                          cellStyle={cellStyle}
                          selected={isSelected}
                          canEdit={canEdit}
                          editing={isEditing}
                          onStart={startEditing}
                          onCommit={commitEditing}
                          onCancel={cancelEditing}
                          onRequestMenu={requestCellMenu}
                          data-cell-row={row}
                          data-cell-col={col}
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>

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
        <p className="text-sm text-muted-foreground">Chargement…</p>
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
