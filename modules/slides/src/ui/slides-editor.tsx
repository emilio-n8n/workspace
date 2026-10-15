// biome-ignore-all lint/correctness/useExhaustiveDependencies: effets volontairement liés aux seules valeurs stables (handlers recréés à chaque rendu) — arbitrage documenté dans la refonte Slides.
import { Alert, Button, cn, Dialog, Input, LoadingState, Menu } from "@workspace/ui";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  clamp,
  cloneSlide,
  type EditorElement,
  type EditorSlide,
  mergeSavedIds,
  round1,
  slideTitle,
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
  type ArrangeMode,
  type ArrangePatch,
  alignPatches,
  distributePatches,
} from "../slide-arrange.ts";
import {
  aspectLabel,
  conversionSummary,
  convertScene,
  DEFAULT_SLIDE_ASPECT,
  normalizeAspect,
  SLIDE_ASPECT_IDS,
  type SlideAspectId,
} from "../slide-aspect.ts";
import { HISTORY_LIMIT } from "../slide-history.ts";
import {
  layoutElements,
  layoutHint,
  layoutLabel,
  SLIDE_LAYOUT_IDS,
  type SlideLayoutId,
} from "../slide-layouts.ts";
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
  isShapeKind,
  SLIDE_SHAPE_KINDS,
  type SlideShapeKind,
  shapeGeometry,
  shapeLabel,
  shapeVariant,
} from "../slide-shapes.ts";
import {
  bumpFontSize,
  isBulletList,
  isNumberedList,
  SLIDE_TEXT_COLOR_IDS,
  type SlideTextColor,
  textColorLabel,
  toggleBulletList,
  toggleNumberedList,
} from "../slide-text.ts";
import {
  DEFAULT_SLIDE_THEME,
  normalizeTheme,
  SLIDE_THEME_IDS,
  type SlideThemeId,
  themeLabel,
  themeSwatchClass,
} from "../slide-theme.ts";
import {
  DEFAULT_SLIDE_TRANSITION,
  normalizeTransition,
  normalizeTransitionMs,
  SLIDE_TRANSITION_IDS,
  type SlideTransitionId,
  transitionDuration,
  transitionFrames,
  transitionHint,
  transitionLabel,
  transitionSummary,
} from "../slide-transition.ts";
import {
  clampZoom,
  fitZoomPercent,
  nextZoom,
  SLIDE_BASE_WIDTH,
  SLIDE_ZOOM_PRESETS,
} from "../slide-zoom.ts";
import {
  canMoveZ,
  Z_MOVE_ORDER,
  type ZMove,
  zMoveForKey,
  zMoveLabel,
  zOrderAnnouncement,
  zOrderMove,
} from "../slide-zorder.ts";
import { SlideCanvas } from "./slide-canvas.tsx";
import { SlideFilmstrip } from "./slide-filmstrip.tsx";
import { PresenterNotes, SlideNotesField } from "./slide-notes-panel.tsx";
import { useEditorFocus } from "./use-editor-focus.ts";

type SaveStatus = "idle" | "saving" | "saved" | "error";

/** Fenêtre de fusion des actions répétées (frappe, flèches) dans l'historique. */
const COALESCE_MS = 600;

/** Géométrie d'une zone de texte insérée librement (centrée sur la diapositive). */
const FREE_TEXT = { w: 40, h: 12, x: 30, y: 44 };

/** Décalage appliqué à une copie d'élément (duplication, collage), en %. */
const COPY_OFFSET = 2;

/** Libellé d'un élément pour les annonces vocales et les messages. */
function elementLabel(element: EditorElement): string {
  if (element.kind === "image") return "Image";
  if (isShapeKind(element.kind)) return shapeLabel(element.kind);
  return "Texte";
}

/**
 * Joue la transition choisie sur un nœud (scène de présentation ou canevas
 * d'aperçu), en respectant la préférence « animations réduites » : aucune
 * image-clé ni durée dans ce cas, donc aucun mouvement.
 */
function animateTransition(
  node: HTMLElement | null,
  transition: SlideTransitionId,
  durationMs: number,
): void {
  if (!node) return;
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  const frames = transitionFrames(transition, { reduceMotion: reduce });
  const duration = transitionDuration(transition, durationMs, { reduceMotion: reduce });
  if (!frames || duration === 0) return;
  node.animate([frames.from, frames.to], { duration, easing: "ease-out", fill: "both" });
}

/** Modèle d'élément libre (texte ou forme) : mêmes valeurs par défaut partout. */
function freeElement(
  kind: EditorElement["kind"],
  geometry: { x: number; y: number; w: number; h: number },
  text: string,
): EditorElement {
  return {
    key: crypto.randomUUID(),
    kind,
    ...geometry,
    text,
    fontSize: 24,
    bold: false,
    italic: false,
    underline: false,
    textColor: "default",
    placeholder: null,
    align: "left",
  };
}

/** Classe commune des sélecteurs de la barre d'outils. */
const TOOLBAR_SELECT_CLASS =
  "h-8 rounded-md border border-input bg-background px-1.5 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** Instantané complet pour l'historique : scène, sélection et réglages. */
type EditorSnapshot = {
  slides: EditorSlide[];
  selectedSlide: number;
  selectedKeys: string[];
  aspect: SlideAspectId;
  theme: SlideThemeId;
  transition: SlideTransitionId;
  transitionMs: number;
};

/**
 * Éditeur de présentation, organisé comme un produit fini : historique
 * annuler/rétablir, barre d'outils unique (zoom ajustable, insertion, mise en
 * forme contextuelle, transitions), colonne de diapositives numérotées,
 * plan de travail avec guides aimantés et sélection multiple, panneau de mise
 * en forme (élément, disposition d'objets, diapositive), notes en pied et
 * mode présentation plein écran.
 */
