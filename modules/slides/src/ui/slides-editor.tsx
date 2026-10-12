import { Alert, Button, ConfirmDialog, cn, Input, Label } from "@workspace/ui";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  type ElementView,
  getPresentationFn,
  renamePresentationFn,
  type SlideView,
  savePresentationFn,
} from "../server.ts";

type EditorElement = Omit<ElementView, "id"> & { key: string; id?: string };
type EditorSlide = {
  id?: string;
  key: string;
  title: string;
  notes: string;
  elements: EditorElement[];
};
type SaveStatus = "idle" | "saving" | "saved" | "error";

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function toEditor(slides: SlideView[]): EditorSlide[] {
  return slides.map((slide) => ({
    id: slide.id,
    key: crypto.randomUUID(),
    title: slide.title ?? "",
    notes: slide.notes ?? "",
    elements: slide.elements.map((element) => ({ ...element, key: crypto.randomUUID() })),
  }));
}

/**
 * Injecte les identifiants renvoyés par le serveur pour les éléments créés
 * pendant cette sauvegarde, sans toucher au reste de l'état local (les clés
 * React restent identiques : aucun remontage, aucune édition perdue).
 */
function mergeSavedIds(
  current: EditorSlide[],
  sent: EditorSlide[],
  saved: SlideView[],
): EditorSlide[] {
  const sentSlides = new Map(sent.map((slide, index) => [slide.key, { slide, index }] as const));
  return current.map((slide) => {
    const match = sentSlides.get(slide.key);
    const savedSlide = match ? saved[match.index] : undefined;
    if (!match || !savedSlide) return slide;
    const sentElements = new Map(
      match.slide.elements.map((element, index) => [element.key, index] as const),
    );
    let elementsChanged = false;
    const elements = slide.elements.map((element) => {
      if (element.id) return element;
      const sentIndex = sentElements.get(element.key);
      const savedElement = sentIndex === undefined ? undefined : savedSlide.elements[sentIndex];
      if (!savedElement) return element;
      elementsChanged = true;
      return { ...element, id: savedElement.id };
    });
    const id = slide.id ?? savedSlide.id;
    if (!elementsChanged && id === slide.id) return slide;
    return { ...slide, id, elements };
  });
}

/**
 * Éditeur de présentation : diapositives en 16:9 à positions relatives (%),
 * déplacement et redimensionnement à la souris, propriétés à droite,
 * autosave et mode présentation plein écran.
 */
