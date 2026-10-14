import { Alert, Button, cn, Dialog, Input, Kbd, Label, LoadingState } from "@workspace/ui";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  clamp,
  cloneSlide,
  type EditorElement,
  type EditorSlide,
  mergeSavedIds,
  rebindSlide,
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
  aspectLabel,
  conversionSummary,
  convertScene,
  DEFAULT_SLIDE_ASPECT,
  normalizeAspect,
  SLIDE_ASPECT_IDS,
  type SlideAspectId,
} from "../slide-aspect.ts";
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
import { SlideUndoToast } from "./slide-undo-toast.tsx";

type SaveStatus = "idle" | "saving" | "saved" | "error";

/** Durée d'affichage du message d'annulation avant application définitive (6 s). */
const UNDO_MS = 6000;

/** Géométrie d'une zone de texte insérée librement (centrée sur la diapositive). */
const FREE_TEXT = { w: 40, h: 12, x: 30, y: 44 };

/** Libellé d'ajout d'une forme, avec l'élision correcte (« un rectangle »). */
const SHAPE_ADD_LABELS: Record<SlideShapeKind, string> = {
  rectangle: "Ajouter un rectangle",
  ellipse: "Ajouter une ellipse",
  line: "Ajouter une ligne",
};

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

/**
 * Éditeur de présentation, organisé comme un outil de présentation :
 * bandeau du titre, barre d'outils unique (annuler, zoom, insertion, mise en
 * forme contextuelle, transitions), colonne des diapositives à gauche,
 * canevas centré sur un fond de travail, panneau de mise en forme à droite,
 * barre de notes du présentateur en pied, mode présentation plein écran.
 *
 * La scène vit en pourcentages de la diapositive ; les mises en page créent
 * des zones à remplir (« Cliquez pour ajouter un titre ») et l'édition du
 * texte se fait en place, avec la typographie exacte du rendu final.
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
  const [selectedElementKey, setSelectedElementKey] = useState<string | null>(null);
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
  const [elapsed, setElapsed] = useState(0);
  const [printToken, setPrintToken] = useState(0);
  const [undo, setUndo] = useState<{ message: string } | null>(null);
  const [imageOpen, setImageOpen] = useState(false);
  const [imageBusy, setImageBusy] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  /** Dialogue de choix de mise en page d'une nouvelle diapositive. */
  const [layoutOpen, setLayoutOpen] = useState(false);
  /** Zoom d'affichage du canevas : ajusté à la fenêtre par défaut. */
  const [zoom, setZoom] = useState(100);
  const [fitZoom, setFitZoom] = useState(true);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const slidesRef = useRef<EditorSlide[]>([]);
  const canEditRef = useRef(false);
  /** Vrai quand un élément est sélectionné : les flèches le déplacent alors. */
  const elementSelectedRef = useRef(false);
  const revisionRef = useRef(1);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Action annulable en attente (suppression, duplication) et son minuteur. */
  const undoRef = useRef<null | (() => void)>(null);
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    slidesRef.current = slides;
  }, [slides]);

  useEffect(() => {
    elementSelectedRef.current = selectedElementKey !== null;
  }, [selectedElementKey]);

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

  /** Ferme le message d'annulation sans rien rétablir. */
  const clearUndo = useCallback(() => {
    if (undoTimerRef.current) {
      clearTimeout(undoTimerRef.current);
      undoTimerRef.current = null;
    }
    undoRef.current = null;
    setUndo(null);
  }, []);

  /**
   * Propose d'annuler une action : le message s'affiche 6 s et retient la
   * fonction de rétablissement ; passé ce délai, l'action devient définitive.
   * Une seule annulation en attente à la fois (la dernière action prime).
   */
  const offerUndo = useCallback((message: string, restore: () => void) => {
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    undoRef.current = restore;
    setUndo({ message });
    undoTimerRef.current = setTimeout(() => {
      undoTimerRef.current = null;
      undoRef.current = null;
      setUndo(null);
    }, UNDO_MS);
  }, []);

  /** Rétablit l'état d'avant la dernière action annulable. */
  const runUndo = useCallback(() => {
    const restore = undoRef.current;
    clearUndo();
    if (restore) restore();
  }, [clearUndo]);

  // Le minuteur d'annulation ne survit pas au démontage de l'éditeur.
  useEffect(
    () => () => {
      if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    },
    [],
  );

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
    setEditingKey(null);
  }, []);

  /** Entre en édition en place sur un élément (double-clic ou zone vide). */
  const startEdit = useCallback((key: string) => {
    if (!canEditRef.current) return;
    setSelectedElementKey(key);
    setEditingKey(key);
  }, []);

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
    setSelectedElementKey(element.key);
    setEditingKey(null);
  }

  function addText() {
    appendElement(freeElement("text", FREE_TEXT, "Texte"));
  }

  function addShape(kind: SlideShapeKind) {
    appendElement(freeElement(kind, shapeGeometry(kind), ""));
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
        ...freeElement("image", { x: 20, y: 20, w: 30, h: 25 }, ""),
        mediaKey,
      };
      mutateSlide(selectedSlide, (slide) => ({ ...slide, elements: [...slide.elements, element] }));
      setSelectedElementKey(element.key);
      setEditingKey(null);
      setImageOpen(false);
    } catch (caught) {
      setImageError(caught instanceof Error ? caught.message : "Téléversement impossible.");
    } finally {
      setImageBusy(false);
    }
  }

  const deleteElement = useCallback(() => {
    if (!selectedElementKey) return;
    setSlides((current) =>
      current.map((slide, position) =>
        position === selectedSlide
          ? {
              ...slide,
              elements: slide.elements.filter((element) => element.key !== selectedElementKey),
            }
          : slide,
      ),
    );
    setSelectedElementKey(null);
    setEditingKey(null);
    schedule();
  }, [selectedElementKey, selectedSlide, schedule]);

  /** Déplace l'élément sélectionné de un point (ou cinq avec Maj), en %. */
  const nudgeSelected = useCallback(
    (dx: number, dy: number) => {
      const key = selectedElementKey;
      const slide = slidesRef.current[selectedSlide];
      const element = slide?.elements.find((item) => item.key === key);
      if (!key || !element) return;
      const x = round1(clamp(element.x + dx, 0, 100 - element.w));
      const y = round1(clamp(element.y + dy, 0, 100 - element.h));
      setSlides((current) =>
        current.map((item, position) =>
          position === selectedSlide
            ? {
                ...item,
                elements: item.elements.map((candidate) =>
                  candidate.key === key ? { ...candidate, x, y } : candidate,
                ),
              }
            : item,
        ),
      );
      schedule();
      setAnnouncement(
        `Élément déplacé : ${Math.round(x)} % de la largeur, ${Math.round(y)} % de la hauteur.`,
      );
    },
    [selectedElementKey, selectedSlide, schedule],
  );

  /** Ajoute une diapositive avec la mise en page choisie. */
  function addSlide(layout: SlideLayoutId) {
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
    setSelectedElementKey(null);
    setEditingKey(null);
    setAnnouncement(`Diapositive ajoutée — mise en page « ${layoutLabel(layout)} ».`);
    schedule();
  }

  function duplicateSlide() {
    const index = selectedSlide;
    const source = slides[index];
    if (!source) return;
    const name = slideTitle(source, index);
    const copy = cloneSlide(source, `${name} (copie)`);
    const insertAt = index + 1;
    setSlides((current) => {
      const next = [...current];
      next.splice(insertAt, 0, copy);
      return next;
    });
    setSelectedSlide(insertAt);
    setSelectedElementKey(null);
    setEditingKey(null);
    schedule();
    setAnnouncement(`Diapositive « ${name} » dupliquée.`);
    // Annulation : la copie est retirée ; sa clé la retrouve quoi qu'il arrive.
    offerUndo(`Diapositive « ${name} » dupliquée.`, () => {
      setSlides((current) => current.filter((slide) => slide.key !== copy.key));
      setSelectedSlide(index);
      setSelectedElementKey(null);
      setEditingKey(null);
      setAnnouncement("Duplication annulée.");
      schedule();
    });
  }

  function deleteSlide() {
    const index = selectedSlide;
    const slide = slides[index];
    if (!slide || slides.length <= 1) return;
    const name = slideTitle(slide, index);
    setSlides((current) => current.filter((_, position) => position !== index));
    setSelectedSlide(Math.max(0, index - 1));
    setSelectedElementKey(null);
    setEditingKey(null);
    schedule();
    setAnnouncement(`Diapositive « ${name} » supprimée.`);
    // Annulation : la diapositive est réinsérée à sa place. Ses identifiants
    // serveur sont abandonnés (ses lignes ont pu être supprimées) : la
    // sauvegarde suivante la recrée sans dupliquer aucun élément.
    offerUndo(`Diapositive « ${name} » supprimée.`, () => {
      const restored = rebindSlide(slide);
      const at = Math.min(index, slidesRef.current.length);
      setSlides((current) => {
        const next = [...current];
        next.splice(at, 0, restored);
        return next;
      });
      setSelectedSlide(at);
      setSelectedElementKey(null);
      setEditingKey(null);
      setAnnouncement(`Diapositive « ${name} » rétablie.`);
      schedule();
    });
  }

  /** Change l'ordre z de l'élément sélectionné (avant-plan / arrière-plan). */
  function zOrderSelected(move: ZMove) {
    const key = selectedElementKey;
    const slide = slidesRef.current[selectedSlide];
    const element = slide?.elements.find((item) => item.key === key);
    if (!key || !element) return;
    mutateSlide(selectedSlide, (current) => {
      const position = current.elements.findIndex((item) => item.key === key);
      return { ...current, elements: zOrderMove(current.elements, position, move) };
    });
    setAnnouncement(zOrderAnnouncement(move, elementLabel(element)));
  }

  /**
   * Enregistre un réglage de présentation (format, thème, transition) de
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

  // Clavier sur l'élément sélectionné : ordre z (Ctrl/Cmd + ↑/↓, Maj pour les
  // extrémités), déplacement aux flèches (Maj : pas de 5 %), Entrée pour
  // modifier en place, Suppr pour supprimer, Échap pour désélectionner.
  // Actif seulement hors saisie, hors fenêtre modale et hors présentation.
  useEffect(() => {
    if (presenting || !canEdit || !selectedElementKey) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as Element | null;
      if (isTypingTarget(target) || isInsideModal(target)) return;
      if (target?.closest("button")) return;
      const slide = slidesRef.current[selectedSlide];
      const element = slide?.elements.find((item) => item.key === selectedElementKey);
      if (!element) return;
      const move = zMoveForKey({
        key: event.key,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        shiftKey: event.shiftKey,
        altKey: event.altKey,
      });
      if (move) {
        event.preventDefault();
        setSlides((current) =>
          current.map((item, position) =>
            position === selectedSlide
              ? {
                  ...item,
                  elements: zOrderMove(
                    item.elements,
                    item.elements.findIndex((candidate) => candidate.key === selectedElementKey),
                    move,
                  ),
                }
              : item,
          ),
        );
        setAnnouncement(zOrderAnnouncement(move, elementLabel(element)));
        schedule();
        return;
      }
      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        deleteElement();
        setAnnouncement("Élément supprimé.");
        return;
      }
      if (event.key === "Enter" && element.kind !== "image") {
        event.preventDefault();
        startEdit(element.key);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setSelectedElementKey(null);
        return;
      }
      const step = event.shiftKey ? 5 : 1;
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        nudgeSelected(-step, 0);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        nudgeSelected(step, 0);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        nudgeSelected(0, -step);
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        nudgeSelected(0, step);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    presenting,
    canEdit,
    selectedElementKey,
    selectedSlide,
    schedule,
    startEdit,
    deleteElement,
    nudgeSelected,
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

  const current = slides[selectedSlide] ?? null;
  const selectedElement =
    current?.elements.find((element) => element.key === selectedElementKey) ?? null;
  const selectedElementIndex = selectedElement
    ? (current?.elements.findIndex((element) => element.key === selectedElement.key) ?? -1)
    : -1;
  const selectedShape =
    selectedElement && isShapeKind(selectedElement.kind) ? selectedElement.kind : null;
  const elementCount = current?.elements.length ?? 0;
  /** Élément porteur de texte (tout sauf une image) : cible du formatage. */
  const textElement = selectedElement && selectedElement.kind !== "image" ? selectedElement : null;

  const statusLabel =
    status === "saving"
      ? "Enregistrement…"
      : status === "saved"
        ? "Enregistré"
        : status === "error"
          ? "Erreur de sauvegarde"
          : "";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
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
            <fieldset className="flex items-center gap-1" aria-label="Thème de la présentation">
              {SLIDE_THEME_IDS.map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={theme === value}
                  title={`Thème ${themeLabel(value)}`}
                  onClick={() => changeTheme(value)}
                  className={cn(
                    "size-5 rounded-full border transition-shadow",
                    themeSwatchClass(value),
                    theme === value ? "ring-2 ring-ring" : "hover:ring-1 hover:ring-ring",
                  )}
                >
                  <span className="sr-only">{`Thème ${themeLabel(value)}`}</span>
                </button>
              ))}
            </fieldset>
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
            className="flex flex-wrap items-center gap-1 border-b border-border bg-card px-3 py-1.5 print-hide"
          >
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
            <span aria-hidden className="mx-1 h-5 w-px bg-border" />

            {/* Diapositives. */}
            <Button
              size="sm"
              variant="outline"
              aria-label="Nouvelle diapositive"
              disabled={!canEdit}
              onClick={() => setLayoutOpen(true)}
            >
              ＋ Diapositive
            </Button>
            <Button size="sm" variant="ghost" disabled={!canEdit} onClick={duplicateSlide}>
              Dupliquer
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-destructive"
              disabled={!canEdit || slides.length <= 1}
              onClick={deleteSlide}
            >
              Supprimer
            </Button>
            <Button
              size="sm"
              variant="ghost"
              aria-label="Monter la diapositive"
              disabled={!canEdit || !canMoveSlide(selectedSlide, -1, slides.length)}
              onClick={() => moveSlide(-1)}
            >
              ↑
            </Button>
            <Button
              size="sm"
              variant="ghost"
              aria-label="Descendre la diapositive"
              disabled={!canEdit || !canMoveSlide(selectedSlide, 1, slides.length)}
              onClick={() => moveSlide(1)}
            >
              ↓
            </Button>
            <span aria-hidden className="mx-1 h-5 w-px bg-border" />

            {/* Insertion. */}
            <Button
              size="sm"
              variant="outline"
              aria-label="Ajouter une zone de texte"
              disabled={!canEdit}
              onClick={addText}
            >
              Zone de texte
            </Button>
            {SLIDE_SHAPE_KINDS.map((kind) => (
              <Button
                key={kind}
                size="sm"
                variant="outline"
                aria-label={SHAPE_ADD_LABELS[kind]}
                disabled={!canEdit}
                onClick={() => addShape(kind)}
              >
                {shapeLabel(kind)}
              </Button>
            ))}
            <Button
              size="sm"
              variant="outline"
              aria-label="Ajouter une image"
              disabled={!canEdit}
              onClick={() => {
                setImageError(null);
                setImageOpen(true);
              }}
            >
              Image
            </Button>
            <span aria-hidden className="mx-1 h-5 w-px bg-border" />

            {/* Mise en forme contextuelle : active avec un élément porteur de texte. */}
            <Button
              size="sm"
              variant={textElement?.bold ? "secondary" : "ghost"}
              aria-label="Gras"
              aria-pressed={textElement?.bold === true}
              disabled={!canEdit || !textElement}
              onClick={() =>
                textElement && updateElement(textElement.key, { bold: !textElement.bold })
              }
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
                textElement && updateElement(textElement.key, { italic: !textElement.italic })
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
                textElement && updateElement(textElement.key, { underline: !textElement.underline })
              }
            >
              <span className="underline">S</span>
            </Button>
            <select
              aria-label="Couleur du texte"
              value={textElement?.textColor ?? "default"}
              disabled={!canEdit || !textElement}
              onChange={(event) =>
                textElement &&
                updateElement(textElement.key, {
                  textColor: event.target.value as SlideTextColor,
                })
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
              aria-label="Aligner à gauche"
              aria-pressed={textElement?.align === "left"}
              disabled={!canEdit || !textElement}
              onClick={() => textElement && updateElement(textElement.key, { align: "left" })}
            >
              ⇤
            </Button>
            <Button
              size="sm"
              variant={textElement?.align === "center" ? "secondary" : "ghost"}
              aria-label="Centrer"
              aria-pressed={textElement?.align === "center"}
              disabled={!canEdit || !textElement}
              onClick={() => textElement && updateElement(textElement.key, { align: "center" })}
            >
              ⇔
            </Button>
            <Button
              size="sm"
              variant={textElement?.align === "right" ? "secondary" : "ghost"}
              aria-label="Aligner à droite"
              aria-pressed={textElement?.align === "right"}
              disabled={!canEdit || !textElement}
              onClick={() => textElement && updateElement(textElement.key, { align: "right" })}
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
                textElement &&
                updateElement(textElement.key, { text: toggleBulletList(textElement.text) })
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
                textElement &&
                updateElement(textElement.key, { text: toggleNumberedList(textElement.text) })
              }
            >
              1. Numérotation
            </Button>
            <span aria-hidden className="mx-1 h-5 w-px bg-border" />

            {/* Transition de la présentation, avec aperçu immédiat. */}
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
              className="h-8 w-20"
            />
            <Button
              size="sm"
              variant="ghost"
              disabled={!canEdit || transition === "none"}
              title={transitionHint(transition)}
              onClick={() => {
                setAnnouncement(`Aperçu : ${transitionSummary(transition, transitionMs)}`);
                animateTransition(previewRef.current, transition, transitionMs);
              }}
            >
              Aperçu
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
              aspect={aspect}
              theme={theme}
            />

            <div
              ref={workspaceRef}
              className="min-h-0 flex-1 overflow-auto bg-muted/40 p-6"
              onPointerDown={(event) => {
                // Un clic dans le vide du plan de travail désélectionne.
                if (event.target === event.currentTarget) setSelectedElementKey(null);
              }}
            >
              <div
                className="mx-auto"
                style={{ width: `${Math.round((SLIDE_BASE_WIDTH * zoom) / 100)}px` }}
              >
                <div ref={previewRef}>
                  <SlideCanvas
                    slide={current}
                    fileId={fileId}
                    interactive={canEdit}
                    selectedElementKey={selectedElementKey}
                    onSelectElement={(key) => {
                      setSelectedElementKey(key);
                      if (key === null) setEditingKey(null);
                    }}
                    onGeometryChange={updateElement}
                    editingKey={editingKey}
                    onStartEdit={startEdit}
                    onTextChange={changeText}
                    onEndEdit={endEdit}
                    aspect={aspect}
                    theme={theme}
                  />
                </div>
              </div>
            </div>

            <aside
              aria-label="Panneau de mise en forme"
              className="flex w-72 shrink-0 flex-col gap-3 overflow-y-auto border-l border-border bg-card p-3 print-hide"
            >
              {selectedElement && canEdit ? (
                <div className="flex flex-col gap-3">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                      Élément sélectionné
                    </p>
                    <span className="text-[11px] text-muted-foreground">
                      {selectedElementIndex + 1}/{elementCount}
                    </span>
                  </div>
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
                        className="rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      />
                      <p className="text-[11px] leading-snug text-muted-foreground">
                        ou double-cliquez sur la zone pour modifier en place.
                      </p>
                    </div>
                  ) : null}
                  {selectedShape ? (
                    <fieldset className="flex flex-col gap-1">
                      <legend className="text-xs font-medium text-muted-foreground">Forme</legend>
                      <div className="flex flex-wrap gap-1">
                        {SLIDE_SHAPE_KINDS.map((kind) => {
                          const active = shapeVariant(selectedShape) === kind;
                          return (
                            <Button
                              key={kind}
                              size="sm"
                              variant={active ? "secondary" : "ghost"}
                              aria-pressed={active}
                              onClick={() => updateElement(selectedElement.key, { kind })}
                            >
                              {shapeLabel(kind)}
                            </Button>
                          );
                        })}
                      </div>
                    </fieldset>
                  ) : null}
                  <div className="flex flex-col gap-1">
                    <Label htmlFor="element-size">Taille du texte</Label>
                    <div className="flex items-center gap-2">
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
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label="Réduire la taille"
                        onClick={() =>
                          updateElement(selectedElement.key, {
                            fontSize: bumpFontSize(selectedElement.fontSize, -1),
                          })
                        }
                      >
                        A−
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label="Augmenter la taille"
                        onClick={() =>
                          updateElement(selectedElement.key, {
                            fontSize: bumpFontSize(selectedElement.fontSize, 1),
                          })
                        }
                      >
                        A+
                      </Button>
                    </div>
                  </div>
                  <fieldset className="flex flex-col gap-1">
                    <legend className="text-xs font-medium text-muted-foreground">
                      Ordre (avant / arrière-plan)
                    </legend>
                    <div className="flex flex-wrap gap-1">
                      {Z_MOVE_ORDER.map((move) => (
                        <Button
                          key={move}
                          size="sm"
                          variant="outline"
                          disabled={!canMoveZ(selectedElementIndex, move, elementCount)}
                          onClick={() => zOrderSelected(move)}
                        >
                          {zMoveLabel(move)}
                        </Button>
                      ))}
                    </div>
                    <p className="text-[11px] leading-snug text-muted-foreground">
                      <Kbd>Ctrl</Kbd>+<Kbd>↑</Kbd> avancer, <Kbd>Ctrl</Kbd>+<Kbd>↓</Kbd> reculer,
                      avec <Kbd>Maj</Kbd> pour les extrémités.
                    </p>
                  </fieldset>
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
                <div className="flex flex-col gap-3">
                  <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                    Diapositive
                  </p>
                  <div className="flex flex-col gap-1">
                    <Label htmlFor="slide-title">Titre de la diapositive</Label>
                    <Input
                      id="slide-title"
                      value={current.title}
                      disabled={!canEdit}
                      onChange={(event) =>
                        mutateSlide(selectedSlide, (slide) => ({
                          ...slide,
                          title: event.target.value,
                        }))
                      }
                      maxLength={255}
                    />
                  </div>
                  <fieldset className="flex flex-col gap-1">
                    <legend className="text-xs font-medium text-muted-foreground">
                      Format de la diapositive
                    </legend>
                    <div className="flex flex-wrap gap-1">
                      {SLIDE_ASPECT_IDS.map((value) => (
                        <Button
                          key={value}
                          size="sm"
                          variant={aspect === value ? "secondary" : "ghost"}
                          aria-pressed={aspect === value}
                          title={aspectLabel(value)}
                          disabled={!canEdit}
                          onClick={() => changeAspect(value)}
                        >
                          {value === "16:9" ? "Écran large (16:9)" : "Standard (4:3)"}
                        </Button>
                      ))}
                    </div>
                  </fieldset>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    Cliquez un élément pour le mettre en forme. <Kbd>Entrée</Kbd> l'ouvre en
                    édition, <Kbd>Suppr</Kbd> le supprime, les flèches le déplacent (<Kbd>Maj</Kbd>{" "}
                    : pas de 5 %). <Kbd>←</Kbd> <Kbd>→</Kbd> changent de diapositive.
                  </p>
                </div>
              )}
            </aside>
          </section>

          <SlideNotesField
            slide={current}
            index={selectedSlide}
            canEdit={canEdit}
            onNotesChange={(notes) => mutateSlide(selectedSlide, (slide) => ({ ...slide, notes }))}
          />
        </>
      ) : null}

      {/* Dialogue de mise en page d'une nouvelle diapositive. */}
      <Dialog open={layoutOpen} onClose={() => setLayoutOpen(false)} title="Nouvelle diapositive">
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            Choisissez une mise en page de départ — les zones se remplissent d'un clic.
          </p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {SLIDE_LAYOUT_IDS.map((layoutId) => (
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
                  className="flex aspect-video w-full flex-col justify-center gap-1.5 rounded border border-border bg-background p-2"
                >
                  {layoutId === "title" ? (
                    <>
                      <span className="mx-auto h-1.5 w-3/4 rounded-full bg-foreground/70" />
                      <span className="mx-auto h-1 w-1/2 rounded-full bg-muted-foreground/60" />
                    </>
                  ) : null}
                  {layoutId === "title-content" ? (
                    <>
                      <span className="h-1.5 w-2/3 rounded-full bg-foreground/70" />
                      <span className="h-1 w-full rounded-full bg-muted-foreground/50" />
                      <span className="h-1 w-full rounded-full bg-muted-foreground/50" />
                      <span className="h-1 w-5/6 rounded-full bg-muted-foreground/50" />
                    </>
                  ) : null}
                  {layoutId === "blank" ? (
                    <span className="text-center text-[10px] text-muted-foreground">
                      Aucune zone
                    </span>
                  ) : null}
                </span>
                <span className="text-sm font-medium">{layoutLabel(layoutId)}</span>
                <span className="text-xs text-muted-foreground">{layoutHint(layoutId)}</span>
              </button>
            ))}
          </div>
        </div>
      </Dialog>

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

      {/* Message d'annulation : suppression ou duplication réversible 6 s. */}
      {undo ? (
        <SlideUndoToast message={undo.message} onUndo={runUndo} onDismiss={clearUndo} />
      ) : null}

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
