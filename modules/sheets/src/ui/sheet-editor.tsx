import { Button, cn, Dialog, Input, Label } from "@workspace/ui";
import {
  type ChangeEvent,
  type CSSProperties,
  type FormEvent,
  Fragment,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { cellKey, evaluateCells, formatValue } from "../formula.ts";
import {
  addTabFn,
  deleteTabFn,
  getSpreadsheetFn,
  importCsvFn,
  renameSpreadsheetFn,
  renameTabFn,
  type SpreadsheetDetail,
  saveCellsFn,
} from "../server.ts";

const COLS = 20;
const ROWS = 100;
const COL_LETTERS = Array.from({ length: COLS }, (_, index) =>
  cellKey(0, index).replace(/\d+$/, ""),
);
/** Clés stables des lignes (évite l'index de tableau comme clé React). */
const ROW_KEYS = Array.from({ length: ROWS }, (_, index) => `ligne-${index + 1}`);
const SAVE_DEBOUNCE_MS = 700;
const SAVE_RETRY_MS = 3_000;

type SaveStatus = "idle" | "saving" | "saved" | "error";
type MoveDirection = "down" | "right" | "none";
type CellTone = "number" | "error" | "text";

type GridCellProps = {
  row: number;
  col: number;
  raw: string;
  display: string;
  tone: CellTone;
  canEdit: boolean;
  editing: boolean;
  lastRow: boolean;
  lastCol: boolean;
  onStart: (row: number, col: number) => void;
  onCommit: (row: number, col: number, value: string, move: MoveDirection) => void;
  onCancel: () => void;
};

/**
 * Cellule mémoïsée : le brouillon d'édition reste local, donc la frappe ne
 * re-rend que cette cellule (pas les 2 000 de la grille). L'édition est validée
 * au blur ou à Entrée (descente), Tab (droite) et annulée avec Échap.
 */
const GridCell = memo(function GridCell({
  row,
  col,
  raw,
  display,
  tone,
  canEdit,
  editing,
  lastRow,
  lastCol,
  onStart,
  onCommit,
  onCancel,
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
        className={cn(
          "bg-background px-2 py-1 text-sm outline-2 outline-ring",
          !lastRow && "border-b border-border",
          !lastCol && "border-r border-border",
        )}
      />
    );
  }

  return (
    <button
      type="button"
      aria-label={`Cellule ${cellKey(row, col)}`}
      onClick={() => onStart(row, col)}
      title={raw || undefined}
      className={cn(
        "truncate px-2 py-1 text-sm",
        !lastRow && "border-b border-border",
        !lastCol && "border-r border-border",
        tone === "number" ? "text-right tabular-nums" : "text-left",
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
  const [status, setStatus] = useState<SaveStatus>("idle");
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
      for (const cell of data.cells) {
        const map = byTab.get(cell.tabId) ?? new Map<string, string>();
        map.set(`${cell.row}:${cell.col}`, cell.value);
        byTab.set(cell.tabId, map);
      }
      for (const tab of data.tabs) {
        if (!byTab.has(tab.id)) byTab.set(tab.id, new Map());
      }
      setDetail(data);
      setTitle(data.title);
      setCellsByTab(byTab);
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

  const evaluated = useMemo(() => {
    const raw: Record<string, string> = {};
    for (const [key, value] of activeMap) {
      const [row, col] = key.split(":").map(Number);
      raw[cellKey(row ?? 0, col ?? 0)] = value;
    }
    return evaluateCells(raw);
  }, [activeMap]);

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
    setEditing({ row, col });
  }, []);

  const cancelEditing = useCallback(() => setEditing(null), []);

  const commitEditing = useCallback(
    (row: number, col: number, value: string, move: MoveDirection) => {
      commitCell(row, col, value);
      if (move === "none") {
        setEditing(null);
        return;
      }
      const nextRow = move === "down" ? Math.min(row + 1, ROWS - 1) : row;
      const nextCol = move === "right" ? Math.min(col + 1, COLS - 1) : col;
      setEditing({ row: nextRow, col: nextCol });
    },
    [commitCell],
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

  const activeTab = detail?.tabs.find((tab) => tab.id === activeTabId) ?? null;
  const canEdit = detail?.canEdit ?? false;
  const statusLabel =
    status === "saving"
      ? "Enregistrement…"
      : status === "saved"
        ? "Enregistré"
        : status === "error"
          ? "Erreur de sauvegarde"
          : "";

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
          <div className="flex flex-wrap items-center gap-2">
            {detail.tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => {
                  void flush(activeTabId);
                  setActiveTabId(tab.id);
                  setEditing(null);
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

          <div className="max-h-[70vh] overflow-auto rounded-xl border border-border bg-card">
            <div
              className="grid"
              style={
                {
                  "--sheet-gutter": "44px",
                  "--sheet-col-min": "96px",
                  gridTemplateColumns: `var(--sheet-gutter) repeat(${COLS}, minmax(var(--sheet-col-min), 1fr))`,
                  width: "max-content",
                  minWidth: "100%",
                } as CSSProperties
              }
            >
              <div className="sticky left-0 top-0 z-20 border-b border-r border-border bg-muted" />
              {COL_LETTERS.map((letter, index) => (
                <div
                  key={letter}
                  className={cn(
                    "sticky top-0 z-10 border-b border-border bg-muted px-2 py-1 text-center text-[11px] font-medium text-muted-foreground",
                    index < COLS - 1 && "border-r",
                  )}
                >
                  {letter}
                </div>
              ))}
              {ROW_KEYS.map((rowKey, row) => (
                <Fragment key={rowKey}>
                  <div
                    className={cn(
                      "sticky left-0 z-10 border-r border-border bg-muted px-2 py-1 text-right text-[11px] tabular-nums text-muted-foreground",
                      row < ROWS - 1 && "border-b",
                    )}
                  >
                    {row + 1}
                  </div>
                  {Array.from({ length: COLS }, (_, col) => {
                    const key = cellKey(row, col);
                    const raw = activeMap.get(`${row}:${col}`) ?? "";
                    const value = evaluated.get(key);
                    const isEditing = editing?.row === row && editing?.col === col;
                    const tone: CellTone =
                      value?.kind === "number"
                        ? "number"
                        : value?.kind === "error"
                          ? "error"
                          : "text";
                    return (
                      <GridCell
                        key={isEditing ? `${key}:edition` : key}
                        row={row}
                        col={col}
                        raw={raw}
                        display={value ? formatValue(value) : ""}
                        tone={tone}
                        canEdit={canEdit}
                        editing={isEditing}
                        lastRow={row === ROWS - 1}
                        lastCol={col === COLS - 1}
                        onStart={startEditing}
                        onCommit={commitEditing}
                        onCancel={cancelEditing}
                      />
                    );
                  })}
                </Fragment>
              ))}
            </div>
          </div>
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
