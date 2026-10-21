import { randomUUID } from "node:crypto";
import { recordAudit } from "@workspace/audit";
import { getDb, withTransaction } from "@workspace/database";
import {
  createLinkedFile,
  type DriveEntry,
  rename as driveRename,
  effectiveRole,
  getEntry,
  touchEntry,
} from "@workspace/drive";
import { type Actor, roleSatisfies } from "@workspace/permissions";
import { and, asc, eq, inArray, notInArray, sql } from "drizzle-orm";
import {
  type PresentationSlideRow,
  presentationSlides,
  presentations,
  slideElements,
} from "./schema.ts";
import { normalizeAspect, SLIDE_ASPECT_IDS, type SlideAspectId } from "./slide-aspect.ts";
import { normalizeFill, normalizeRotation, type SlideFill } from "./slide-fill.ts";
import {
  layoutElements,
  normalizePlaceholder,
  type SlidePlaceholderRole,
  TITLE_LAYOUT,
} from "./slide-layouts.ts";
import { MAX_NOTES_CHARS, notesForSave } from "./slide-notes.ts";
import { RichTextError, type TextRun, validateRuns } from "./slide-rich-text.ts";
import { SHAPE_ELEMENT_KINDS, type SlideShapeKind } from "./slide-shapes.ts";
import { normalizeTextColor, type SlideTextColor } from "./slide-text.ts";
import { normalizeTheme, SLIDE_THEME_IDS, type SlideThemeId } from "./slide-theme.ts";
import {
  normalizeTransition,
  normalizeTransitionMs,
  SLIDE_TRANSITION_IDS,
  type SlideTransitionId,
} from "./slide-transition.ts";

/** Type MIME du pointeur Drive d'une présentation Workspace. */
export const SLIDES_MIME = "application/vnd.workspace.slides+json";

const MAX_SLIDES = 100;
const MAX_ELEMENTS_PER_SLIDE = 100;
const MAX_TEXT_CHARS = 2000;

/** Taille maximale d'une image de diapositive (8 Mo). */
export const MAX_SLIDE_IMAGE_BYTES = 8 * 1024 * 1024;
/** Préfixe des clés média gérées par le module. */
const MEDIA_KEY_PREFIX = "slides/";
/** Types MIME image acceptés à l'upload → extension de la clé. */
const IMAGE_CONTENT_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
};
/** Extension → type MIME servi (petit map inverse, lecture). */
const IMAGE_EXTENSION_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  avif: "image/avif",
};

export type SlidesErrorCode = "not_found" | "forbidden" | "validation" | "conflict";

export class SlidesError extends Error {
  readonly code: SlidesErrorCode;
  constructor(code: SlidesErrorCode, message: string) {
    super(message);
    this.name = "SlidesError";
    this.code = code;
  }
}

export type ElementKind = "text" | "image" | "shape" | SlideShapeKind;
export type ElementAlign = "left" | "center" | "right";

export type ElementView = {
  id: string;
  kind: ElementKind;
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
  /** Clé de stockage du binaire pour kind "image" ; null/absent sinon. */
  mediaKey?: string | null;
  fontSize: number;
  bold: boolean;
  /** Italique du texte. */
  italic: boolean;
  /** Soulignement du texte. */
  underline: boolean;
  /** Couleur sémantique du texte (« default » = héritée du thème). */
  textColor: SlideTextColor;
  /** Rôle de zone d'une mise en page ; null pour un élément libre. */
  placeholder: SlidePlaceholderRole | null;
  align: ElementAlign;
  /** Remplissage (« theme » = design de la présentation). */
  fill: SlideFill;
  /** Rotation en degrés entiers, dans [0, 360). */
  rotation: number;
  /** Texte enrichi par mot ; null = texte brut. */
  runs?: TextRun[] | null;
};

export type SlideView = {
  id: string;
  position: number;
  title: string | null;
  notes: string | null;
  elements: ElementView[];
};

