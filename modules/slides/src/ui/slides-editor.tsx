import { Alert, Button, ConfirmDialog, cn, Dialog, Input, Kbd, Label } from "@workspace/ui";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  clamp,
  cloneSlide,
  type EditorElement,
  type EditorSlide,
  mergeSavedIds,
  toEditor,
} from "../editor-model.ts";
import {
  type ElementView,
  getPresentationFn,
  renamePresentationFn,
  savePresentationFn,
  updatePresentationSettingFn,
} from "../server.ts";
import {
  aspectLabel,
  conversionSummary,
  convertScene,
  DEFAULT_SLIDE_ASPECT,
  normalizeAspect,
  SLIDE_ASPECT_IDS,
  type SlideAspectId,
} from "../slide-aspect.ts";
import {
  isInsideModal,
  isTypingTarget,
  slideNavigationAnnouncement,
  slideNavigationTarget,
} from "../slide-navigation.ts";
import { formatElapsed } from "../slide-notes.ts";
import { canMoveSlide, moveTarget, reorderSlides } from "../slide-order.ts";
import {
  presentationExitMessage,
  presentationHelp,
  presentationLabel,
  presentationProgress,
  presentationShouldContinue,
  presentationSummary,
} from "../slide-presentation.ts";
import {
  DEFAULT_SLIDE_THEME,
  normalizeTheme,
  SLIDE_THEME_IDS,
  type SlideThemeId,
  themeLabel,
  themeSwatchClass,
} from "../slide-theme.ts";
import { SlideCanvas } from "./slide-canvas.tsx";
import { SlideFilmstrip } from "./slide-filmstrip.tsx";
import { PresenterNotes, SlideNotesField } from "./slide-notes-panel.tsx";

type SaveStatus = "idle" | "saving" | "saved" | "error";

/**
 * Éditeur de présentation : diapositives en 16:9 à positions relatives (%),
 * bande de vignettes (sélection, réordonnancement), déplacement et
 * redimensionnement à la souris, notes du présentateur, autosave et mode
 * présentation plein écran.
 */
