import { randomUUID } from "node:crypto";
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

/** Type MIME du pointeur Drive d'une présentation Workspace. */
export const SLIDES_MIME = "application/vnd.workspace.slides+json";

const MAX_SLIDES = 100;
const MAX_ELEMENTS_PER_SLIDE = 100;
const MAX_TEXT_CHARS = 2000;
const MAX_NOTES_CHARS = 5000;

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

export type ElementKind = "text" | "shape" | "image";
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
  align: ElementAlign;
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
  slides: SlideView[];
};

export type ElementInput = Omit<ElementView, "id"> & { id?: string };
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

const ELEMENT_KINDS = ["text", "shape", "image"] as const;
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
      throw new SlidesError("validation", "Les notes sont limitées à 5000 caractères.");
    }
    return {
      id: typeof slide.id === "string" ? slide.id : undefined,
      title: (slide.title ?? "").trim().slice(0, 255) || null,
      notes: (slide.notes ?? "").trim() || null,
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
          align: element.align as ElementAlign,
        };
      }),
    };
  });
}

async function requirePresentation(
  actor: Actor,
  fileId: string,
): Promise<{ entry: DriveEntry; presentationId: string; revision: number }> {
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
  return { entry, presentationId: row.id, revision: row.revision };
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
      align: element.align as ElementAlign,
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
    await tx.insert(presentationSlides).values({
      presentationId: created.id,
      position: 0,
      title: "Diapositive 1",
      notes: null,
    });
    return created;
  });

  return { entry, presentation };
}

export async function getPresentation(actor: Actor, fileId: string): Promise<PresentationDetail> {
  const { entry, presentationId, revision } = await requirePresentation(actor, fileId);
  const role = await effectiveRole(actor, fileId);
  return {
    fileId: entry.id,
    title: entry.name,
    canEdit: roleSatisfies(role, "write"),
    revision,
    slides: await loadSlides(presentationId),
  };
}

/**
 * Sauvegarde optimiste des diapositives (l'éditeur envoie l'état courant).
 * Les identifiants fournis ne sont honorés que s'ils appartiennent déjà à
 * cette présentation ; sinon de nouvelles lignes sont insérées. Une révision
 * périmée déclenche un conflit, sans aucune écriture.
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
          align: element.align,
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

export async function renamePresentation(
  actor: Actor,
  fileId: string,
  title: string,
): Promise<DriveEntry> {
  const clean = assertTitle(title);
  await requirePresentation(actor, fileId);
  return driveRename(actor, fileId, clean);
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