export type PresentationDetail = {
  fileId: string;
  title: string;
  canEdit: boolean;
  /** Révision courante (contrôle optimiste des sauvegardes). */
  revision: number;
  /** Format de la diapositive (« 16:9 » ou « 4:3 »). */
  aspect: SlideAspectId;
  /** Thème construit sur les jetons sémantiques. */
  theme: SlideThemeId;
  /** Transition jouée à chaque changement de diapositive (présentation). */
  transition: SlideTransitionId;
  /** Durée de la transition, en millisecondes. */
  transitionMs: number;
  slides: SlideView[];
};

/**
 * Entrée d'un élément : les champs de mise en forme ajoutés en second temps
 * restent optionnels (un ancien client peut les omettre) ; la validation les
 * normalise vers leurs valeurs par défaut.
 */
export type ElementInput = Omit<
  ElementView,
  "id" | "italic" | "underline" | "textColor" | "placeholder" | "fill" | "rotation" | "runs"
> & {
  runs?: TextRun[] | null;
  id?: string;
  fill?: SlideFill;
  rotation?: number;
  italic?: boolean;
  underline?: boolean;
  textColor?: SlideTextColor;
  placeholder?: SlidePlaceholderRole | null;
};
export type SlideInput = {
  id?: string;
  title?: string | null;
  notes?: string | null;
  elements: ElementInput[];
};
export type SavePresentationInput = {
  revision: number;
  slides: SlideInput[];
};

const db = () => getDb();

function assertTitle(title: string): string {
  const trimmed = title.trim();
  if (trimmed.length < 1 || trimmed.length > 255) {
    throw new SlidesError("validation", "Le titre doit contenir entre 1 et 255 caractères.");
  }
  return trimmed;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function assertFiniteNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new SlidesError("validation", `${label} invalide : nombre fini attendu.`);
  }
  return value;
}

function assertRevision(revision: unknown): number {
  if (typeof revision !== "number" || !Number.isInteger(revision) || revision < 1) {
    throw new SlidesError("validation", "Numéro de révision invalide.");
  }
  return revision;
}

const ELEMENT_KINDS = ["text", "image", ...SHAPE_ELEMENT_KINDS] as const;
const ELEMENT_ALIGNS = ["left", "center", "right"] as const;