export function SlidesEditor({ fileId }: { fileId: string }) {
  const [title, setTitle] = useState("");
  const [canEdit, setCanEdit] = useState(false);
  const [aspect, setAspect] = useState<SlideAspectId>(DEFAULT_SLIDE_ASPECT);
  const [theme, setTheme] = useState<SlideThemeId>(DEFAULT_SLIDE_THEME);
  const [slides, setSlides] = useState<EditorSlide[]>([]);
  const [selectedSlide, setSelectedSlide] = useState(0);
  const [selectedElementKey, setSelectedElementKey] = useState<string | null>(null);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [loading, setLoading] = useState(true);
  const [presenting, setPresenting] = useState(false);
  const [presentIndex, setPresentIndex] = useState(0);
  /** Vrai quand le mode présentation a demandé le plein écran. */
  const fullscreenRequestedRef = useRef(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const [notesOpen, setNotesOpen] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [printToken, setPrintToken] = useState(0);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [imageOpen, setImageOpen] = useState(false);
  const [imageBusy, setImageBusy] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
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
      setAspect(normalizeAspect(data.aspect));
      setTheme(normalizeTheme(data.theme));
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

  function updateElement(elementKey: string, patch: Partial<ElementView>) {
    mutateSlide(selectedSlide, (slide) => ({
      ...slide,
      elements: slide.elements.map((element) =>
        element.key === elementKey ? { ...element, ...patch } : element,
      ),
    }));
  }

  const selectSlide = useCallback((index: number) => {
    setSelectedSlide(index);
    setSelectedElementKey(null);
  }, []);

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

  /**
   * Téléverse l'image choisie, puis l'ajoute à la diapositive courante.
   * Le binaire vit dans le stockage du module ; l'élément ne garde que la clé.
   */
  async function onImageSelected(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setImageBusy(true);
    setImageError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const response = await fetch(`/api/slides/upload?fileId=${encodeURIComponent(fileId)}`, {
        method: "POST",
        body: form,
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { message?: string } | null;
        throw new Error(payload?.message ?? "Téléversement impossible.");
      }
      const { mediaKey } = (await response.json()) as { mediaKey: string };
      const element: EditorElement = {
        key: crypto.randomUUID(),
        kind: "image",
        x: 20,
        y: 20,
        w: 30,
        h: 25,
        text: "",
        mediaKey,
        fontSize: 24,
        bold: false,
        align: "left",
      };
      mutateSlide(selectedSlide, (slide) => ({ ...slide, elements: [...slide.elements, element] }));
      setSelectedElementKey(element.key);
      setImageOpen(false);
    } catch (caught) {
      setImageError(caught instanceof Error ? caught.message : "Téléversement impossible.");
    } finally {
      setImageBusy(false);
    }
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
    const copy = cloneSlide(
      source,
      `${source.title || `Diapositive ${selectedSlide + 1}`} (copie)`,
    );
    setSlides((current) => {
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

  /**
   * Enregistre un réglage de présentation (format, thème) de façon optimiste :
   * l'interface change tout de suite, le serveur confirme, et un échec rend sa
   * valeur précédente au réglage.
   */
  async function persistSetting(patch: { aspect?: SlideAspectId; theme?: SlideThemeId }) {
    if (!canEditRef.current) return;
    try {
      const saved = await updatePresentationSettingFn({ data: { fileId, ...patch } });
      setAspect(normalizeAspect(saved.aspect));
      setTheme(normalizeTheme(saved.theme));
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Réglage impossible.");
      // Retour à la valeur serveur : l'interface ne ment jamais longtemps.
      void load();
    }
  }

  /**
   * Change le format de la diapositive et convertit la scène : les positions
   * sont recalculées par la logique pure de `slide-aspect.ts`, puis
   * enregistrées par l'autosave (les éléments font partie du même état) et le
   * réglage par son propre appel.
   */
  function changeAspect(next: SlideAspectId) {
    if (next === aspect || !canEdit) return;
    const from = aspect;
    setSlides((current) =>
      current.map((slide) => ({
        ...slide,
        elements: convertScene(slide.elements, from, next).elements,
      })),
    );
    setAspect(next);
    setAnnouncement(conversionSummary(from, next, slides[selectedSlide]?.elements.length ?? 0));
    schedule();
    void persistSetting({ aspect: next });
  }

  function changeTheme(next: SlideThemeId) {
    if (next === theme || !canEdit) return;
    setTheme(next);
    setAnnouncement(`Thème « ${themeLabel(next)} » appliqué à la présentation.`);
    void persistSetting({ theme: next });
  }

  /** Déplacement d'une diapositive : la sélection la suit. */
  function moveSlideTo(from: number, to: number) {
    if (from === to) return;
    setSlides((current) => reorderSlides(current, from, to));
    setSelectedSlide(to);
    setSelectedElementKey(null);
    setAnnouncement(`Diapositive ${from + 1} déplacée en position ${to + 1}.`);
    schedule();
  }

  function moveSlide(direction: -1 | 1) {
    const target = moveTarget(selectedSlide, direction, slides.length);
    if (target === null) return;
    moveSlideTo(selectedSlide, target);
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

  // Navigation clavier entre diapositives, partout dans l'éditeur : flèches,
  // Page préc./suiv., Début/Fin. Les champs de saisie et les fenêtres modales
  // gardent le clavier (la bande de vignettes traite ses propres flèches).
  useEffect(() => {
    if (presenting) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as Element | null;
      if (isTypingTarget(target) || isInsideModal(target)) return;
      const next = slideNavigationTarget({
        key: event.key,
        altKey: event.altKey,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        count: slides.length,
        current: selectedSlide,
      });
      if (next === null) return;
      event.preventDefault();
      selectSlide(next);
      setAnnouncement(slideNavigationAnnouncement(next, slides.length));
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [presenting, selectSlide, selectedSlide, slides.length]);

  // Plein écran : le navigateur peut aussi rendre la main à l'utilisateur
  // (Échap, touche dédiée, changement de fenêtre). Dans ce cas la présentation
  // se referme avec le plein écran, pour ne pas laisser Échap sans effet.
  useEffect(() => {
    if (!presenting) return;
    const sync = () => {
      if (
        !presentationShouldContinue({
          requested: fullscreenRequestedRef.current,
          fullscreenElement: document.fullscreenElement,
          container: stageRef.current,
        })
      ) {
        setPresenting(false);
        setAnnouncement(presentationExitMessage());
      }
    };
    document.addEventListener("fullscreenchange", sync);
    sync();
    return () => document.removeEventListener("fullscreenchange", sync);
  }, [presenting]);

  // En quittant le mode présentation, on rend le plein écran au navigateur.
  useEffect(() => {
    if (presenting) return;
    fullscreenRequestedRef.current = false;
    if (document.fullscreenElement && document.fullscreenElement === stageRef.current) {
      void document.exitFullscreen().catch(() => undefined);
    }
  }, [presenting]);

  // Mode présentation : mêmes raccourcis de déplacement, Échap pour quitter
  // (ou refermer les notes du présentateur).
  useEffect(() => {
    if (!presenting) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (notesOpen) setNotesOpen(false);
        else setPresenting(false);
        return;
      }
      const next = slideNavigationTarget({
        key: event.key,
        altKey: event.altKey,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        count: slides.length,
        current: presentIndex,
      });
      if (next === null) return;
      event.preventDefault();
      setPresentIndex(next);
      setAnnouncement(presentationLabel(next, slides.length));
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [presenting, notesOpen, presentIndex, slides.length]);

  // Chronomètre du présentateur : remis à zéro à chaque ouverture.
  useEffect(() => {
    if (!presenting) {
      setElapsed(0);
      return;
    }
    const startedAt = Date.now();
    const id = window.setInterval(
      () => setElapsed(Math.floor((Date.now() - startedAt) / 1000)),
      1000,
    );
    return () => window.clearInterval(id);
  }, [presenting]);

  // Impression : le clic monte la racine #slides-print-root (portal vers
  // <body> pour échapper aux conteneurs défilants de l'application), puis
  // window.print() ouvre le dialogue. afterprint démonte la racine ; les
  // navigateurs qui ne l'émettent pas sont couverts par le clic suivant.
  useEffect(() => {
    if (printToken === 0) return;
    const clear = () => setPrintToken(0);
    window.addEventListener("afterprint", clear, { once: true });
    window.print();
    return () => window.removeEventListener("afterprint", clear);
  }, [printToken]);

  const current = slides[selectedSlide] ?? null;
  const selectedElement =
    current?.elements.find((element) => element.key === selectedElementKey) ?? null;

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
      <header className="flex flex-wrap items-center gap-2 print-hide">
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
            onClick={() => setPrintToken((token) => token + 1)}
          >
            Imprimer
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={slides.length === 0}
            onClick={() => {
              setPresentIndex(selectedSlide);
              setNotesOpen(false);
              // Plein écran local : l'API est demandée dans le geste utilisateur
              // (obligatoire), et l'échec est sans conséquence — la
              // présentation reste utilisable dans la page.
              const stage = stageRef.current;
              if (stage && typeof stage.requestFullscreen === "function") {
                fullscreenRequestedRef.current = true;
                stage.requestFullscreen().catch(() => {
                  fullscreenRequestedRef.current = false;
                });
              }
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
        <section aria-label="Éditeur de diapositives" className="flex flex-col gap-3 lg:flex-row">
          <SlideFilmstrip
            slides={slides}
            selectedIndex={selectedSlide}
            canEdit={canEdit}
            fileId={fileId}
            onSelect={selectSlide}
            onMove={moveSlideTo}
            aspect={aspect}
            theme={theme}
          />

          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2 print-hide">
              {canEdit ? (
                <>
                  <Button size="sm" variant="outline" onClick={() => addElement("text")}>
                    Ajouter une zone de texte
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => addElement("shape")}>
                    Ajouter une forme
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setImageError(null);
                      setImageOpen(true);
                    }}
                  >
                    Ajouter une image
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
                    disabled={!canMoveSlide(selectedSlide, -1, slides.length)}
                    onClick={() => moveSlide(-1)}
                  >
                    ↑
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label="Descendre la diapositive"
                    disabled={!canMoveSlide(selectedSlide, 1, slides.length)}
                    onClick={() => moveSlide(1)}
                  >
                    ↓
                  </Button>
                </>
              ) : null}
            </div>

            <p className="text-[11px] text-muted-foreground print-hide">
              <Kbd>←</Kbd> <Kbd>→</Kbd> ou <Kbd>Page préc.</Kbd> / <Kbd>Page suiv.</Kbd> pour
              changer de diapositive, <Kbd>Début</Kbd> et <Kbd>Fin</Kbd> pour la première ou la
              dernière.
            </p>

            {canEdit ? (
              <div className="flex flex-wrap items-center gap-4 print-hide">
                <fieldset className="flex items-center gap-2">
                  <legend className="sr-only">Format de la diapositive</legend>
                  <span className="text-xs font-medium text-muted-foreground">Format</span>
                  {SLIDE_ASPECT_IDS.map((value) => (
                    <Button
                      key={value}
                      size="sm"
                      variant={aspect === value ? "secondary" : "ghost"}
                      aria-pressed={aspect === value}
                      title={aspectLabel(value)}
                      onClick={() => changeAspect(value)}
                    >
                      {value}
                    </Button>
                  ))}
                </fieldset>
                <fieldset className="flex items-center gap-2">
                  <legend className="sr-only">Thème de la présentation</legend>
                  <span className="text-xs font-medium text-muted-foreground">Thème</span>
                  {SLIDE_THEME_IDS.map((value) => (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={theme === value}
                      title={themeLabel(value)}
                      onClick={() => changeTheme(value)}
                      className={cn(
                        "size-6 rounded-md border transition-shadow",
                        themeSwatchClass(value),
                        theme === value ? "ring-2 ring-ring" : "hover:ring-1 hover:ring-ring",
                      )}
                    >
                      <span className="sr-only">{themeLabel(value)}</span>
                    </button>
                  ))}
                </fieldset>
              </div>
            ) : null}

            <SlideCanvas
              slide={current}
              fileId={fileId}
              interactive={canEdit}
              selectedElementKey={selectedElementKey}
              onSelectElement={setSelectedElementKey}
              onGeometryChange={updateElement}
              aspect={aspect}
              theme={theme}
            />
          </div>

          <aside className="flex w-full shrink-0 flex-col gap-3 rounded-xl border border-border bg-card p-3 lg:w-60 print-hide">
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

            <SlideNotesField
              slide={current}
              index={selectedSlide}
              canEdit={canEdit}
              onNotesChange={(notes) =>
                mutateSlide(selectedSlide, (slide) => ({ ...slide, notes }))
              }
            />

            <div className="border-t border-border pt-3">
              {selectedElement && canEdit ? (
                <div className="flex flex-col gap-2">
                  <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
                    Élément sélectionné
                  </p>
                  {selectedElement.kind === "image" ? (
                    <p className="text-sm font-medium">Image</p>
                  ) : null}
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
        </section>
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

      <Dialog open={imageOpen} onClose={() => setImageOpen(false)} title="Ajouter une image">
        <div className="flex flex-col gap-3">
          <input
            type="file"
            accept="image/*"
            aria-label="Fichier image"
            disabled={imageBusy}
            onChange={(event) => void onImageSelected(event)}
            className="text-sm"
          />
          <p className="text-xs text-muted-foreground">
            PNG, JPEG, WebP, GIF ou AVIF — 8 Mo maximum.
          </p>
          {imageBusy ? <p className="text-xs text-muted-foreground">Téléversement…</p> : null}
          {imageError ? <p className="text-xs text-destructive">{imageError}</p> : null}
        </div>
      </Dialog>

      {presenting ? (
        <div
          ref={stageRef}
          className="fixed inset-0 z-50 flex flex-col bg-rail text-rail-foreground"
        >
          {/* Avancement annoncé aux lecteurs d'écran et visible en fond de barre. */}
          <div
            role="progressbar"
            aria-label="Avancement de la présentation"
            aria-valuenow={presentationProgress(presentIndex, slides.length)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuetext={presentationLabel(presentIndex, slides.length)}
            className="h-0.5 w-full bg-rail-active"
          >
            <div
              className="h-full bg-primary transition-[width] duration-200"
              style={{ width: `${presentationProgress(presentIndex, slides.length)}%` }}
            />
          </div>
          <div className="flex flex-wrap items-center gap-2 px-4 py-2 text-sm">
            <span className="tabular-nums">
              {presentIndex + 1} / {slides.length}
            </span>
            <span className="text-rail-foreground/70">{presentationSummary(slides.length)}</span>
            {slides[presentIndex]?.title.trim() ? (
              <span className="max-w-48 truncate text-rail-foreground/70">
                {slides[presentIndex]?.title}
              </span>
            ) : null}
            <span className="tabular-nums text-rail-foreground/70">
              <span className="sr-only">Temps écoulé : </span>
              {formatElapsed(elapsed)}
            </span>
            <Button
              size="sm"
              variant="ghost"
              className="ml-2 text-rail-foreground hover:bg-rail-active hover:text-rail-foreground"
              aria-expanded={notesOpen}
              aria-label={
                notesOpen
                  ? "Masquer les notes du présentateur"
                  : "Afficher les notes du présentateur"
              }
              onClick={() => setNotesOpen((open) => !open)}
            >
              Notes
            </Button>
            <button
              type="button"
              className="ml-auto rounded-md px-2 py-1 hover:bg-rail-active focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => {
                setPresenting(false);
                setAnnouncement(presentationExitMessage());
              }}
            >
              ✕ Quitter (Échap)
            </button>
          </div>
          <div className="flex flex-1 items-center justify-center gap-4 overflow-auto p-6">
            <div
              className={cn(
                "w-full",
                notesOpen ? "max-w-3xl" : "max-w-5xl",
                // Le canevas se remplit l'écran en plein écran, sans dépasser.
                "max-h-full",
              )}
            >
              {slides[presentIndex] ? (
                <SlideCanvas
                  slide={slides[presentIndex]}
                  fileId={fileId}
                  aspect={aspect}
                  theme={theme}
                />
              ) : null}
            </div>
            {notesOpen && slides[presentIndex] ? (
              <PresenterNotes
                slide={slides[presentIndex]}
                index={presentIndex}
                id="presenter-notes"
              />
            ) : null}
          </div>
          <p className="px-4 text-center text-[11px] text-rail-foreground/70">
            {presentationHelp()}
          </p>
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

      {/* Région live : changements de diapositive et déplacements annoncés. */}
      <p role="status" aria-live="polite" className="sr-only print-hide">
        {announcement}
      </p>

      {/* Racine d'impression : toutes les diapositives, une page chacune.
          Portal vers <body> pour échapper aux conteneurs défilants. */}
      {printToken > 0
        ? createPortal(
            <div id="slides-print-root">
              {slides.map((slide) => (
                <div key={slide.key} className="print-slide">
                  <SlideCanvas slide={slide} fileId={fileId} aspect={aspect} theme={theme} />
                </div>
              ))}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