export function SlidesEditor({ fileId }: { fileId: string }) {
  const [title, setTitle] = useState("");
  const [canEdit, setCanEdit] = useState(false);
  const [slides, setSlides] = useState<EditorSlide[]>([]);
  const [selectedSlide, setSelectedSlide] = useState(0);
  const [selectedElementKey, setSelectedElementKey] = useState<string | null>(null);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [presenting, setPresenting] = useState(false);
  const [presentIndex, setPresentIndex] = useState(0);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const canvasRef = useRef<HTMLDivElement>(null);
  const slidesRef = useRef<EditorSlide[]>([]);
  const canEditRef = useRef(false);
  const revisionRef = useRef(1);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    slidesRef.current = slides;
  }, [slides]);

  const load = useCallback(async () => {
    try {
      const data = await getPresentationFn({ data: { fileId } });
      setTitle(data.title);
      setCanEdit(data.canEdit);
      canEditRef.current = data.canEdit;
      revisionRef.current = data.revision;
      setSlides(toEditor(data.slides));
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Chargement impossible.");
    } finally {
      setLoading(false);
    }
  }, [fileId]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = useCallback(async () => {
    if (!canEditRef.current || slidesRef.current.length === 0) return;
    const sent = slidesRef.current;
    setStatus("saving");
    try {
      const saved = await savePresentationFn({
        data: {
          fileId,
          revision: revisionRef.current,
          slides: sent.map((slide) => ({
            id: slide.id,
            title: slide.title || null,
            notes: slide.notes || null,
            elements: slide.elements.map(({ key: _key, ...element }) => ({
              ...element,
              id: element.id ?? undefined,
            })),
          })),
        },
      });
      // Révision à jour pour la prochaine sauvegarde ; les éditions locales
      // sont conservées (seuls les identifiants manquants sont complétés).
      revisionRef.current = saved.revision;
      setSlides((current) => mergeSavedIds(current, sent, saved.slides));
      setError(null);
      setStatus("saved");
    } catch (caught) {
      // En conflit, l'état local reste intact : rien n'est perdu.
      setStatus("error");
      setError(caught instanceof Error ? caught.message : "Sauvegarde impossible.");
    }
  }, [fileId]);

  const schedule = useCallback(() => {
    setStatus("idle");
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => void save(), 900);
  }, [save]);

  function mutateSlide(index: number, updater: (slide: EditorSlide) => EditorSlide) {
    setSlides((current) =>
      current.map((slide, position) => (position === index ? updater(slide) : slide)),
    );
    schedule();
  }

  function updateElement(elementKey: string, patch: Partial<EditorElement>) {
    mutateSlide(selectedSlide, (slide) => ({
      ...slide,
      elements: slide.elements.map((element) =>
        element.key === elementKey ? { ...element, ...patch } : element,
      ),
    }));
  }

  function addElement(kind: "text" | "shape") {
    const element: EditorElement =
      kind === "text"
        ? {
            key: crypto.randomUUID(),
            kind,
            x: 10,
            y: 40,
            w: 40,
            h: 12,
            text: "Texte",
            fontSize: 24,
            bold: false,
            align: "left",
          }
        : {
            key: crypto.randomUUID(),
            kind,
            x: 10,
            y: 10,
            w: 20,
            h: 20,
            text: "",
            fontSize: 24,
            bold: false,
            align: "left",
          };
    mutateSlide(selectedSlide, (slide) => ({ ...slide, elements: [...slide.elements, element] }));
    setSelectedElementKey(element.key);
  }

  function deleteElement() {
    if (!selectedElementKey) return;
    mutateSlide(selectedSlide, (slide) => ({
      ...slide,
      elements: slide.elements.filter((element) => element.key !== selectedElementKey),
    }));
    setSelectedElementKey(null);
  }

  function addSlide() {
    setSlides((current) => [
      ...current,
      {
        key: crypto.randomUUID(),
        title: `Diapositive ${current.length + 1}`,
        notes: "",
        elements: [],
      },
    ]);
    setSelectedSlide(slides.length);
    setSelectedElementKey(null);
    schedule();
  }

  function duplicateSlide() {
    const source = slides[selectedSlide];
    if (!source) return;
    setSlides((current) => {
      const copy: EditorSlide = {
        key: crypto.randomUUID(),
        title: `${source.title || `Diapositive ${selectedSlide + 1}`} (copie)`,
        notes: source.notes,
        elements: source.elements.map((element) => ({
          ...element,
          key: crypto.randomUUID(),
          id: undefined,
        })),
      };
      const next = [...current];
      next.splice(selectedSlide + 1, 0, copy);
      return next;
    });
    setSelectedSlide(selectedSlide + 1);
    schedule();
  }

  function deleteSlide() {
    if (slides.length <= 1) return;
    setSlides((current) => current.filter((_, position) => position !== selectedSlide));
    setSelectedSlide((current) => Math.max(0, current - 1));
    setSelectedElementKey(null);
    schedule();
  }

  function moveSlide(direction: -1 | 1) {
    const target = selectedSlide + direction;
    if (target < 0 || target >= slides.length) return;
    setSlides((current) => {
      const next = [...current];
      const [item] = next.splice(selectedSlide, 1);
      if (item) next.splice(target, 0, item);
      return next;
    });
    setSelectedSlide(target);
    schedule();
  }

  async function onRenameTitle() {
    const clean = title.trim();
    if (clean.length === 0) {
      void load();
      return;
    }
    try {
      const renamed = await renamePresentationFn({ data: { fileId, title: clean } });
      setTitle(renamed.title);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Renommage impossible.");
    }
  }

  function startElementDrag(event: React.PointerEvent, element: EditorElement) {
    if (!canEdit) return;
    event.preventDefault();
    event.stopPropagation();
    setSelectedElementKey(element.key);
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const startX = event.clientX;
    const startY = event.clientY;
    const origin = { x: element.x, y: element.y };
    const move = (moveEvent: PointerEvent) => {
      const dx = ((moveEvent.clientX - startX) / rect.width) * 100;
      const dy = ((moveEvent.clientY - startY) / rect.height) * 100;
      updateElement(element.key, {
        x: round1(clamp(origin.x + dx, 0, 100 - element.w)),
        y: round1(clamp(origin.y + dy, 0, 100 - element.h)),
      });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  function startElementResize(event: React.PointerEvent, element: EditorElement) {
    if (!canEdit) return;
    event.preventDefault();
    event.stopPropagation();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const startX = event.clientX;
    const startY = event.clientY;
    const origin = { w: element.w, h: element.h };
    const move = (moveEvent: PointerEvent) => {
      const dw = ((moveEvent.clientX - startX) / rect.width) * 100;
      const dh = ((moveEvent.clientY - startY) / rect.height) * 100;
      updateElement(element.key, {
        w: round1(clamp(origin.w + dw, 2, 100 - element.x)),
        h: round1(clamp(origin.h + dh, 2, 100 - element.y)),
      });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  useEffect(() => {
    if (!presenting) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "ArrowRight") {
        setPresentIndex((current) => Math.min(current + 1, slides.length - 1));
      } else if (event.key === "ArrowLeft") {
        setPresentIndex((current) => Math.max(current - 1, 0));
      } else if (event.key === "Escape") {
        setPresenting(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [presenting, slides.length]);

  const current = slides[selectedSlide] ?? null;
  const selectedElement =
    current?.elements.find((element) => element.key === selectedElementKey) ?? null;

  function renderSlide(slide: EditorSlide, interactive: boolean) {
    return (
      <div
        ref={interactive ? canvasRef : undefined}
        onPointerDown={() => {
          if (interactive) setSelectedElementKey(null);
        }}
        style={
          { containerType: "inline-size", "--slide-design-width": "960" } as React.CSSProperties
        }
        className="relative aspect-[16/9] w-full overflow-hidden rounded-xl border border-border bg-card text-foreground shadow-soft"
      >
        {slide.elements.map((element) => {
          const className = cn(
            "absolute select-none whitespace-pre-wrap rounded",
            element.kind === "shape" && "border border-border bg-accent",
          );
          const style = {
            left: `${element.x}%`,
            top: `${element.y}%`,
            width: `${element.w}%`,
            height: `${element.h}%`,
            fontSize: `calc(${element.fontSize} * 100cqw / var(--slide-design-width))`,
            fontWeight: element.bold ? 700 : 400,
            textAlign: element.align,
            lineHeight: 1.25,
          } as const;
          if (!interactive) {
            return (
              <div key={element.key} className={className} style={style}>
                {element.text}
              </div>
            );
          }
          return (
            <button
              key={element.key}
              type="button"
              aria-label={
                element.text
                  ? `Élément ${element.text}`
                  : `Élément ${element.kind === "shape" ? "forme" : "texte"}`
              }
              onPointerDown={(event) => startElementDrag(event, element)}
              onClick={(event) => {
                event.stopPropagation();
                setSelectedElementKey(element.key);
              }}
              className={cn(
                className,
                "cursor-move text-left focus-visible:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                selectedElementKey === element.key &&
                  "outline outline-2 outline-offset-2 outline-ring",
              )}
              style={style}
            >
              {element.text}
              {selectedElementKey === element.key ? (
                <span
                  aria-hidden
                  onPointerDown={(event) => startElementResize(event, element)}
                  className="absolute -bottom-1 -right-1 size-3 cursor-nwse-resize rounded-sm border border-border bg-background"
                />
              ) : null}
            </button>
          );
        })}
      </div>
    );
  }

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
          ← Présentations
        </a>
        <input
          aria-label="Titre de la présentation"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          onBlur={() => void onRenameTitle()}
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
          {!canEdit ? (
            <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">
              Lecture seule
            </span>
          ) : null}
          <Button
            size="sm"
            variant="outline"
            disabled={slides.length === 0}
            onClick={() => {
              setPresentIndex(selectedSlide);
              setPresenting(true);
            }}
          >
            Présenter
          </Button>
        </div>
      </header>

      {error ? <Alert tone="danger">{error}</Alert> : null}

      {loading ? (
        <p className="text-sm text-muted-foreground">Chargement…</p>
      ) : current ? (
        <div className="flex flex-col gap-3 lg:flex-row">
          <ol className="flex shrink-0 flex-row gap-2 overflow-x-auto lg:w-44 lg:flex-col lg:overflow-y-auto">
            {slides.map((slide, index) => (
              <li key={slide.key}>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedSlide(index);
                    setSelectedElementKey(null);
                  }}
                  className={cn(
                    "w-full min-w-36 rounded-lg border p-1.5 text-left transition-colors",
                    index === selectedSlide
                      ? "border-primary bg-accent text-accent-foreground"
                      : "border-border bg-card hover:bg-muted",
                  )}
                >
                  <span className="grid aspect-[16/9] w-full place-items-center rounded bg-background text-[10px] text-muted-foreground">
                    {index + 1}
                  </span>
                  <span className="mt-1 block truncate text-[11px] font-medium">
                    {slide.title || `Diapositive ${index + 1}`}
                  </span>
                </button>
              </li>
            ))}
          </ol>

          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              {canEdit ? (
                <>
                  <Button size="sm" variant="outline" onClick={() => addElement("text")}>
                    Ajouter une zone de texte
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => addElement("shape")}>
                    Ajouter une forme
                  </Button>
                  <span className="mx-1 h-5 w-px bg-border" />
                  <Button size="sm" variant="outline" onClick={addSlide}>
                    ＋ Diapositive
                  </Button>
                  <Button size="sm" variant="outline" onClick={duplicateSlide}>
                    Dupliquer
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive"
                    disabled={slides.length <= 1}
                    onClick={() => setDeleteOpen(true)}
                  >
                    Supprimer
                  </Button>
                  <span className="mx-1 h-5 w-px bg-border" />
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label="Monter la diapositive"
                    disabled={selectedSlide === 0}
                    onClick={() => moveSlide(-1)}
                  >
                    ↑
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label="Descendre la diapositive"
                    disabled={selectedSlide === slides.length - 1}
                    onClick={() => moveSlide(1)}
                  >
                    ↓
                  </Button>
                </>
              ) : null}
            </div>
            {renderSlide(current, canEdit)}
          </div>

          <aside className="flex w-full shrink-0 flex-col gap-3 rounded-xl border border-border bg-card p-3 lg:w-60">
            <div className="flex flex-col gap-1">
              <Label htmlFor="slide-title">Titre de la diapositive</Label>
              <Input
                id="slide-title"
                value={current.title}
                disabled={!canEdit}
                onChange={(event) =>
                  mutateSlide(selectedSlide, (slide) => ({ ...slide, title: event.target.value }))
                }
                maxLength={255}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="slide-notes">Notes du présentateur</Label>
              <textarea
                id="slide-notes"
                value={current.notes}
                disabled={!canEdit}
                onChange={(event) =>
                  mutateSlide(selectedSlide, (slide) => ({ ...slide, notes: event.target.value }))
                }
                rows={3}
                maxLength={5000}
                className="rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </div>

            <div className="border-t border-border pt-3">
              {selectedElement && canEdit ? (
                <div className="flex flex-col gap-2">
                  <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
                    Élément sélectionné
                  </p>
                  {selectedElement.kind === "text" ? (
                    <div className="flex flex-col gap-1">
                      <Label htmlFor="element-text">Texte</Label>
                      <textarea
                        id="element-text"
                        value={selectedElement.text}
                        onChange={(event) =>
                          updateElement(selectedElement.key, { text: event.target.value })
                        }
                        rows={3}
                        maxLength={2000}
                        className="rounded-md border border-input bg-background px-3 py-2 text-sm"
                      />
                    </div>
                  ) : null}
                  <div className="flex items-center gap-2">
                    <Label htmlFor="element-size" className="shrink-0">
                      Taille
                    </Label>
                    <Input
                      id="element-size"
                      type="number"
                      min={8}
                      max={200}
                      value={selectedElement.fontSize}
                      onChange={(event) =>
                        updateElement(selectedElement.key, {
                          fontSize: clamp(Number(event.target.value) || 24, 8, 200),
                        })
                      }
                      className="h-8"
                    />
                  </div>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={selectedElement.bold}
                      onChange={(event) =>
                        updateElement(selectedElement.key, { bold: event.target.checked })
                      }
                    />
                    Gras
                  </label>
                  <div className="flex flex-col gap-1">
                    <Label htmlFor="element-align">Alignement</Label>
                    <select
                      id="element-align"
                      value={selectedElement.align}
                      onChange={(event) =>
                        updateElement(selectedElement.key, {
                          align: event.target.value as ElementView["align"],
                        })
                      }
                      className="h-8 rounded-md border border-input bg-background px-2 text-sm"
                    >
                      <option value="left">Gauche</option>
                      <option value="center">Centré</option>
                      <option value="right">Droite</option>
                    </select>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="self-start text-destructive"
                    onClick={deleteElement}
                  >
                    Supprimer l'élément
                  </Button>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Sélectionnez un élément pour modifier son texte, sa taille et son alignement.
                </p>
              )}
            </div>
          </aside>
        </div>
      ) : null}

      <ConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={() => {
          setDeleteOpen(false);
          deleteSlide();
        }}
        title="Supprimer la diapositive ?"
        message="Cette diapositive et ses éléments seront supprimés."
        destructive
      />

      {presenting ? (
        <div className="fixed inset-0 z-50 flex flex-col bg-rail text-rail-foreground">
          <div className="flex items-center gap-2 px-4 py-2 text-sm">
            <span>
              {presentIndex + 1} / {slides.length}
            </span>
            <button
              type="button"
              className="ml-auto rounded-md px-2 py-1 hover:bg-rail-active focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => setPresenting(false)}
            >
              ✕ Quitter (Échap)
            </button>
          </div>
          <div className="flex flex-1 items-center justify-center p-6">
            <div className="w-full max-w-5xl">
              {slides[presentIndex] ? renderSlide(slides[presentIndex], false) : null}
            </div>
          </div>
          <div className="flex justify-center gap-2 pb-4">
            <Button
              variant="outline"
              aria-label="Diapositive précédente"
              disabled={presentIndex === 0}
              onClick={() => setPresentIndex((currentIndex) => Math.max(currentIndex - 1, 0))}
            >
              ‹
            </Button>
            <Button
              variant="outline"
              aria-label="Diapositive suivante"
              disabled={presentIndex >= slides.length - 1}
              onClick={() =>
                setPresentIndex((currentIndex) => Math.min(currentIndex + 1, slides.length - 1))
              }
            >
              ›
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