function assertSlides(input: unknown): SlideInput[] {
  if (!Array.isArray(input)) {
    throw new SlidesError("validation", "La liste des diapositives est invalide.");
  }
  if (input.length < 1) {
    throw new SlidesError("validation", "La présentation doit contenir au moins une diapositive.");
  }
  if (input.length > MAX_SLIDES) {
    throw new SlidesError("validation", `${MAX_SLIDES} diapositives au maximum.`);
  }
  return input.map((rawSlide) => {
    if (typeof rawSlide !== "object" || rawSlide === null) {
      throw new SlidesError("validation", "Diapositive invalide.");
    }
    const slide = rawSlide as Partial<SlideInput>;
    if (!Array.isArray(slide.elements)) {
      throw new SlidesError("validation", "Les éléments d'une diapositive sont invalides.");
    }
    if (slide.elements.length > MAX_ELEMENTS_PER_SLIDE) {
      throw new SlidesError(
        "validation",
        `${MAX_ELEMENTS_PER_SLIDE} éléments par diapositive au maximum.`,
      );
    }
    if (slide.title != null && typeof slide.title !== "string") {
      throw new SlidesError("validation", "Titre de diapositive invalide.");
    }
    if (slide.notes != null && typeof slide.notes !== "string") {
      throw new SlidesError("validation", "Notes de diapositive invalides.");
    }
    if ((slide.notes ?? "").length > MAX_NOTES_CHARS) {
      throw new SlidesError(
        "validation",
        `Les notes sont limitées à ${MAX_NOTES_CHARS} caractères.`,
      );
    }
    return {
      id: typeof slide.id === "string" ? slide.id : undefined,
      title: (slide.title ?? "").trim().slice(0, 255) || null,
      notes: notesForSave(slide.notes),
      elements: slide.elements.map((rawElement) => {
        if (typeof rawElement !== "object" || rawElement === null) {
          throw new SlidesError("validation", "Élément invalide.");
        }
        const element = rawElement as Partial<ElementInput>;
        if (!ELEMENT_KINDS.includes(element.kind as (typeof ELEMENT_KINDS)[number])) {
          throw new SlidesError("validation", "Type d'élément inconnu.");
        }
        if (typeof element.text !== "string") {
          throw new SlidesError("validation", "Texte de l'élément invalide.");
        }
        if (element.text.length > MAX_TEXT_CHARS) {
          throw new SlidesError("validation", `Texte limité à ${MAX_TEXT_CHARS} caractères.`);
        }
        // Le binaire des images vit dans le stockage objet : l'élément ne
        // référence que la clé. Les autres types n'en portent jamais.
        const trimmedMediaKey =
          element.mediaKey == null || element.mediaKey === "" ? null : element.mediaKey;
        if (element.kind === "image") {
          if (
            typeof trimmedMediaKey !== "string" ||
            !trimmedMediaKey.startsWith(MEDIA_KEY_PREFIX)
          ) {
            throw new SlidesError(
              "validation",
              "Une image doit référencer un média (clé démarrant par slides/).",
            );
          }
          if (trimmedMediaKey.length > 512) {
            throw new SlidesError("validation", "Clé média trop longue (512 caractères maximum).");
          }
          if (element.text.length > 0) {
            throw new SlidesError("validation", "Une image ne peut pas porter de texte.");
          }
        } else if (trimmedMediaKey !== null) {
          throw new SlidesError("validation", "Seules les images portent une clé média.");
        }
        if (!ELEMENT_ALIGNS.includes(element.align as (typeof ELEMENT_ALIGNS)[number])) {
          throw new SlidesError("validation", "Alignement inconnu.");
        }
        // Bornes d'abord (w/h), puis containment : x ∈ [0, 100-w], y ∈ [0, 100-h].
        const w = clamp(assertFiniteNumber(element.w, "Largeur"), 1, 100);
        const h = clamp(assertFiniteNumber(element.h, "Hauteur"), 1, 100);
        const fontSize = Math.round(
          clamp(assertFiniteNumber(element.fontSize, "Taille de police"), 8, 200),
        );
        return {
          id: typeof element.id === "string" ? element.id : undefined,
          kind: element.kind as ElementKind,
          x: clamp(assertFiniteNumber(element.x, "Position horizontale"), 0, 100 - w),
          y: clamp(assertFiniteNumber(element.y, "Position verticale"), 0, 100 - h),
          w,
          h,
          text: element.text,
          mediaKey: element.kind === "image" ? (trimmedMediaKey as string) : null,
          fontSize,
          bold: Boolean(element.bold),
          italic: Boolean(element.italic),
          underline: Boolean(element.underline),
          textColor: normalizeTextColor(element.textColor),
          // Les zones de mise en page n'ont de sens que pour du texte.
          placeholder: element.kind === "text" ? normalizePlaceholder(element.placeholder) : null,
          align: element.align as ElementAlign,
          // Une image n'a pas de remplissage ; la rotation vaut pour tous.
          fill: element.kind === "image" ? "theme" : normalizeFill(element.fill),
          rotation: normalizeRotation(element.rotation ?? 0),
          runs: element.kind === "image" ? null : assertRuns(element.runs, element.text),
        };
      }),
    };
  });
}

function assertRuns(value: unknown, text: string): TextRun[] | null {
  try {
    return validateRuns(value, text);
  } catch (error) {
    if (error instanceof RichTextError) throw new SlidesError("validation", error.message);
    throw error;
  }
}

