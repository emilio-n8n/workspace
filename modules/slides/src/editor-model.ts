import type { ElementView, SlideView } from "./service.ts";

/**
 * Modèle local de l'éditeur. Chaque diapositive et chaque élément porte une
 * clé React stable (les identifiants serveur n'arrivent qu'après la première
 * sauvegarde) : réordonner, dupliquer ou renommer ne remonte jamais un
 * composant et ne perd jamais une édition en cours.
 */
export type EditorElement = Omit<ElementView, "id"> & { key: string; id?: string };
export type EditorSlide = {
  id?: string;
  key: string;
  title: string;
  notes: string;
  elements: EditorElement[];
};

/** Patch de géométie appliqué pendant un glisser-déposer. */
export type ElementGeometry = Pick<EditorElement, "x" | "y" | "w" | "h">;

/** Une décimale suffit : les positions sont des pourcentages affichés. */
export function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Conversion d'une présentation relue vers l'état de l'éditeur. */
export function toEditor(slides: SlideView[]): EditorSlide[] {
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
export function mergeSavedIds(
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

/** Copie profonde d'une diapositive, prête à être dupliquée. */
export function cloneSlide(slide: EditorSlide, title: string): EditorSlide {
  return {
    key: crypto.randomUUID(),
    title,
    notes: slide.notes,
    elements: slide.elements.map((element) => ({
      ...element,
      key: crypto.randomUUID(),
      id: undefined,
    })),
  };
}

/**
 * Copie d'une diapositive privée de ses identifiants serveur, clés React
 * conservées. Sert au rétablissement après suppression : les lignes ayant
 * disparu côté serveur, des identifiants morts seraient sinon ignorés à
 * l'insertion — et un élément garderait une clé périmée, réinsérée (donc
 * dupliquée) à chaque sauvegarde.
 */
export function rebindSlide(slide: EditorSlide): EditorSlide {
  return {
    ...slide,
    id: undefined,
    elements: slide.elements.map((element) => ({ ...element, id: undefined })),
  };
}

/** Titre affiché d'une diapositive (« Diapositive 3 » à défaut de titre). */
export function slideTitle(slide: EditorSlide, index: number): string {
  const trimmed = slide.title.trim();
  return trimmed.length > 0 ? trimmed : `Diapositive ${index + 1}`;
}