export function SlidesEditor({ fileId }: { fileId: string }) {
  const [title, setTitle] = useState("");
  const [canEdit, setCanEdit] = useState(false);
  const [aspect, setAspect] = useState<SlideAspectId>(DEFAULT_SLIDE_ASPECT);
  const [theme, setTheme] = useState<SlideThemeId>(DEFAULT_SLIDE_THEME);
  const [transition, setTransition] = useState<SlideTransitionId>(DEFAULT_SLIDE_TRANSITION);
  const [transitionMs, setTransitionMs] = useState(400);
  const [slides, setSlides] = useState<EditorSlide[]>([]);
  const [selectedSlide, setSelectedSlide] = useState(0);
  /** Clés des éléments sélectionnés (sélection multiple possible). */
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  /** Élément dont le texte est édité en place sur la diapositive. */
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [loading, setLoading] = useState(true);
  const [presenting, setPresenting] = useState(false);
  const [presentIndex, setPresentIndex] = useState(0);
  /** Vrai quand le mode présentation a demandé le plein écran. */
  const fullscreenRequestedRef = useRef(false);
  const stageRef = useRef<HTMLDivElement>(null);
  /** Scène de présentation : cible de l'animation de transition. */
  const sceneRef = useRef<HTMLDivElement>(null);
  /** Canevas d'édition : cible de l'aperçu de transition. */
  const previewRef = useRef<HTMLDivElement>(null);
  /** Dernière diapositive animée en présentation (-1 : aucune session). */
  const lastAnimatedIndexRef = useRef(-1);
  const [notesOpen, setNotesOpen] = useState(false);
  /** Barre de notes du présentateur : visible, repliable, fermable. */
  const [notesVisible, setNotesVisible] = useState(true);
  const [elapsed, setElapsed] = useState(0);
  const [printToken, setPrintToken] = useState(0);
  const [imageOpen, setImageOpen] = useState(false);
  const [imageBusy, setImageBusy] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  /** Zone image en attente d'un fichier (remplacée par l'image choisie). */
  const [pendingImageKey, setPendingImageKey] = useState<string | null>(null);
  /** Dialogue de choix de mise en page d'une nouvelle diapositive. */
  const [layoutOpen, setLayoutOpen] = useState(false);
  /** Zoom d'affichage du canevas : ajusté à la fenêtre par défaut. */
  const [zoom, setZoom] = useState(100);
  const [fitZoom, setFitZoom] = useState(true);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const slidesRef = useRef<EditorSlide[]>([]);
  const canEditRef = useRef(false);
  /** Vrai quand au moins un élément est sélectionné : les flèches le déplacent. */
  const elementSelectedRef = useRef(false);
  const revisionRef = useRef(1);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Historique annuler/rétablir : instantanés empilés, bornés. */
  const pastRef = useRef<EditorSnapshot[]>([]);
  const futureRef = useRef<EditorSnapshot[]>([]);
  /** Re-rend les boutons Annuler/Rétablir quand les piles changent. */
  const [historyVersion, setHistoryVersion] = useState(0);
  /** Dernière action poussée : fusionne les répétitions (frappe, flèches). */
  const lastPushRef = useRef<{ kind: string; at: number } | null>(null);
  /** Presse-papiers interne des éléments (Ctrl+C / Ctrl+V). */
  const clipboardRef = useRef<EditorElement[]>([]);
  /** Mode concentration : masque le rail et la barre haute de la suite. */
  const { active: focusActive, toggle: toggleFocus, exit: exitFocus } = useEditorFocus();

  useEffect(() => {
    slidesRef.current = slides;
  }, [slides]);

  useEffect(() => {
    elementSelectedRef.current = selectedKeys.length > 0;
  }, [selectedKeys]);

  const load = useCallback(async () => {
    try {
      const data = await getPresentationFn({ data: { fileId } });
      setTitle(data.title);
      setCanEdit(data.canEdit);
      canEditRef.current = data.canEdit;
      setAspect(normalizeAspect(data.aspect));
      setTheme(normalizeTheme(data.theme));
      setTransition(normalizeTransition(data.transition));
      setTransitionMs(normalizeTransitionMs(data.transitionMs));
      revisionRef.current = data.revision;
      const loaded = toEditor(data.slides);
      slidesRef.current = loaded;
      setSlides(loaded);
      // Un rechargement repart d'un historique vierge : rien à annuler avant.
      pastRef.current = [];
      futureRef.current = [];
      lastPushRef.current = null;
      setHistoryVersion((version) => version + 1);
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

  // Zoom « ajuster à la fenêtre » : recalculé quand la zone de travail change
  // de largeur (panneau ouvert, fenêtre redimensionnée).
  useEffect(() => {
    if (!fitZoom) return;
    const node = workspaceRef.current;
    if (!node) return;
    const update = () => setZoom(fitZoomPercent(node.clientWidth));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, [fitZoom]);

  // -------------------------------------------------------------------------
  // Historique annuler / rétablir
  // -------------------------------------------------------------------------

  /** Instantané de l'état courant, capturé avant chaque action. */
  function capture(): EditorSnapshot {
    return {
      slides: slidesRef.current,
      selectedSlide,
      selectedKeys,
      aspect,
      theme,
      transition,
      transitionMs,
    };
  }

  /** Empile l'état courant avant une action ; les répétitions se fusionnent. */
  function pushHistory(kind: string) {
    const now = Date.now();
    const last = lastPushRef.current;
    if (last && last.kind === kind && now - last.at < COALESCE_MS) {
      last.at = now;
      return;
    }
    pastRef.current = [...pastRef.current, capture()].slice(-HISTORY_LIMIT);
    futureRef.current = [];
    lastPushRef.current = { kind, at: now };
    setHistoryVersion((version) => version + 1);
  }

  /** Remet un instantané en place ; les réglages changés sont re-persistés. */
  function restore(snapshot: EditorSnapshot) {
    slidesRef.current = snapshot.slides;
    setSlides(snapshot.slides);
    setSelectedSlide(snapshot.selectedSlide);
    setSelectedKeys(snapshot.selectedKeys);
    setEditingKey(null);
    if (snapshot.aspect !== aspect) {
      setAspect(snapshot.aspect);
      void persistSetting({ aspect: snapshot.aspect });
    }
    if (snapshot.theme !== theme) {
      setTheme(snapshot.theme);
      void persistSetting({ theme: snapshot.theme });
    }
    if (snapshot.transition !== transition) {
      setTransition(snapshot.transition);
      void persistSetting({ transition: snapshot.transition });
    }
    if (snapshot.transitionMs !== transitionMs) {
      setTransitionMs(snapshot.transitionMs);
      void persistSetting({ transitionMs: snapshot.transitionMs });
    }
    schedule();
  }

  function doUndo() {
    const previous = pastRef.current[pastRef.current.length - 1];
    if (!previous) return;
    pastRef.current = pastRef.current.slice(0, -1);
    futureRef.current = [capture(), ...futureRef.current].slice(0, HISTORY_LIMIT);
    restore(previous);
    setHistoryVersion((version) => version + 1);
    setAnnouncement("Modification annulée.");
  }

  function doRedo() {
    const [next, ...rest] = futureRef.current;
    if (!next) return;
    futureRef.current = rest;
    pastRef.current = [...pastRef.current, capture()].slice(-HISTORY_LIMIT);
    restore(next);
    setHistoryVersion((version) => version + 1);
    setAnnouncement("Modification rétablie.");
  }

  const canUndo = historyVersion >= 0 && pastRef.current.length > 0;
  const canRedo = historyVersion >= 0 && futureRef.current.length > 0;

  // -------------------------------------------------------------------------
  // Mutations
  // -------------------------------------------------------------------------

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
    setSelectedKeys([]);
    setEditingKey(null);
  }, []);

  /** Sélection d'un élément : simple, ou ajoutée avec Shift (multiple). */
  function selectElement(key: string | null, additive = false) {
    if (key === null) {
      setSelectedKeys([]);
      setEditingKey(null);
      return;
    }
    setSelectedKeys((current) => {
      if (!additive) return [key];
      return current.includes(key) ? current.filter((item) => item !== key) : [...current, key];
    });
  }

  /** Rectangle de sélection : la liste croisée remplace la sélection. */
  function selectMany(keys: string[]) {
    setSelectedKeys(keys);
    setEditingKey(null);
  }

  /** Entre en édition en place (double-clic, Entrée, frappe, zone vide). */
  function startEdit(key: string) {
    if (!canEditRef.current) return;
    // Instantané d'historique : toute la session de frappe s'annule d'un coup.
    pushHistory("text");
    setSelectedKeys([key]);
    setEditingKey(key);
  }

  const endEdit = useCallback(() => setEditingKey(null), []);

  /**
   * Applique le texte frappé à l'élément édité, où qu'il soit : l'édition en
   * place ne dépend pas de la diapositive courante, seulement de la clé.
   */
  const changeText = useCallback(
    (key: string, text: string) => {
      setSlides((current) =>
        current.map((slide) =>
          slide.elements.some((element) => element.key === key)
            ? {
                ...slide,
                elements: slide.elements.map((element) =>
                  element.key === key ? { ...element, text } : element,
                ),
              }
            : slide,
        ),
      );
      schedule();
    },
    [schedule],
  );

  /** Ajoute un élément à la diapositive courante et le sélectionne. */
  function appendElement(element: EditorElement) {
    mutateSlide(selectedSlide, (slide) => ({ ...slide, elements: [...slide.elements, element] }));
    setSelectedKeys([element.key]);
    setEditingKey(null);
  }

  function addText() {
    pushHistory("add-text");
    appendElement(freeElement("text", FREE_TEXT, "Texte"));
  }

  function addShape(kind: SlideShapeKind) {
    pushHistory("add-shape");
    appendElement(freeElement(kind, shapeGeometry(kind), ""));
  }

  /**
   * Téléverse l'image choisie puis l'installe : elle remplace la zone image
   * qui l'a demandée, ou s'ajoute à la diapositive courante.
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
      const target = pendingImageKey;
      pushHistory("image");
      if (target) {
        // La zone à remplir devient une image : elle garde sa place exacte.
        setSlides((current) =>
          current.map((slide, position) =>
            position === selectedSlide
              ? {
                  ...slide,
                  elements: slide.elements.map((element) =>
                    element.key === target
                      ? {
                          ...element,
                          kind: "image" as const,
                          mediaKey,
                          text: "",
                          placeholder: null,
                        }
                      : element,
                  ),
                }
              : slide,
          ),
        );
        setSelectedKeys([target]);
      } else {
        const element: EditorElement = {
          ...freeElement("image", { x: 20, y: 20, w: 30, h: 25 }, ""),
          mediaKey,
        };
        mutateSlide(selectedSlide, (slide) => ({
          ...slide,
          elements: [...slide.elements, element],
        }));
        setSelectedKeys([element.key]);
      }
      setEditingKey(null);
      setImageOpen(false);
      setPendingImageKey(null);
      setAnnouncement("Image insérée.");
    } catch (caught) {
      setImageError(caught instanceof Error ? caught.message : "Téléversement impossible.");
    } finally {
      setImageBusy(false);
    }
  }

  /** Ouvre le dialogue d'image pour remplacer une zone à remplir. */
  function requestImage(key: string) {
    setPendingImageKey(key);
    setImageError(null);
    setImageOpen(true);
  }

  function deleteSelection() {
    if (selectedKeys.length === 0) return;
    pushHistory("delete");
    setSlides((current) =>
      current.map((slide, position) =>
        position === selectedSlide
          ? {
              ...slide,
              elements: slide.elements.filter((element) => !selectedKeys.includes(element.key)),
            }
          : slide,
      ),
    );
    setSelectedKeys([]);
    setEditingKey(null);
    schedule();
    setAnnouncement(
      selectedKeys.length > 1 ? `${selectedKeys.length} éléments supprimés.` : "Élément supprimé.",
    );
  }

  /** Copies internes des éléments sélectionnés (Ctrl+C). */
  function copySelection() {
    const slide = slidesRef.current[selectedSlide];
    if (!slide) return;
    const items = slide.elements.filter((element) => selectedKeys.includes(element.key));
    if (items.length === 0) return;
    clipboardRef.current = items.map((element) => ({ ...element }));
    setAnnouncement(items.length > 1 ? `${items.length} éléments copiés.` : "Élément copié.");
  }

  /** Colle les copies décalées, sélectionnées (Ctrl+V). */
  function pasteClipboard(offset = COPY_OFFSET) {
    const items = clipboardRef.current;
    if (!canEdit || items.length === 0) return;
    pushHistory("paste");
    const clones = items.map((element) => ({
      ...element,
      key: crypto.randomUUID(),
      id: undefined,
      x: round1(clamp(element.x + offset, 0, 100 - element.w)),
      y: round1(clamp(element.y + offset, 0, 100 - element.h)),
    }));
    mutateSlide(selectedSlide, (slide) => ({
      ...slide,
      elements: [...slide.elements, ...clones],
    }));
    setSelectedKeys(clones.map((clone) => clone.key));
    setEditingKey(null);
    setAnnouncement(clones.length > 1 ? `${clones.length} éléments collés.` : "Élément collé.");
  }

  /** Duplique la sélection sur place, décalée (Ctrl+D). */
  function duplicateSelection() {
    if (selectedKeys.length === 0) return;
    copySelection();
    pasteClipboard(COPY_OFFSET + 1);
    setAnnouncement("Sélection dupliquée.");
  }

  /** Déplace tous les éléments sélectionnés de un point (cinq avec Maj), en %. */
  function nudgeSelection(dx: number, dy: number) {
    if (selectedKeys.length === 0) return;
    pushHistory("nudge");
    setSlides((current) =>
      current.map((slide, position) =>
        position === selectedSlide
          ? {
              ...slide,
              elements: slide.elements.map((element) =>
                selectedKeys.includes(element.key)
                  ? {
                      ...element,
                      x: round1(clamp(element.x + dx, 0, 100 - element.w)),
                      y: round1(clamp(element.y + dy, 0, 100 - element.h)),
                    }
                  : element,
              ),
            }
          : slide,
      ),
    );
    schedule();
  }

  /** Applique une mise en forme texte à l'élément unique sélectionné. */
  function setFormat(patch: Partial<ElementView>, kind: string) {
    const key = selectedKeys.length === 1 ? selectedKeys[0] : undefined;
    if (!key) return;
    pushHistory(kind);
    updateElement(key, patch);
  }

  /** Change la variante de la forme sélectionnée. */
  function setShape(kind: SlideShapeKind) {
    const key = selectedKeys.length === 1 ? selectedKeys[0] : undefined;
    if (!key) return;
    pushHistory("shape");
    updateElement(key, { kind });
  }

  /** Change la taille du texte de l'élément sélectionné. */
  function setFontSize(next: number) {
    const key = selectedKeys.length === 1 ? selectedKeys[0] : undefined;
    if (!key) return;
    pushHistory("size");
    updateElement(key, { fontSize: clamp(next, 8, 200) });
  }

  /** Applique des patchs de disposition (alignement, répartition). */
  function applyArrange(patches: ArrangePatch[]) {
    if (patches.length === 0) return;
    pushHistory("arrange");
    const byKey = new Map(patches.map((patch) => [patch.key, patch] as const));
    setSlides((current) =>
      current.map((slide, position) =>
        position === selectedSlide
          ? {
              ...slide,
              elements: slide.elements.map((element) => {
                const patch = byKey.get(element.key);
                return patch ? { ...element, x: patch.x, y: patch.y } : element;
              }),
            }
          : slide,
      ),
    );
    schedule();
    setAnnouncement("Disposition mise à jour.");
  }

  /** Cibles de disposition : les éléments sélectionnés de la diapositive. */
  function arrangeTargets() {
    const slide = slidesRef.current[selectedSlide];
    if (!slide) return [];
    return slide.elements
      .filter((element) => selectedKeys.includes(element.key))
      .map((element) => ({
        key: element.key,
        box: { x: element.x, y: element.y, w: element.w, h: element.h },
      }));
  }

  function arrangeSelection(mode: ArrangeMode) {
    applyArrange(alignPatches(arrangeTargets(), mode));
  }

  function distributeSelection(axis: "x" | "y") {
    const patches = distributePatches(arrangeTargets(), axis);
    if (patches.length === 0) {
      setAnnouncement("La répartition demande au moins trois éléments.");
      return;
    }
    applyArrange(patches);
  }

  /** Ajoute une diapositive avec la mise en page choisie. */
  function addSlide(layout: SlideLayoutId) {
    pushHistory("add-slide");
    const elements: EditorElement[] = layoutElements(layout).map((zone) => ({
      key: crypto.randomUUID(),
      kind: "text",
      x: zone.x,
      y: zone.y,
      w: zone.w,
      h: zone.h,
      text: "",
      fontSize: zone.fontSize,
      bold: zone.bold,
      italic: false,
      underline: false,
      textColor: "default",
      placeholder: zone.placeholder,
      align: zone.align,
    }));
    setSlides((current) => [
      ...current,
      {
        key: crypto.randomUUID(),
        title: `Diapositive ${current.length + 1}`,
        notes: "",
        elements,
      },
    ]);
    setSelectedSlide(slides.length);
    setSelectedKeys([]);
    setEditingKey(null);
    setAnnouncement(`Diapositive ajoutée — mise en page « ${layoutLabel(layout)} ».`);
    schedule();
  }

  function duplicateSlide() {
    const index = selectedSlide;
    const source = slides[index];
    if (!source) return;
    pushHistory("duplicate-slide");
    const name = slideTitle(source, index);
    const copy = cloneSlide(source, `${name} (copie)`);
    const insertAt = index + 1;
    setSlides((current) => {
      const next = [...current];
      next.splice(insertAt, 0, copy);
      return next;
    });
    setSelectedSlide(insertAt);
    setSelectedKeys([]);
    setEditingKey(null);
    schedule();
    setAnnouncement(`Diapositive « ${name} » dupliquée.`);
  }

  function deleteSlide() {
    const index = selectedSlide;
    const slide = slides[index];
    if (!slide || slides.length <= 1) return;
    pushHistory("delete-slide");
    const name = slideTitle(slide, index);
    setSlides((current) => current.filter((_, position) => position !== index));
    setSelectedSlide(Math.max(0, index - 1));
    setSelectedKeys([]);
    setEditingKey(null);
    schedule();
    setAnnouncement(`Diapositive « ${name} » supprimée — annulable.`);
  }

  /** Change l'ordre z de l'élément sélectionné (avant-plan / arrière-plan). */
  function zOrderSelected(move: ZMove) {
    const key = selectedKeys[0];
    const slide = slidesRef.current[selectedSlide];
    const element = slide?.elements.find((item) => item.key === key);
    if (!key || !element || selectedKeys.length !== 1) return;
    pushHistory("zorder");
    mutateSlide(selectedSlide, (current) => {
      const position = current.elements.findIndex((item) => item.key === key);
      return { ...current, elements: zOrderMove(current.elements, position, move) };
    });
    setAnnouncement(zOrderAnnouncement(move, elementLabel(element)));
  }

  /**
   * Enregistre un réglage de présentation (format, design, transition) de
   * façon optimiste : l'interface change tout de suite, le serveur confirme,
   * et un échec rend sa valeur précédente au réglage.
   */
  async function persistSetting(patch: {
    aspect?: SlideAspectId;
    theme?: SlideThemeId;
    transition?: SlideTransitionId;
    transitionMs?: number;
  }) {
    if (!canEditRef.current) return;
    try {
      const saved = await updatePresentationSettingFn({ data: { fileId, ...patch } });
      setAspect(normalizeAspect(saved.aspect));
      setTheme(normalizeTheme(saved.theme));
      setTransition(normalizeTransition(saved.transition));
      setTransitionMs(normalizeTransitionMs(saved.transitionMs));
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Réglage impossible.");
      // Retour à la valeur serveur : l'interface ne ment jamais longtemps.
      void load();
    }
  }

  function changeTransition(next: SlideTransitionId) {
    if (next === transition || !canEdit) return;
    pushHistory("transition");
    setTransition(next);
    setAnnouncement(
      next === "none"
        ? "Transitions désactivées."
        : `Transition « ${transitionLabel(next)} » : ${transitionHint(next)}`,
    );
    void persistSetting({ transition: next });
  }

  function changeTransitionMs(next: number) {
    if (!canEdit) return;
    const value = normalizeTransitionMs(next);
    if (value === transitionMs) return;
    pushHistory("transition-ms");
    setTransitionMs(value);
    void persistSetting({ transitionMs: value });
  }

  /**
   * Change le format de la diapositive et convertit la scène : les positions
   * sont recalculées par la logique pure de `slide-aspect.ts`, puis
   * enregistrées par l'autosave (les éléments font partie du même état) et le
   * réglage par son propre appel.
   */
  function changeAspect(next: SlideAspectId) {
    if (next === aspect || !canEdit) return;
    pushHistory("aspect");
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
    pushHistory("theme");
    setTheme(next);
    setAnnouncement(`Design « ${themeLabel(next)} » appliqué à la présentation.`);
    void persistSetting({ theme: next });
  }

  /** Déplacement d'une diapositive : la sélection la suit. */
  function moveSlideTo(from: number, to: number) {
    if (from === to) return;
    pushHistory("move-slide");
    setSlides((current) => reorderSlides(current, from, to));
    setSelectedSlide(to);
    setSelectedKeys([]);
    setEditingKey(null);
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

  /** Applique le choix du sélecteur de zoom (« fit » = ajuster à la fenêtre). */
  function onZoomChange(value: string) {
    if (value === "fit") {
      setFitZoom(true);
      return;
    }
    setFitZoom(false);
    setZoom(clampZoom(Number(value)));
  }

  /** Monte ou descend d'un niveau de zoom ; quitte le mode « ajuster ». */
  function stepZoom(direction: -1 | 1) {
    setFitZoom(false);
    setZoom((current) => nextZoom(current, direction));
  }

  // -------------------------------------------------------------------------
  // Clavier
  // -------------------------------------------------------------------------

  // Sortie du mode concentration au clavier : Échap le referme avant toute
  // autre action (la sélection garde le sien, la saisie son comportement natif).
  useEffect(() => {
    if (!focusActive) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const target = event.target as Element | null;
      if (isTypingTarget(target) || isInsideModal(target)) return;
      exitFocus();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [focusActive, exitFocus]);

  // Navigation clavier entre diapositives, partout dans l'éditeur : flèches,
  // Page préc./suiv., Début/Fin. Les champs de saisie et les fenêtres modales
  // gardent le clavier (la colonne traite ses propres flèches), et un élément
  // sélectionné garde les flèches pour son propre déplacement.
  useEffect(() => {
    if (presenting) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as Element | null;
      if (isTypingTarget(target) || isInsideModal(target)) return;
      if (elementSelectedRef.current && event.key.startsWith("Arrow")) return;
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

  // Raccourcis d'outil, toujours disponibles hors saisie : annuler/rétablir,
  // copier/coller/dupliquer. Les champs de saisie gardent leurs raccourcis
  // natifs (annuler une frappe dans le texte en place).
  useEffect(() => {
    if (presenting || !canEdit) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as Element | null;
      if (isTypingTarget(target) || isInsideModal(target)) return;
      if (!(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      if (key === "z") {
        event.preventDefault();
        if (event.shiftKey) doRedo();
        else doUndo();
        return;
      }
      if (key === "y") {
        event.preventDefault();
        doRedo();
        return;
      }
      if (key === "d" && !event.shiftKey) {
        event.preventDefault();
        duplicateSelection();
        return;
      }
      if (key === "c") {
        copySelection();
        return;
      }
      if (key === "v" && clipboardRef.current.length > 0) {
        event.preventDefault();
        pasteClipboard();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [presenting, canEdit, doUndo, doRedo, duplicateSelection, copySelection, pasteClipboard]);

  // Clavier sur la sélection : ordre z (Ctrl/Cmd + ↑/↓, Maj pour les
  // extrémités, un seul élément), déplacement aux flèches (Maj : pas de 5 %),
  // Entrée pour modifier en place, Suppr pour supprimer, Échap pour
  // désélectionner. Actif seulement hors saisie, fenêtre modale et présentation.
  useEffect(() => {
    if (presenting || !canEdit || selectedKeys.length === 0) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as Element | null;
      if (isTypingTarget(target) || isInsideModal(target)) return;
      if (target?.closest("button")) return;
      const slide = slidesRef.current[selectedSlide];
      const primary = slide?.elements.find((item) => item.key === selectedKeys[0]);
      const move = primary
        ? zMoveForKey({
            key: event.key,
            ctrlKey: event.ctrlKey,
            metaKey: event.metaKey,
            shiftKey: event.shiftKey,
            altKey: event.altKey,
          })
        : null;
      if (move && selectedKeys.length === 1 && primary) {
        event.preventDefault();
        pushHistory("zorder");
        setSlides((current) =>
          current.map((item, position) =>
            position === selectedSlide
              ? {
                  ...item,
                  elements: zOrderMove(
                    item.elements,
                    item.elements.findIndex((candidate) => candidate.key === primary.key),
                    move,
                  ),
                }
              : item,
          ),
        );
        setAnnouncement(zOrderAnnouncement(move, elementLabel(primary)));
        schedule();
        return;
      }
      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        deleteSelection();
        return;
      }
      if (event.key === "Enter" && selectedKeys.length === 1 && primary) {
        event.preventDefault();
        if (primary.placeholder === "image") requestImage(primary.key);
        else if (primary.kind !== "image") startEdit(primary.key);
        return;
      }
      // Frappe directe : une lettre sur un élément texte sélectionné ouvre
      // l'édition en place et commence le mot — le geste d'un vrai outil.
      if (
        selectedKeys.length === 1 &&
        primary &&
        primary.kind === "text" &&
        primary.placeholder !== "image" &&
        event.key.length === 1 &&
        event.key !== " " &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey
      ) {
        event.preventDefault();
        const existing = primary.text.trim().length === 0 ? "" : primary.text;
        startEdit(primary.key);
        updateElement(primary.key, { text: existing + event.key });
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setSelectedKeys([]);
        return;
      }
      const step = event.shiftKey ? 5 : 1;
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        nudgeSelection(-step, 0);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        nudgeSelection(step, 0);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        nudgeSelection(0, -step);
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        nudgeSelection(0, step);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    presenting,
    canEdit,
    selectedKeys,
    selectedSlide,
    schedule,
    startEdit,
    deleteSelection,
    nudgeSelection,
    pushHistory,
    requestImage,
    zOrderSelected,
  ]);

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

  // Transitions : chaque changement de diapositive en présentation joue la
  // transition choisie ; la toute première diapositive n'est jamais animée.
  useEffect(() => {
    if (!presenting) {
      lastAnimatedIndexRef.current = -1;
      return;
    }
    if (lastAnimatedIndexRef.current === -1) {
      lastAnimatedIndexRef.current = presentIndex;
      return;
    }
    if (lastAnimatedIndexRef.current === presentIndex) return;
    lastAnimatedIndexRef.current = presentIndex;
    animateTransition(sceneRef.current, transition, transitionMs);
  }, [presenting, presentIndex, transition, transitionMs]);

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

  // -------------------------------------------------------------------------
  // Rendu
  // -------------------------------------------------------------------------

  const current = slides[selectedSlide] ?? null;
  const selectedElements =
    current?.elements.filter((element) => selectedKeys.includes(element.key)) ?? [];
  const singleSelection = selectedKeys.length === 1 ? (selectedElements[0] ?? null) : null;
  const selectedElementIndex = singleSelection
    ? (current?.elements.findIndex((element) => element.key === singleSelection.key) ?? -1)
    : -1;
  const selectedShape =
    singleSelection && isShapeKind(singleSelection.kind) ? singleSelection.kind : null;
  const elementCount = current?.elements.length ?? 0;
  /** Élément porteur de texte (tout sauf une image) : cible du formatage. */
  const textElement = singleSelection && singleSelection.kind !== "image" ? singleSelection : null;

  const statusLabel =
    status === "saving"
      ? "Enregistrement…"
      : status === "saved"
        ? "Enregistré"
        : status === "error"
          ? "Erreur de sauvegarde"
          : "";

  return (
    <div className="slides-editor flex h-full min-h-0 flex-1 flex-col">
      <header className="flex flex-wrap items-center gap-2 border-b border-border bg-card px-3 py-2 print-hide">
        <a
          href="/"
          className="rounded-md px-1.5 py-1 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
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
          {!canEdit ? (
            <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">
              Lecture seule
            </span>
          ) : null}
          {canEdit ? (
            <fieldset className="flex items-center gap-1" aria-label="Design de la présentation">
              <legend className="sr-only">Design de la présentation</legend>
              {SLIDE_THEME_IDS.map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={theme === value}
                  title={`Design ${themeLabel(value)}`}
                  onClick={() => changeTheme(value)}
                  className={cn(
                    "size-5 rounded-full border transition-shadow",
                    themeSwatchClass(value),
                    theme === value ? "ring-2 ring-ring" : "hover:ring-1 hover:ring-ring",
                  )}
                >
                  <span className="sr-only">{`Design ${themeLabel(value)}`}</span>
                </button>
              ))}
            </fieldset>
          ) : null}
          <Button
            size="sm"
            variant="ghost"
            aria-pressed={notesVisible}
            aria-label="Notes du présentateur"
            title="Afficher ou masquer les notes du présentateur"
            disabled={!current}
            onClick={() => setNotesVisible((visible) => !visible)}
          >
            Notes
          </Button>
          <Button
            size="sm"
            variant="ghost"
            aria-pressed={focusActive}
            aria-label={
              focusActive ? "Afficher les barres de la suite" : "Masquer les barres de la suite"
            }
            title={
              focusActive ? "Afficher les barres de la suite" : "Masquer les barres de la suite"
            }
            onClick={toggleFocus}
          >
            ⛶
          </Button>
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

      {error ? (
        <div className="px-3 pt-3 print-hide">
          <Alert tone="danger">{error}</Alert>
        </div>
      ) : null}

      {loading ? (
        <LoadingState className="py-12" label="Chargement de la présentation…" />
      ) : current ? (
        <>
          <div
            role="toolbar"
            aria-label="Outils de la présentation"
            className="flex flex-nowrap items-center gap-0.5 overflow-x-auto border-b border-border bg-card px-2 py-1 print-hide [&>*]:shrink-0"
          >
            <Button
              size="sm"
              variant="ghost"
              aria-label="Annuler"
              title="Annuler (Ctrl+Z)"
              disabled={!canEdit || !canUndo}
              onClick={doUndo}
            >
              ↺
            </Button>
            <Button
              size="sm"
              variant="ghost"
              aria-label="Rétablir"
              title="Rétablir (Ctrl+Maj+Z)"
              disabled={!canEdit || !canRedo}
              onClick={doRedo}
            >
              ↻
            </Button>
            <span aria-hidden className="mx-1 h-4 w-px shrink-0 bg-border" />

            {/* Zoom : ajuster à la fenêtre ou un niveau précis. */}
            <select
              aria-label="Zoom"
              value={fitZoom ? "fit" : String(zoom)}
              onChange={(event) => onZoomChange(event.target.value)}
              className={TOOLBAR_SELECT_CLASS}
            >
              <option value="fit">{`Ajuster (${zoom} %)`}</option>
              {!fitZoom && !(SLIDE_ZOOM_PRESETS as readonly number[]).includes(zoom) ? (
                <option value={zoom}>{zoom} %</option>
              ) : null}
              {SLIDE_ZOOM_PRESETS.map((preset) => (
                <option key={preset} value={preset}>
                  {preset} %
                </option>
              ))}
            </select>
            <Button
              size="sm"
              variant="ghost"
              aria-label="Réduire le zoom"
              onClick={() => stepZoom(-1)}
            >
              −
            </Button>
            <Button
              size="sm"
              variant="ghost"
              aria-label="Augmenter le zoom"
              onClick={() => stepZoom(1)}
            >
              ＋
            </Button>
            <span aria-hidden className="mx-1 h-4 w-px shrink-0 bg-border" />

            {/* Insertion : les gestes de base, comme un outil de présentation. */}
            <Button
              size="sm"
              variant="ghost"
              className="font-medium"
              aria-label="Nouvelle diapositive"
              disabled={!canEdit}
              onClick={() => setLayoutOpen(true)}
            >
              ＋ Diapositive
            </Button>
            <Button
              size="sm"
              variant="ghost"
              aria-label="Ajouter une zone de texte"
              disabled={!canEdit}
              onClick={addText}
            >
              Texte
            </Button>
            <Button
              size="sm"
              variant="ghost"
              aria-label="Ajouter une image"
              disabled={!canEdit}
              onClick={() => {
                setPendingImageKey(null);
                setImageError(null);
                setImageOpen(true);
              }}
            >
              Image
            </Button>
            <Menu
              label="Formes"
              align="start"
              triggerClassName="h-8 border-transparent bg-transparent px-2 font-medium hover:bg-muted focus-visible:ring-offset-0"
              items={SLIDE_SHAPE_KINDS.map((kind) => ({
                id: kind,
                label: shapeLabel(kind),
                disabled: !canEdit,
                onSelect: () => addShape(kind),
              }))}
            />

            {textElement ? (
              <>
                <span aria-hidden className="mx-1 h-4 w-px shrink-0 bg-border" />
                {/* Mise en forme contextuelle : l'outil suit l'élément cliqué. */}
                <Button
                  size="sm"
                  variant={textElement?.bold ? "secondary" : "ghost"}
                  aria-label="Gras"
                  aria-pressed={textElement?.bold === true}
                  disabled={!canEdit || !textElement}
                  onClick={() => setFormat({ bold: !(textElement?.bold ?? false) }, "format-bold")}
                >
                  <strong>G</strong>
                </Button>
                <Button
                  size="sm"
                  variant={textElement?.italic ? "secondary" : "ghost"}
                  aria-label="Italique"
                  aria-pressed={textElement?.italic === true}
                  disabled={!canEdit || !textElement}
                  onClick={() =>
                    setFormat({ italic: !(textElement?.italic ?? false) }, "format-italic")
                  }
                >
                  <em>I</em>
                </Button>
                <Button
                  size="sm"
                  variant={textElement?.underline ? "secondary" : "ghost"}
                  aria-label="Souligné"
                  aria-pressed={textElement?.underline === true}
                  disabled={!canEdit || !textElement}
                  onClick={() =>
                    setFormat({ underline: !(textElement?.underline ?? false) }, "format-underline")
                  }
                >
                  <span className="underline">S</span>
                </Button>
                <select
                  aria-label="Couleur du texte"
                  value={textElement?.textColor ?? "default"}
                  disabled={!canEdit || !textElement}
                  onChange={(event) =>
                    setFormat({ textColor: event.target.value as SlideTextColor }, "format-color")
                  }
                  className={TOOLBAR_SELECT_CLASS}
                >
                  {SLIDE_TEXT_COLOR_IDS.map((color) => (
                    <option key={color} value={color}>
                      {textColorLabel(color)}
                    </option>
                  ))}
                </select>
                <Button
                  size="sm"
                  variant={textElement?.align === "left" ? "secondary" : "ghost"}
                  aria-label="Aligner le texte à gauche"
                  aria-pressed={textElement?.align === "left"}
                  disabled={!canEdit || !textElement}
                  onClick={() => setFormat({ align: "left" }, "format-align")}
                >
                  ⇤
                </Button>
                <Button
                  size="sm"
                  variant={textElement?.align === "center" ? "secondary" : "ghost"}
                  aria-label="Centrer le texte"
                  aria-pressed={textElement?.align === "center"}
                  disabled={!canEdit || !textElement}
                  onClick={() => setFormat({ align: "center" }, "format-align")}
                >
                  ⇔
                </Button>
                <Button
                  size="sm"
                  variant={textElement?.align === "right" ? "secondary" : "ghost"}
                  aria-label="Aligner le texte à droite"
                  aria-pressed={textElement?.align === "right"}
                  disabled={!canEdit || !textElement}
                  onClick={() => setFormat({ align: "right" }, "format-align")}
                >
                  ⇥
                </Button>
                <Button
                  size="sm"
                  variant={textElement && isBulletList(textElement.text) ? "secondary" : "ghost"}
                  aria-label="Puces"
                  aria-pressed={textElement ? isBulletList(textElement.text) : false}
                  disabled={!canEdit || !textElement}
                  onClick={() =>
                    setFormat({ text: toggleBulletList(textElement?.text ?? "") }, "format-list")
                  }
                >
                  • Puces
                </Button>
                <Button
                  size="sm"
                  variant={textElement && isNumberedList(textElement.text) ? "secondary" : "ghost"}
                  aria-label="Numérotation"
                  aria-pressed={textElement ? isNumberedList(textElement.text) : false}
                  disabled={!canEdit || !textElement}
                  onClick={() =>
                    setFormat({ text: toggleNumberedList(textElement?.text ?? "") }, "format-list")
                  }
                >
                  1. Numérotation
                </Button>
                <span aria-hidden className="mx-1 h-4 w-px shrink-0 bg-border" />
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label="Réduire la taille"
                  title="Réduire la taille"
                  onClick={() => setFontSize(bumpFontSize(textElement.fontSize, -1))}
                >
                  A−
                </Button>
                <Input
                  aria-label="Taille du texte"
                  type="number"
                  min={8}
                  max={200}
                  value={textElement.fontSize}
                  onChange={(event) => setFontSize(Number(event.target.value) || 24)}
                  className="h-8 w-14 text-center"
                />
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label="Augmenter la taille"
                  title="Augmenter la taille"
                  onClick={() => setFontSize(bumpFontSize(textElement.fontSize, 1))}
                >
                  A+
                </Button>
                {selectedShape ? (
                  <>
                    <span aria-hidden className="mx-1 h-4 w-px shrink-0 bg-border" />
                    {SLIDE_SHAPE_KINDS.map((kind) => {
                      const active = shapeVariant(selectedShape) === kind;
                      return (
                        <Button
                          key={kind}
                          size="sm"
                          variant={active ? "secondary" : "ghost"}
                          aria-label={`Forme ${shapeLabel(kind).toLowerCase()}`}
                          title={shapeLabel(kind)}
                          aria-pressed={active}
                          onClick={() => setShape(kind)}
                        >
                          {kind === "rectangle" ? "▭" : kind === "ellipse" ? "◯" : "⟋"}
                        </Button>
                      );
                    })}
                  </>
                ) : null}
              </>
            ) : singleSelection?.kind === "image" ? (
              <>
                <span aria-hidden className="mx-1 h-4 w-px shrink-0 bg-border" />
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label="Remplacer l'image"
                  disabled={!canEdit}
                  onClick={() => singleSelection && requestImage(singleSelection.key)}
                >
                  Remplacer l'image
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-destructive"
                  aria-label="Supprimer l'image"
                  disabled={!canEdit}
                  onClick={deleteSelection}
                >
                  Supprimer
                </Button>
              </>
            ) : null}

            {selectedKeys.length > 0 ? (
              <>
                <span aria-hidden className="mx-1 h-4 w-px shrink-0 bg-border" />
                {selectedKeys.length > 1 ? (
                  <span className="px-1 text-xs tabular-nums text-muted-foreground">
                    {`${selectedKeys.length} éléments`}
                  </span>
                ) : null}
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label="Aligner à gauche"
                  title="Aligner à gauche"
                  disabled={!canEdit}
                  onClick={() => arrangeSelection("left")}
                >
                  ⇤
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label="Aligner au centre"
                  title="Aligner au centre"
                  disabled={!canEdit}
                  onClick={() => arrangeSelection("hcenter")}
                >
                  ↔
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label="Aligner à droite"
                  title="Aligner à droite"
                  disabled={!canEdit}
                  onClick={() => arrangeSelection("right")}
                >
                  ⇥
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label="Aligner en haut"
                  title="Aligner en haut"
                  disabled={!canEdit}
                  onClick={() => arrangeSelection("top")}
                >
                  ⇡
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label="Aligner au milieu"
                  title="Aligner au milieu"
                  disabled={!canEdit}
                  onClick={() => arrangeSelection("vcenter")}
                >
                  ↕
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label="Aligner en bas"
                  title="Aligner en bas"
                  disabled={!canEdit}
                  onClick={() => arrangeSelection("bottom")}
                >
                  ⇣
                </Button>
                <Menu
                  label="Autres actions"
                  align="end"
                  triggerClassName="h-8 w-8 border-transparent bg-transparent px-0 hover:bg-muted focus-visible:ring-offset-0"
                  triggerIcon={<span aria-hidden>⋯</span>}
                  items={[
                    {
                      id: "duplicate",
                      label: "Dupliquer",
                      shortcut: "Ctrl+D",
                      disabled: !canEdit,
                      onSelect: duplicateSelection,
                    },
                    {
                      id: "copy",
                      label: "Copier",
                      shortcut: "Ctrl+C",
                      disabled: !canEdit,
                      onSelect: copySelection,
                    },
                    {
                      id: "paste",
                      label: "Coller",
                      shortcut: "Ctrl+V",
                      disabled: !canEdit || clipboardRef.current.length === 0,
                      onSelect: () => pasteClipboard(),
                    },
                    {
                      id: "dist-x",
                      label: "Répartir horizontalement",
                      separated: true,
                      disabled: !canEdit || selectedKeys.length < 3,
                      onSelect: () => distributeSelection("x"),
                    },
                    {
                      id: "dist-y",
                      label: "Répartir verticalement",
                      disabled: !canEdit || selectedKeys.length < 3,
                      onSelect: () => distributeSelection("y"),
                    },
                    ...Z_MOVE_ORDER.map((move, index) => ({
                      id: `z-${move}`,
                      label: zMoveLabel(move),
                      separated: index === 0,
                      disabled:
                        !canEdit ||
                        selectedKeys.length !== 1 ||
                        !canMoveZ(selectedElementIndex, move, elementCount),
                      onSelect: () => zOrderSelected(move),
                    })),
                    {
                      id: "delete",
                      label: "Supprimer",
                      shortcut: "Suppr",
                      separated: true,
                      destructive: true,
                      disabled: !canEdit,
                      onSelect: deleteSelection,
                    },
                  ]}
                />
              </>
            ) : null}

            <span aria-hidden className="mx-1 h-4 w-px shrink-0 bg-border" />

            {/* Présentation : format de la diapositive, toujours à portée. */}
            <Menu
              label="Présentation"
              align="start"
              triggerClassName="h-8 border-transparent bg-transparent px-2 text-sm hover:bg-muted focus-visible:ring-offset-0"
              items={SLIDE_ASPECT_IDS.map((value) => ({
                id: value,
                label: `${aspectLabel(value)}${aspect === value ? " ✓" : ""}`,
                disabled: !canEdit,
                onSelect: () => changeAspect(value),
              }))}
            />

            <span aria-hidden className="mx-1 h-4 w-px shrink-0 bg-border" />

            {/* Transition : sélecteur compact, durée et aperçu. */}
            <select
              aria-label="Transition"
              value={transition}
              disabled={!canEdit}
              onChange={(event) => changeTransition(event.target.value as SlideTransitionId)}
              className={TOOLBAR_SELECT_CLASS}
            >
              {SLIDE_TRANSITION_IDS.map((value) => (
                <option key={value} value={value}>
                  {transitionLabel(value)}
                </option>
              ))}
            </select>
            <Input
              type="number"
              aria-label="Durée de la transition (ms)"
              min={200}
              max={2000}
              step={50}
              value={transitionMs}
              disabled={!canEdit || transition === "none"}
              onChange={(event) => setTransitionMs(Number(event.target.value) || transitionMs)}
              onBlur={(event) => changeTransitionMs(Number(event.target.value))}
              className="h-8 w-16"
            />
            <span className="text-[11px] text-muted-foreground">ms</span>
            <Button
              size="sm"
              variant="ghost"
              aria-label="Aperçu de la transition"
              title={transitionHint(transition)}
              disabled={!canEdit || transition === "none"}
              onClick={() => {
                setAnnouncement(`Aperçu : ${transitionSummary(transition, transitionMs)}`);
                animateTransition(previewRef.current, transition, transitionMs);
              }}
            >
              ▶
            </Button>
          </div>

          <section aria-label="Éditeur de diapositives" className="flex min-h-0 flex-1 print-hide">
            <SlideFilmstrip
              slides={slides}
              selectedIndex={selectedSlide}
              canEdit={canEdit}
              fileId={fileId}
              onSelect={selectSlide}
              onMove={moveSlideTo}
              onAdd={() => setLayoutOpen(true)}
              onDuplicate={duplicateSlide}
              onDelete={deleteSlide}
              onMoveUp={() => moveSlide(-1)}
              onMoveDown={() => moveSlide(1)}
              canDelete={slides.length > 1}
              canMoveUp={canMoveSlide(selectedSlide, -1, slides.length)}
              canMoveDown={canMoveSlide(selectedSlide, 1, slides.length)}
              aspect={aspect}
              theme={theme}
            />

            <div ref={workspaceRef} className="min-h-0 flex-1 overflow-auto bg-muted/40 p-6">
              <div
                className="mx-auto"
                style={{ width: `${Math.round((SLIDE_BASE_WIDTH * zoom) / 100)}px` }}
              >
                <div ref={previewRef}>
                  <SlideCanvas
                    slide={current}
                    fileId={fileId}
                    interactive={canEdit}
                    selectedElementKeys={selectedKeys}
                    onSelectElement={selectElement}
                    onSelectionChange={selectMany}
                    onGeometryChange={updateElement}
                    onGestureStart={() => pushHistory("geometry")}
                    editingKey={editingKey}
                    onStartEdit={startEdit}
                    onTextChange={changeText}
                    onEndEdit={endEdit}
                    onRequestImage={requestImage}
                    aspect={aspect}
                    theme={theme}
                  />
                </div>
              </div>
            </div>
          </section>

          {notesVisible ? (
            <SlideNotesField
              slide={current}
              index={selectedSlide}
              canEdit={canEdit}
              onNotesChange={(notes) => {
                pushHistory("notes");
                mutateSlide(selectedSlide, (slide) => ({ ...slide, notes }));
              }}
              onClose={() => setNotesVisible(false)}
            />
          ) : null}
        </>
      ) : null}

      {/* Galerie des mises en page : aperçus générés depuis la vraie géométrie. */}
      <Dialog open={layoutOpen} onClose={() => setLayoutOpen(false)} title="Nouvelle diapositive">
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            Choisissez une mise en page de départ — les zones se remplissent d'un clic.
          </p>
          <div className="grid max-h-[60vh] grid-cols-2 gap-2 overflow-y-auto pr-1">
            {SLIDE_LAYOUT_IDS.map((layoutId) => {
              const zones = layoutElements(layoutId);
              return (
                <button
                  key={layoutId}
                  type="button"
                  onClick={() => {
                    setLayoutOpen(false);
                    addSlide(layoutId);
                  }}
                  className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span
                    aria-hidden
                    className="relative block aspect-video w-full overflow-hidden rounded border border-border bg-background"
                  >
                    {zones.map((zone) => (
                      <span
                        key={`${zone.placeholder}-${zone.x}-${zone.y}`}
                        className={cn(
                          "absolute rounded-[2px]",
                          zone.placeholder === "image"
                            ? "border border-dashed border-muted-foreground/50 bg-muted/50"
                            : "bg-foreground/40",
                        )}
                        style={{
                          left: `${zone.x}%`,
                          top: `${zone.y}%`,
                          width: `${zone.w}%`,
                          height: `${zone.h}%`,
                        }}
                      />
                    ))}
                    {zones.length === 0 ? (
                      <span className="absolute inset-0 grid place-items-center text-[10px] text-muted-foreground">
                        Aucune zone
                      </span>
                    ) : null}
                  </span>
                  <span className="text-sm font-medium">{layoutLabel(layoutId)}</span>
                  <span className="text-xs text-muted-foreground">{layoutHint(layoutId)}</span>
                </button>
              );
            })}
          </div>
        </div>
      </Dialog>

      <Dialog
        open={imageOpen}
        onClose={() => {
          setImageOpen(false);
          setPendingImageKey(null);
        }}
        title={pendingImageKey ? "Remplir la zone image" : "Ajouter une image"}
      >
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
            {pendingImageKey ? " L'image prendra la place de la zone." : ""}
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
              ref={sceneRef}
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