/** Relecture tolérante : un texte enrichi périmé ou invalide retombe en texte brut. */
function readRuns(value: unknown, text: string): TextRun[] | null {
  try {
    return validateRuns(value, text);
  } catch {
    return null;
  }
}

async function requirePresentation(
  actor: Actor,
  fileId: string,
): Promise<{
  entry: DriveEntry;
  presentationId: string;
  revision: number;
  aspect: SlideAspectId;
  theme: SlideThemeId;
  transition: SlideTransitionId;
  transitionMs: number;
}> {
  const entry = await getEntry(actor, fileId);
  if (entry.mimeType !== SLIDES_MIME) {
    throw new SlidesError("not_found", "Présentation introuvable.");
  }
  const [row] = await db()
    .select()
    .from(presentations)
    .where(eq(presentations.fileId, fileId))
    .limit(1);
  if (!row || row.orgId !== actor.orgId) {
    throw new SlidesError("not_found", "Présentation introuvable.");
  }
  return {
    entry,
    presentationId: row.id,
    revision: row.revision,
    aspect: normalizeAspect(row.aspect),
    theme: normalizeTheme(row.theme),
    transition: normalizeTransition(row.transition),
    transitionMs: normalizeTransitionMs(row.transitionMs),
  };
}

async function loadSlides(presentationId: string): Promise<SlideView[]> {
  const slides = await db()
    .select()
    .from(presentationSlides)
    .where(eq(presentationSlides.presentationId, presentationId))
    .orderBy(asc(presentationSlides.position));

  const slideIds = slides.map((slide) => slide.id);
  const elements =
    slideIds.length > 0
      ? await db()
          .select()
          .from(slideElements)
          .where(inArray(slideElements.slideId, slideIds))
          .orderBy(asc(slideElements.slideId), asc(slideElements.position))
      : [];

  const bySlide = new Map<string, ElementView[]>();
  for (const element of elements) {
    const list = bySlide.get(element.slideId) ?? [];
    list.push({
      id: element.id,
      kind: element.kind as ElementKind,
      x: element.x,
      y: element.y,
      w: element.w,
      h: element.h,
      text: element.text,
      mediaKey: element.mediaKey,
      fontSize: element.fontSize,
      bold: element.bold,
      italic: element.italic,
      underline: element.underline,
      textColor: normalizeTextColor(element.textColor),
      placeholder: normalizePlaceholder(element.placeholder),
      align: element.align as ElementAlign,
      fill: normalizeFill(element.fill),
      rotation: normalizeRotation(element.rotation),
      runs: readRuns(element.rich, element.text),
    });
    bySlide.set(element.slideId, list);
  }

  return slides.map((slide: PresentationSlideRow) => ({
    id: slide.id,
    position: slide.position,
    title: slide.title,
    notes: slide.notes,
    elements: bySlide.get(slide.id) ?? [],
  }));
}

// ---------------------------------------------------------------------------
// Cycle de vie
// ---------------------------------------------------------------------------

export async function createPresentation(
  actor: Actor,
  input: { parentFolderId?: string | null; title: string },
): Promise<{ entry: DriveEntry; presentation: { id: string; fileId: string } }> {
  const title = assertTitle(input.title);

  const entry = await createLinkedFile(actor, {
    parentId: input.parentFolderId ?? null,
    name: title,
    mimeType: SLIDES_MIME,
  });

  const presentation = await withTransaction(async (tx) => {
    const [created] = await tx
      .insert(presentations)
      .values({ orgId: actor.orgId, fileId: entry.id })
      .returning({ id: presentations.id, fileId: presentations.fileId });
    if (!created) throw new SlidesError("conflict", "Création de la présentation impossible.");
    const [slide] = await tx
      .insert(presentationSlides)
      .values({
        presentationId: created.id,
        position: 0,
        title: "Diapositive 1",
        notes: null,
      })
      .returning({ id: presentationSlides.id });
    if (!slide) throw new SlidesError("conflict", "Création de la présentation impossible.");
    // La première diapositive porte la mise en page « Titre » : un titre et
    // un sous-titre prêts à remplir, comme dans tout outil de présentation.
    const zones = layoutElements(TITLE_LAYOUT);
    if (zones.length > 0) {
      await tx.insert(slideElements).values(
        zones.map((zone, index) => ({
          slideId: slide.id,
          position: index,
          kind: "text",
          x: zone.x,
          y: zone.y,
          w: zone.w,
          h: zone.h,
          text: "",
          fontSize: zone.fontSize,
          bold: zone.bold,
          align: zone.align,
          placeholder: zone.placeholder,
        })),
      );
    }
    return created;
  });

  await recordAudit({
    orgId: actor.orgId,
    actorUserId: actor.userId,
    action: "slides.presentation.create",
    resourceType: "presentation",
    resourceId: entry.id,
    result: "success",
  });

  return { entry, presentation };
}

export async function getPresentation(actor: Actor, fileId: string): Promise<PresentationDetail> {
  const { entry, presentationId, revision, aspect, theme, transition, transitionMs } =
    await requirePresentation(actor, fileId);
  const role = await effectiveRole(actor, fileId);
  return {
    fileId: entry.id,
    title: entry.name,
    canEdit: roleSatisfies(role, "write"),
    revision,
    aspect,
    theme,
    transition,
    transitionMs,
    slides: await loadSlides(presentationId),
  };
}

/**
 * Valide un réglage de présentation (format ou thème) : les identifiants
 * inconnus sont refusés, jamais silencieusement remplacés — l'appelant sait
 * ainsi qu'il doit corriger sa valeur.
 */
function assertSetting<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new SlidesError("validation", `${label} inconnu.`);
  }
  return value as T;
}

/**
 * Change un réglage de présentation (format de la diapositive, thème,
 * transition). Ces réglages voyagent avec la scène : ils sont vérifiés ici
 * puis journalisés, car ils modifient l'aspect de toute la présentation.
 */
export async function updatePresentationSetting(
  actor: Actor,
  fileId: string,
  input: {
    aspect?: SlideAspectId;
    theme?: SlideThemeId;
    transition?: SlideTransitionId;
    transitionMs?: number;
  },
): Promise<PresentationDetail> {
  const { presentationId } = await requirePresentation(actor, fileId);
  const role = await effectiveRole(actor, fileId);
  if (!roleSatisfies(role, "write")) {
    throw new SlidesError("forbidden", "Permission insuffisante pour modifier cette présentation.");
  }

  const aspect =
    input.aspect === undefined
      ? undefined
      : assertSetting(input.aspect, SLIDE_ASPECT_IDS, "Format de diapositive");
  const theme =
    input.theme === undefined ? undefined : assertSetting(input.theme, SLIDE_THEME_IDS, "Thème");
  const transition =
    input.transition === undefined
      ? undefined
      : assertSetting(input.transition, SLIDE_TRANSITION_IDS, "Transition");
  const transitionMs =
    input.transitionMs === undefined ? undefined : normalizeTransitionMs(input.transitionMs);
  if (
    aspect === undefined &&
    theme === undefined &&
    transition === undefined &&
    transitionMs === undefined
  ) {
    throw new SlidesError("validation", "Aucun réglage à modifier.");
  }

  await db()
    .update(presentations)
    .set({
      ...(aspect === undefined ? {} : { aspect }),
      ...(theme === undefined ? {} : { theme }),
      ...(transition === undefined ? {} : { transition }),
      ...(transitionMs === undefined ? {} : { transitionMs }),
    })
    .where(eq(presentations.id, presentationId));

  // Un seul événement, avec les réglages effectivement modifiés.
  await recordAudit({
    orgId: actor.orgId,
    actorUserId: actor.userId,
    action: "slides.presentation.settings",
    resourceType: "presentation",
    resourceId: fileId,
    result: "success",
    metadata: {
      ...(aspect === undefined ? {} : { aspect }),
      ...(theme === undefined ? {} : { theme }),
      ...(transition === undefined ? {} : { transition }),
      ...(transitionMs === undefined ? {} : { transitionMs }),
    },
  });

  return getPresentation(actor, fileId);
}

/**
 * Sauvegarde optimiste des diapositives (l'éditeur envoie l'état courant).
 * Les identifiants fournis ne sont honorés que s'ils appartiennent déjà à
 * cette présentation ; sinon de nouvelles lignes sont insérées. Une révision
 * périmée déclenche un conflit, sans aucune écriture.
 *
 * Volontairement NON journalisée dans l'audit : l'éditeur sauvegarde
 * automatiquement plusieurs fois par minute ; un événement par sauvegarde
 * noierait le journal. Le nettoyage best-effort des images retirées ci-dessous
 * (objet de stockage supprimé) n'écrit pas d'événement non plus.
 */
export async function savePresentation(
  actor: Actor,
  fileId: string,
  input: SavePresentationInput,
): Promise<PresentationDetail> {
  const { presentationId } = await requirePresentation(actor, fileId);
  const role = await effectiveRole(actor, fileId);
  if (!roleSatisfies(role, "write")) {
    throw new SlidesError("forbidden", "Permission insuffisante pour modifier cette présentation.");
  }

  const revision = assertRevision(input.revision);
  const slides = assertSlides(input.slides);

  // Clés média encore référencées par le payload : sert à savoir quelles
  // images retirées peuvent être supprimées du stockage après commit.
  const keptMediaKeys = new Set<string>();
  for (const slide of slides) {
    for (const element of slide.elements) {
      if (element.mediaKey) keptMediaKeys.add(element.mediaKey);
    }
  }
  // Images présentes en base que le payload ne référence plus (remplies dans
  // la transaction, supprimées seulement une fois le commit acquis).
  const removedMediaKeys = new Set<string>();

  const nextRevision = await withTransaction(async (tx) => {
    const [bumped] = await tx
      .update(presentations)
      .set({ revision: sql`${presentations.revision} + 1` })
      .where(and(eq(presentations.id, presentationId), eq(presentations.revision, revision)))
      .returning({ revision: presentations.revision });
    if (!bumped) {
      throw new SlidesError(
        "conflict",
        "La présentation a été modifiée ailleurs — rechargez la page.",
      );
    }

    const existingSlides = await tx
      .select({ id: presentationSlides.id })
      .from(presentationSlides)
      .where(eq(presentationSlides.presentationId, presentationId));
    const knownSlideIds = new Set(existingSlides.map((row) => row.id));

    const existingElements = await tx
      .select({ id: slideElements.id, mediaKey: slideElements.mediaKey })
      .from(slideElements)
      .innerJoin(presentationSlides, eq(slideElements.slideId, presentationSlides.id))
      .where(eq(presentationSlides.presentationId, presentationId));
    const knownElementIds = new Set(existingElements.map((row) => row.id));

    const keptSlideIds = new Set<string>();
    const keptElementsBySlide = new Map<string, Set<string>>();

    for (const [slideIndex, slide] of slides.entries()) {
      const title = slide.title ?? `Diapositive ${slideIndex + 1}`;
      let slideId: string;
      if (slide.id && knownSlideIds.has(slide.id)) {
        slideId = slide.id;
        await tx
          .update(presentationSlides)
          .set({ position: slideIndex, title, notes: slide.notes ?? null })
          .where(eq(presentationSlides.id, slideId));
      } else {
        const [created] = await tx
          .insert(presentationSlides)
          .values({ presentationId, position: slideIndex, title, notes: slide.notes ?? null })
          .returning({ id: presentationSlides.id });
        if (!created) throw new SlidesError("conflict", "Sauvegarde impossible.");
        slideId = created.id;
      }
      keptSlideIds.add(slideId);

      const keptElementIds = new Set<string>();
      keptElementsBySlide.set(slideId, keptElementIds);
      for (const [elementIndex, element] of slide.elements.entries()) {
        const values = {
          slideId,
          position: elementIndex,
          kind: element.kind,
          x: element.x,
          y: element.y,
          w: element.w,
          h: element.h,
          text: element.text,
          mediaKey: element.mediaKey ?? null,
          fontSize: element.fontSize,
          bold: element.bold,
          italic: element.italic,
          underline: element.underline,
          textColor: element.textColor,
          placeholder: element.placeholder,
          align: element.align,
          fill: element.fill,
          rotation: element.rotation,
          rich: element.runs ?? null,
        };
        if (element.id && knownElementIds.has(element.id)) {
          keptElementIds.add(element.id);
          await tx.update(slideElements).set(values).where(eq(slideElements.id, element.id));
        } else {
          const [created] = await tx
            .insert(slideElements)
            .values(values)
            .returning({ id: slideElements.id });
          if (!created) throw new SlidesError("conflict", "Sauvegarde impossible.");
          keptElementIds.add(created.id);
        }
      }
    }

    // Suppression des éléments retirés, une fois tous les déplacements faits.
    for (const [slideId, keptElementIds] of keptElementsBySlide) {
      const removed = [...keptElementIds];
      await tx
        .delete(slideElements)
        .where(
          removed.length === 0
            ? eq(slideElements.slideId, slideId)
            : and(eq(slideElements.slideId, slideId), notInArray(slideElements.id, removed)),
        );
    }

    // Suppression des diapositives retirées (cascade sur leurs éléments).
    await tx
      .delete(presentationSlides)
      .where(
        and(
          eq(presentationSlides.presentationId, presentationId),
          notInArray(presentationSlides.id, [...keptSlideIds]),
        ),
      );

    // Images retirées du payload (leur objet de stockage sera nettoyé après
    // le commit, en best-effort).
    for (const row of existingElements) {
      if (row.mediaKey && !keptMediaKeys.has(row.mediaKey)) removedMediaKeys.add(row.mediaKey);
    }

    return bumped.revision;
  });

  // Nettoyage best-effort des images retirées, APRÈS commit : un échec laisse
  // un objet orphelin sans jamais défaire la sauvegarde, et seuls les objets
  // de cette présentation sont visés (anti-IDOR sur les clés).
  const ownPrefix = `slides/${presentationId}/`;
  const removableMediaKeys = [...removedMediaKeys].filter((key) => key.startsWith(ownPrefix));
  if (removableMediaKeys.length > 0) {
    const { getStorage } = await import("@workspace/storage");
    for (const key of removableMediaKeys) {
      await getStorage()
        .delete(key)
        .catch(() => undefined);
    }
  }

  await touchEntry(actor, fileId).catch(() => undefined);
  const detail = await getPresentation(actor, fileId);
  return { ...detail, revision: nextRevision };
}

/**
 * Téléverse une image d'illustration. Le binaire vit dans le stockage objet,
 * la clé reste confinée à la présentation : `slides/<id>/<uuid>.<ext>`.
 */
export async function uploadSlideImage(
  actor: Actor,
  fileId: string,
  input: { contentType: string; body: Buffer },
): Promise<{ mediaKey: string }> {
  const { presentationId } = await requirePresentation(actor, fileId);
  const role = await effectiveRole(actor, fileId);
  if (!roleSatisfies(role, "write")) {
    throw new SlidesError("forbidden", "Permission insuffisante pour modifier cette présentation.");
  }

  const contentType = input.contentType.trim().toLowerCase();
  const extension = IMAGE_CONTENT_TYPES[contentType];
  if (!extension) {
    throw new SlidesError(
      "validation",
      "Format d'image non pris en charge (PNG, JPEG, WebP, GIF ou AVIF).",
    );
  }
  if (input.body.length === 0) {
    throw new SlidesError("validation", "Image vide.");
  }
  if (input.body.length > MAX_SLIDE_IMAGE_BYTES) {
    throw new SlidesError("validation", "Image trop volumineuse (8 Mo maximum).");
  }

  const mediaKey = `slides/${presentationId}/${randomUUID()}.${extension}`;
  const { getStorage } = await import("@workspace/storage");
  await getStorage().put({ key: mediaKey, body: input.body, contentType });

  await recordAudit({
    orgId: actor.orgId,
    actorUserId: actor.userId,
    action: "slides.image.upload",
    resourceType: "presentation",
    resourceId: fileId,
    result: "success",
    metadata: { mediaKey },
  });

  return { mediaKey };
}

/**
 * Relit une image de la présentation. La clé DOIT être préfixée par
 * `slides/<presentationId>/` : impossible de lire l'image d'une autre
 * présentation en devinant sa clé (anti-IDOR). Le type MIME est dérivé de
 * l'extension ; toute erreur (clé étrangère, objet absent) est une erreur
 * métier que la route traduit en 404.
 */
export async function getSlideImage(
  actor: Actor,
  fileId: string,
  mediaKey: string,
): Promise<{ contentType: string; body: Buffer }> {
  const { presentationId } = await requirePresentation(actor, fileId);
  const prefix = `slides/${presentationId}/`;
  if (typeof mediaKey !== "string" || !mediaKey.startsWith(prefix)) {
    throw new SlidesError("validation", "Clé média invalide.");
  }

  const { getStorage } = await import("@workspace/storage");
  const body = await getStorage().get(mediaKey);
  if (!body) {
    throw new SlidesError("not_found", "Image introuvable.");
  }

  const extension = mediaKey.split(".").pop()?.toLowerCase() ?? "";
  return {
    contentType: IMAGE_EXTENSION_TYPES[extension] ?? "application/octet-stream",
    body,
  };
}

/**
 * Recopie une image d'une autre présentation (collage d'éléments entre
 * présentations) : lecture contrôlée sur la source (anti-IDOR inchangé),
 * écriture contrôlée sur la cible ; renvoie la nouvelle clé de la cible.
 */
export async function copySlideImage(
  actor: Actor,
  fileId: string,
  input: { sourceFileId: string; mediaKey: string },
): Promise<{ mediaKey: string }> {
  if (input.sourceFileId === fileId) {
    const { presentationId } = await requirePresentation(actor, fileId);
    if (input.mediaKey.startsWith(`slides/${presentationId}/`)) return { mediaKey: input.mediaKey };
  }
  const image = await getSlideImage(actor, input.sourceFileId, input.mediaKey);
  return uploadSlideImage(actor, fileId, { contentType: image.contentType, body: image.body });
}

export async function renamePresentation(
  actor: Actor,
  fileId: string,
  title: string,
): Promise<DriveEntry> {
  const clean = assertTitle(title);
  await requirePresentation(actor, fileId);
  const entry = await driveRename(actor, fileId, clean);

  await recordAudit({
    orgId: actor.orgId,
    actorUserId: actor.userId,
    action: "slides.presentation.rename",
    resourceType: "presentation",
    resourceId: fileId,
    result: "success",
  });

  return entry;
}

/** Présentations visibles (fichiers Drive liés). */
export async function listPresentations(
  actor: Actor,
): Promise<{ fileId: string; title: string; updatedAt: string; canEdit: boolean }[]> {
  const rows = await db()
    .select({ fileId: presentations.fileId })
    .from(presentations)
    .where(eq(presentations.orgId, actor.orgId))
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
  return visible.sort((a, b) => {
    if (a.updatedAt < b.updatedAt) return 1;
    if (a.updatedAt > b.updatedAt) return -1;
    return 0;
  });
}
