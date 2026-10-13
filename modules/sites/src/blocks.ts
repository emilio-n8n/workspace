/**
 * Constructeur de pages — modèle de **blocs** de Sites.
 *
 * Module pur : aucun accès réseau, aucune base, aucun React. Il décrit les
 * cinq blocs de la bibliothèque (titre, texte, image, bouton, colonnes),
 * leurs propriétés éditables (contenu, lien, style), les opérations d'édition
 * (création, propriété, déplacement, insertion, suppression), la
 * normalisation défensive des valeurs qui reviennent de la base et le rendu
 * HTML du document.
 *
 * Le service (`service.ts`) décide de ce qui est **persisté** (limites,
 * droits, audit) ; l'interface (`ui/blocks-*.tsx`) n'ajoute que la souris et
 * le clavier. Les deux s'appuient sur ce fichier, ce qui garantit qu'un
 * bloc affiché, un bloc enregistré et un bloc relu obéissent aux mêmes règles.
 */

import { escapeHtml } from "./markdown.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Types de blocs de la bibliothèque (TASK-001). */
export type SiteBlockKind = "heading" | "text" | "image" | "button" | "columns";

/** Alignement horizontal d'un bloc dans la page. */
export type SiteBlockAlign = "left" | "center" | "right";

/** Niveau de titre d'un bloc « titre » (H1 réservé au titre de la page). */
export type SiteBlockLevel = 1 | 2 | 3;

/** Largeur d'une image dans le flux de la page. */
export type SiteBlockWidth = "medium" | "large" | "full";

/** Apparence d'un bouton. */
export type SiteButtonStyle = "primary" | "secondary" | "ghost";

/** Nombre de colonnes d'un bloc « colonnes ». */
export type SiteColumnsCount = 2 | 3;

/** Blocs autorisés à l'intérieur d'un bloc « colonnes ». */
export type SiteInlineBlock =
  | { id: string; kind: "heading"; text: string; level: SiteBlockLevel; align: SiteBlockAlign }
  | { id: string; kind: "text"; text: string; align: SiteBlockAlign };

export type SiteBlock = SiteInlineBlock | SiteImageBlock | SiteButtonBlock | SiteColumnsBlock;

export type SiteImageBlock = {
  id: string;
  kind: "image";
  /** URL de l'image (http(s), chemin interne ou image bitmap en base64). */
  src: string;
  /** Texte alternatif, obligatoire pour l'accessibilité. */
  alt: string;
  width: SiteBlockWidth;
  align: SiteBlockAlign;
  rounded: boolean;
};

export type SiteButtonBlock = {
  id: string;
  kind: "button";
  label: string;
  /** Lien du bouton, assaini avant rendu (voir `safeUrl`). */
  href: string;
  style: SiteButtonStyle;
  align: SiteBlockAlign;
};

export type SiteColumnsBlock = {
  id: string;
  kind: "columns";
  count: SiteColumnsCount;
  align: SiteBlockAlign;
  children: SiteInlineBlock[];
};

// ---------------------------------------------------------------------------
// Limites et constantes
// ---------------------------------------------------------------------------

/**
 * Limites de contenu, partagées par la validation d'écriture, la
 * normalisation de lecture et l'interface (longueurs maximales des champs).
 */
export const BLOCKS_LIMITS = {
  /** Blocs au premier niveau d'une page. */
  blocks: 100,
  /** Blocs à l'intérieur d'un bloc « colonnes ». */
  children: 6,
  /** Caractères d'un bloc texte multilingue. */
  text: 5_000,
  /** Caractères d'un titre de bloc. */
  heading: 200,
  /** Caractères d'un libellé de bouton. */
  label: 120,
  /** Caractères d'un texte alternatif. */
  alt: 300,
  /** Caractères d'une URL (lien ou image). */
  url: 2_048,
} as const;

export const BLOCK_KINDS = ["heading", "text", "image", "button", "columns"] as const;
export const BLOCK_ALIGNS = ["left", "center", "right"] as const;
export const BLOCK_LEVELS = [1, 2, 3] as const;
export const BLOCK_WIDTHS = ["medium", "large", "full"] as const;
export const BUTTON_STYLES = ["primary", "secondary", "ghost"] as const;
export const COLUMN_COUNTS = [2, 3] as const;

/** Identifiants de bloc : UUID attribué par le client, validé par le service. */
const BLOCK_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Préfixes d'URL et d'image autorisés (voir `safeUrl`). */
const SAFE_URL_PREFIXES = ["https://", "http://", "mailto:", "tel:"] as const;
const IMAGE_DATA_URI = /^data:image\/(?:png|jpe?g|gif|webp);base64,[a-z0-9+/=\s]+$/i;

// ---------------------------------------------------------------------------
// Bibliothèque de blocs (TASK-001)
// ---------------------------------------------------------------------------

/** Famille d'une propriété, pour regrouper le panneau de propriétés. */
export type BlockFieldGroup = "content" | "link" | "style";

/** Valeur éditable d'une propriété. */
export type SiteBlockValue = string | boolean;

export type BlockFieldOption = { value: string; label: string };

/**
 * Description déclarative d'une propriété éditable : le panneau de
 * propriétés en dérive ses champs, la normalisation en dérive ses contrôles
 * et les tests en dérivent leurs cas. Une seule vérité.
 */
export type BlockField =
  | {
      group: BlockFieldGroup;
      key: string;
      label: string;
      type: "text";
      maxLength: number;
      multiline?: boolean;
      placeholder?: string;
      help?: string;
    }
  | {
      group: BlockFieldGroup;
      key: string;
      label: string;
      type: "link";
      maxLength: number;
      /** Contrôle d'URL appliqué au rendu (`safeUrl` ou `safeImageUrl`). */
      target: "url" | "image";
      placeholder?: string;
      help?: string;
    }
  | {
      group: BlockFieldGroup;
      key: string;
      label: string;
      type: "select";
      options: readonly BlockFieldOption[];
      help?: string;
    }
  | {
      group: BlockFieldGroup;
      key: string;
      label: string;
      type: "toggle";
      help?: string;
    };

export type BlockDefinition = {
  kind: SiteBlockKind;
  label: string;
  description: string;
  /** Propriétés du bloc, dans l'ordre du panneau. */
  fields: readonly BlockField[];
};

const ALIGN_OPTIONS = [
  { value: "left", label: "Gauche" },
  { value: "center", label: "Centré" },
  { value: "right", label: "Droite" },
] as const;

export const BLOCK_LIBRARY: readonly BlockDefinition[] = [
  {
    kind: "heading",
    label: "Titre",
    description: "Un titre de section, jusqu'à trois niveaux.",
    fields: [
      {
        group: "content",
        key: "text",
        label: "Texte du titre",
        type: "text",
        maxLength: BLOCKS_LIMITS.heading,
        placeholder: "Notre engagement",
      },
      {
        group: "style",
        key: "level",
        label: "Niveau",
        type: "select",
        options: [
          { value: "1", label: "Titre principal" },
          { value: "2", label: "Section" },
          { value: "3", label: "Sous-section" },
        ],
      },
      { group: "style", key: "align", label: "Alignement", type: "select", options: ALIGN_OPTIONS },
    ],
  },
  {
    kind: "text",
    label: "Texte",
    description: "Un paragraphe de texte enrichi, multiligne.",
    fields: [
      {
        group: "content",
        key: "text",
        label: "Texte",
        type: "text",
        maxLength: BLOCKS_LIMITS.text,
        multiline: true,
        placeholder: "Décrivez votre activité…",
      },
      { group: "style", key: "align", label: "Alignement", type: "select", options: ALIGN_OPTIONS },
    ],
  },
  {
    kind: "image",
    label: "Image",
    description: "Une image avec son texte alternatif.",
    fields: [
      {
        group: "content",
        key: "src",
        label: "URL de l'image",
        type: "link",
        target: "image",
        maxLength: BLOCKS_LIMITS.url,
        placeholder: "https://exemple.org/photo.jpg",
        help: "Adresses http(s) ou chemins internes au site.",
      },
      {
        group: "content",
        key: "alt",
        label: "Texte alternatif",
        type: "text",
        maxLength: BLOCKS_LIMITS.alt,
        placeholder: "Photographie de l'équipe",
        help: "Décrit l'image pour les lecteurs d'écran.",
      },
      {
        group: "style",
        key: "width",
        label: "Largeur",
        type: "select",
        options: [
          { value: "medium", label: "Moyenne" },
          { value: "large", label: "Grande" },
          { value: "full", label: "Pleine largeur" },
        ],
      },
      { group: "style", key: "align", label: "Alignement", type: "select", options: ALIGN_OPTIONS },
      { group: "style", key: "rounded", label: "Coins arrondis", type: "toggle" },
    ],
  },
  {
    kind: "button",
    label: "Bouton",
    description: "Un bouton d'action vers un lien.",
    fields: [
      {
        group: "content",
        key: "label",
        label: "Libellé",
        type: "text",
        maxLength: BLOCKS_LIMITS.label,
        placeholder: "Nous contacter",
      },
      {
        group: "link",
        key: "href",
        label: "Lien",
        type: "link",
        target: "url",
        maxLength: BLOCKS_LIMITS.url,
        placeholder: "/contact",
        help: "http(s), mailto ou chemin interne commençant par / ou #.",
      },
      {
        group: "style",
        key: "style",
        label: "Apparence",
        type: "select",
        options: [
          { value: "primary", label: "Principale" },
          { value: "secondary", label: "Secondaire" },
          { value: "ghost", label: "Discrète" },
        ],
      },
      { group: "style", key: "align", label: "Alignement", type: "select", options: ALIGN_OPTIONS },
    ],
  },
  {
    kind: "columns",
    label: "Colonnes",
    description: "Deux ou trois colonnes de titres et de textes.",
    fields: [
      {
        group: "style",
        key: "count",
        label: "Nombre de colonnes",
        type: "select",
        options: [
          { value: "2", label: "2 colonnes" },
          { value: "3", label: "3 colonnes" },
        ],
      },
    ],
  },
];

/** Blocs que la bibliothèque autorise à l'intérieur des colonnes. */
export const COLUMN_CHILDREN: readonly SiteBlockKind[] = ["heading", "text"];

export function blockDefinition(kind: SiteBlockKind): BlockDefinition {
  const definition = BLOCK_LIBRARY.find((candidate) => candidate.kind === kind);
  if (!definition) throw new Error(`Bloc inconnu : ${kind}`);
  return definition;
}

/** Libellé lisible d'un bloc (utilisé dans les libellés d'accessibilité). */
export function blockLabel(kind: SiteBlockKind): string {
  return blockDefinition(kind).label;
}

/** Champs d'un bloc, dans l'ordre du panneau de propriétés. */
export function blockFields(kind: SiteBlockKind): readonly BlockField[] {
  return blockDefinition(kind).fields;
}

/** Champs d'un bloc appartenant à une famille donnée. */
export function blockFieldsByGroup(
  kind: SiteBlockKind,
  group: BlockFieldGroup,
): readonly BlockField[] {
  return blockFields(kind).filter((field) => field.group === group);
}

/** Groupes de propriétés réellement présents sur un bloc, dans l'ordre. */
export function blockGroups(kind: SiteBlockKind): readonly BlockFieldGroup[] {
  const groups: BlockFieldGroup[] = ["content", "link", "style"];
  return groups.filter((group) => blockFieldsByGroup(kind, group).length > 0);
}

// ---------------------------------------------------------------------------
// Création
// ---------------------------------------------------------------------------

function newId(): string {
  const random = globalThis.crypto?.randomUUID?.();
  if (!random) throw new Error("Génération d'identifiant indisponible.");
  return random;
}

/**
 * Bloc neuf d'un type donné, avec les valeurs par défaut de la bibliothèque.
 * `overrides` n'est utilisé qu'en interne (pont Markdown) : les valeurs
 * passées sont déjà contrôlées par la bibliothèque.
 */
export function createBlock(
  kind: SiteBlockKind,
  id: string = newId(),
  overrides: Record<string, unknown> = {},
): SiteBlock {
  const base = buildBlock(kind, id);
  return Object.keys(overrides).length === 0
    ? base
    : ({ ...base, ...overrides } as unknown as SiteBlock);
}

function buildBlock(kind: SiteBlockKind, id: string): SiteBlock {
  switch (kind) {
    case "heading":
      return { id, kind, text: "Titre de section", level: 2, align: "left" };
    case "text":
      return {
        id,
        kind,
        text: "Un paragraphe de texte : remplacez ce contenu par le vôtre.",
        align: "left",
      };
    case "image":
      return { id, kind, src: "", alt: "", width: "large", align: "center", rounded: true };
    case "button":
      return { id, kind, label: "En savoir plus", href: "", style: "primary", align: "left" };
    case "columns": {
      return {
        id,
        kind,
        count: 2,
        align: "left",
        children: [
          { id: newId(), kind: "text", text: "Première colonne", align: "left" },
          { id: newId(), kind: "text", text: "Deuxième colonne", align: "left" },
        ],
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Lecture / écriture défensives (valeurs venant de la base)
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pickString(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  return value.trim().slice(0, maxLength);
}

function pickEnum<T extends string | number | boolean>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

function pickBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function pickId(value: unknown): string | null {
  return typeof value === "string" && BLOCK_ID.test(value) ? value : null;
}

/**
 * Normalise un bloc **lu en base** : les champs absents ou corrompus
 * reprennent leur valeur par défaut, les champs inconnus sont abandonnés.
 * Un bloc sans identifiant valide ou de type inconnu est écarté (`null`).
 */
function normalizeBlock(value: unknown, depth: number): SiteBlock | null {
  if (!isRecord(value)) return null;
  const id = pickId(value.id);
  if (!id) return null;

  const align = pickEnum<SiteBlockAlign>(value.align, BLOCK_ALIGNS, "left");

  switch (value.kind) {
    case "heading":
      return {
        id,
        kind: "heading",
        text: pickString(value.text, BLOCKS_LIMITS.heading) ?? "",
        level: pickEnum<SiteBlockLevel>(value.level, BLOCK_LEVELS, 2),
        align,
      };
    case "text":
      return {
        id,
        kind: "text",
        text: pickString(value.text, BLOCKS_LIMITS.text) ?? "",
        align,
      };
    case "image":
      return {
        id,
        kind: "image",
        src: pickString(value.src, BLOCKS_LIMITS.url) ?? "",
        alt: pickString(value.alt, BLOCKS_LIMITS.alt) ?? "",
        width: pickEnum<SiteBlockWidth>(value.width, BLOCK_WIDTHS, "large"),
        align,
        rounded: pickBoolean(value.rounded, true),
      };
    case "button":
      return {
        id,
        kind: "button",
        label: pickString(value.label, BLOCKS_LIMITS.label) ?? "",
        href: pickString(value.href, BLOCKS_LIMITS.url) ?? "",
        style: pickEnum<SiteButtonStyle>(value.style, BUTTON_STYLES, "primary"),
        align,
      };
    case "columns": {
      // Profondeur plafonnée : un bloc « colonnes » n'accepte que des blocs
      // simples, jamais une imbrication supplémentaire.
      const children =
        depth === 0
          ? readBlocks(value.children, 1).filter(
              (child): child is SiteInlineBlock => child.kind !== "columns",
            )
          : [];
      return {
        id,
        kind: "columns",
        count: pickEnum<SiteColumnsCount>(value.count, COLUMN_COUNTS, 2),
        align,
        children,
      };
    }
    default:
      return null;
  }
}

/**
 * Lecture **tolérante** d'une liste de blocs : les entrées illisibles sont
 * écartées, les doublons d'identifiant aussi (la sélection en dépend). Un
 * bloc « colonnes » conserve ses enfants lisibles plutôt que de disparaître.
 */
function readBlocks(value: unknown, depth: number): SiteBlock[] {
  if (!Array.isArray(value)) return [];
  const limit = depth === 0 ? BLOCKS_LIMITS.blocks : BLOCKS_LIMITS.children;
  const blocks: SiteBlock[] = [];
  const seen = new Set<string>();
  for (const raw of value.slice(0, limit)) {
    const block = normalizeBlock(raw, depth);
    if (!block || seen.has(block.id)) continue;
    seen.add(block.id);
    blocks.push(block);
  }
  return blocks;
}

/** Limites atteintes d'une valeur reçue avant écriture, en français. */
function writeError(value: unknown, depth: number): string | null {
  if (value == null) return null;
  if (!Array.isArray(value)) return "La mise en page est invalide.";
  const limit = depth === 0 ? BLOCKS_LIMITS.blocks : BLOCKS_LIMITS.children;
  if (value.length > limit) {
    return depth === 0
      ? `${BLOCKS_LIMITS.blocks} blocs par page au maximum.`
      : `${BLOCKS_LIMITS.children} blocs par colonne au maximum.`;
  }
  const seen = new Set<string>();
  for (const raw of value) {
    if (!isRecord(raw)) return "Bloc invalide.";
    const kind = raw.kind;
    if (typeof kind !== "string" || !BLOCK_KINDS.includes(kind as SiteBlockKind)) {
      return `Type de bloc inconnu : ${String(kind)}.`;
    }
    if (depth > 0 && !COLUMN_CHILDREN.includes(kind as SiteBlockKind)) {
      return "Seuls les titres et les textes sont autorisés en colonne.";
    }
    if (typeof raw.id !== "string" || !BLOCK_ID.test(raw.id)) {
      return "Bloc invalide : identifiant manquant ou illisible.";
    }
    if (seen.has(raw.id)) return "Deux blocs portent le même identifiant.";
    seen.add(raw.id);
    if (kind === "columns") {
      const nested = writeError(raw.children, depth + 1);
      if (nested) return nested;
    }
  }
  return null;
}

/**
 * Normalise une mise en page **relue en base** : jamais d'exception, les
 * blocs illisibles sont écartés (une page reste toujours consultable).
 */
export function normalizeBlocks(value: unknown): SiteBlock[] {
  return readBlocks(value, 0);
}

/**
 * Normalise une mise en page **reçue pour écriture** et signale en français
 * la première raison de refus (limites, type inconnu, identifiants
 * dupliqués). `error === null` ⇒ le tableau est prêt à être enregistré.
 */
export function checkBlocks(value: unknown): { blocks: SiteBlock[]; error: string | null } {
  return { blocks: readBlocks(value, 0), error: writeError(value, 0) };
}

// ---------------------------------------------------------------------------
// Opérations d'édition
// ---------------------------------------------------------------------------

/** Bloc correspondant à un identifiant, dans toute la profondeur de la page. */
export function findBlock(blocks: readonly SiteBlock[], id: string): SiteBlock | null {
  for (const block of blocks) {
    if (block.id === id) return block;
    if (block.kind === "columns") {
      const found = findBlock(block.children, id);
      if (found) return found;
    }
  }
  return null;
}

function swap<T extends SiteBlock>(list: T[], from: number, to: number): T[] {
  const next = list.slice();
  const moved = next[from];
  const target = next[to];
  if (!moved || !target) return list;
  next[to] = moved;
  next[from] = target;
  return next;
}

/**
 * Déplace un bloc d'un cran vers le haut ou le bas **dans sa propre liste**
 * (premier niveau ou contenu d'une colonne). Un déplacement impossible
 * (bord ou identifiant inconnu) renvoie le tableau **inchangé** (même
 * référence) : l'appelant peut s'en servir pour éviter un rendu inutile.
 */
export function moveBlock<T extends SiteBlock>(
  blocks: T[],
  id: string,
  direction: "up" | "down",
): T[] {
  const index = blocks.findIndex((block) => block.id === id);
  if (index >= 0) {
    const target = direction === "up" ? index - 1 : index + 1;
    if (target < 0 || target >= blocks.length) return blocks;
    return swap(blocks, index, target);
  }
  for (let position = 0; position < blocks.length; position += 1) {
    const block = blocks[position];
    if (block?.kind !== "columns") continue;
    const children = moveBlock(block.children, id, direction);
    if (children === block.children) continue;
    const next = blocks.slice();
    next[position] = { ...block, children } as unknown as T;
    return next;
  }
  return blocks;
}

/** Insère un bloc après un bloc existant, ou en fin de page. */
export function insertBlock(
  blocks: SiteBlock[],
  block: SiteBlock,
  afterId: string | null,
): SiteBlock[] {
  const found = afterId === null ? -1 : blocks.findIndex((candidate) => candidate.id === afterId);
  // Sans cible connue (fin de page, ou sélection dans une colonne), le bloc
  // est ajouté en fin de liste plutôt qu'en tête.
  const next = blocks.slice();
  next.splice(found < 0 ? next.length : found + 1, 0, block);
  return next;
}

/** Retire un bloc, où qu'il se trouve dans la page. */
export function removeBlock<T extends SiteBlock>(blocks: T[], id: string): T[] {
  const next = blocks
    .filter((block) => block.id !== id)
    .map((block) => {
      if (block.kind !== "columns") return block;
      const children = removeBlock(block.children, id);
      // Colonne intacte : on conserve la référence d'origine.
      return children === block.children ? block : ({ ...block, children } as unknown as T);
    });
  if (next.length === blocks.length && next.every((block, index) => block === blocks[index])) {
    return blocks;
  }
  return next;
}

/**
 * Modification partielle d'un bloc. La clé `kind` vérifie que le
 * correctif vise bien le type du bloc ; `applyPatch` refuse tout le reste.
 * Ce typage évite qu'un correctif d'un type de bloc ne se retrouve
 * fusionné dans un bloc d'un autre type.
 */
type SiteBlockPatch =
  | { kind: "heading"; text?: string; level?: SiteBlockLevel; align?: SiteBlockAlign }
  | { kind: "text"; text?: string; align?: SiteBlockAlign }
  | {
      kind: "image";
      src?: string;
      alt?: string;
      width?: SiteBlockWidth;
      align?: SiteBlockAlign;
      rounded?: boolean;
    }
  | {
      kind: "button";
      label?: string;
      href?: string;
      style?: SiteButtonStyle;
      align?: SiteBlockAlign;
    }
  | {
      kind: "columns";
      count?: SiteColumnsCount;
      align?: SiteBlockAlign;
      children?: SiteInlineBlock[];
    };

/** Fusionne un correctif dans un bloc de même type, sinon renvoie le bloc. */
function applyPatch(block: SiteBlock, patch: SiteBlockPatch): SiteBlock {
  switch (patch.kind) {
    case "heading":
      return block.kind === "heading" ? { ...block, ...patch } : block;
    case "text":
      return block.kind === "text" ? { ...block, ...patch } : block;
    case "image":
      return block.kind === "image" ? { ...block, ...patch } : block;
    case "button":
      return block.kind === "button" ? { ...block, ...patch } : block;
    case "columns":
      return block.kind === "columns" ? { ...block, ...patch } : block;
  }
}

/**
 * Modifie une propriété d'un bloc. La clé inconnue ou la valeur hors bornes
 * sont ignorées : l'état de l'éditeur ne peut pas être corrompu par un
 * rendu partiel (le contrôle de l'interface est la dernière barrière).
 */
export function patchBlock(
  blocks: SiteBlock[],
  id: string,
  key: string,
  value: SiteBlockValue,
): SiteBlock[] {
  const target = findBlock(blocks, id);
  if (!target) return blocks;
  const patch = patchOf(target, key, value);
  if (!patch) return blocks;

  const rewrite = <T extends SiteBlock>(list: T[]): T[] => {
    let changed = false;
    const next = list.map((block): T => {
      if (block.id === id) {
        changed = true;
        // `applyPatch` renvoie le même type de bloc ; `T` en est un sous-type.
        return applyPatch(block, patch) as T;
      }
      if (block.kind === "columns") {
        const children = rewrite(block.children);
        if (children === block.children) return block;
        changed = true;
        return { ...block, children } as unknown as T;
      }
      return block;
    });
    return changed ? next : list;
  };

  return rewrite(blocks);
}

function patchOf(block: SiteBlock, key: string, value: SiteBlockValue): SiteBlockPatch | null {
  const align =
    key === "align" ? pickEnum<SiteBlockAlign>(value, BLOCK_ALIGNS, block.align) : undefined;
  switch (block.kind) {
    case "heading":
      if (key === "text") return { kind: "heading", text: textOf(value, BLOCKS_LIMITS.heading) };
      if (key === "level") {
        return {
          kind: "heading",
          level: pickEnum<SiteBlockLevel>(Number(value), BLOCK_LEVELS, block.level),
        };
      }
      return align ? { kind: "heading", align } : null;
    case "text":
      if (key === "text") return { kind: "text", text: textOf(value, BLOCKS_LIMITS.text) };
      return align ? { kind: "text", align } : null;
    case "image":
      if (key === "src") return { kind: "image", src: textOf(value, BLOCKS_LIMITS.url) };
      if (key === "alt") return { kind: "image", alt: textOf(value, BLOCKS_LIMITS.alt) };
      if (key === "width") {
        return { kind: "image", width: pickEnum<SiteBlockWidth>(value, BLOCK_WIDTHS, block.width) };
      }
      if (key === "rounded") return { kind: "image", rounded: pickBoolean(value, block.rounded) };
      return align ? { kind: "image", align } : null;
    case "button":
      if (key === "label") return { kind: "button", label: textOf(value, BLOCKS_LIMITS.label) };
      if (key === "href") return { kind: "button", href: textOf(value, BLOCKS_LIMITS.url) };
      if (key === "style") {
        return {
          kind: "button",
          style: pickEnum<SiteButtonStyle>(value, BUTTON_STYLES, block.style),
        };
      }
      return align ? { kind: "button", align } : null;
    case "columns":
      if (key === "count") {
        return {
          kind: "columns",
          count: pickEnum<SiteColumnsCount>(Number(value), COLUMN_COUNTS, block.count),
        };
      }
      return align ? { kind: "columns", align } : null;
  }
}

/** Texte ramené à la longueur maximale du champ. */
function textOf(value: SiteBlockValue, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

/** Bloc simple (titre ou texte) neuf, utilisable dans une colonne. */
export function createInlineBlock(
  kind: "heading" | "text",
  id: string = newId(),
  overrides: Record<string, unknown> = {},
): SiteInlineBlock {
  return createBlock(kind, id, overrides) as SiteInlineBlock;
}

/** Ajoute un bloc simple dans une colonne, en fin de colonne. */
export function addChildBlock(
  blocks: SiteBlock[],
  parentId: string,
  kind: "heading" | "text",
): SiteBlock[] {
  if (kind !== "heading" && kind !== "text") return blocks;
  const parent = findBlock(blocks, parentId);
  if (parent?.kind !== "columns") return blocks;
  if (parent.children.length >= BLOCKS_LIMITS.children) return blocks;
  return replaceChildren(blocks, parentId, [...parent.children, createInlineBlock(kind)]);
}

/** Remplace les enfants d'un bloc « colonnes ». */
export function replaceChildren(
  blocks: SiteBlock[],
  parentId: string,
  children: SiteInlineBlock[],
): SiteBlock[] {
  const parent = findBlock(blocks, parentId);
  if (parent?.kind !== "columns") return blocks;
  const rewrite = <T extends SiteBlock>(list: T[]): T[] => {
    let changed = false;
    const next = list.map((block) => {
      if (block.id === parentId) {
        changed = true;
        return { ...block, children: children.slice(0, BLOCKS_LIMITS.children) };
      }
      if (block.kind === "columns") {
        const nested = rewrite(block.children);
        if (nested === block.children) return block;
        changed = true;
        return { ...block, children: nested } as unknown as T;
      }
      return block;
    });
    return changed ? next : list;
  };
  return rewrite(blocks);
}

// ---------------------------------------------------------------------------
// URL assainies
// ---------------------------------------------------------------------------

/**
 * Supprime les caractères de contrôle et les espaces, que les navigateurs
 * ignorent dans les URL : sans ce nettoyage, `java\tscript:…` passerait pour
 * un chemin inoffensif alors qu'il s'agit d'un schéma dangereux.
 */
function cleanUrl(value: string): string {
  // Caractères de contrôle et espaces : les navigateurs les ignorent dans une
  // URL, un `javascript\t:` doit donc être reconnu comme `javascript:`.
  // biome-ignore lint/suspicious/noControlCharactersInRegex: plage ASCII volontaire, voir `safeUrl`.
  return value.replace(/[\u0000-\u0020\u007f]/g, "");
}

/**
 * URL utilisable dans un attribut `href` : http(s), mailto, tel, ou chemin
 * interne (`/`, `#`, `./`). Toute autre valeur (dont `javascript:`) ou toute
 * URL trop longue est refusée.
 */
export function safeUrl(value: string): string | null {
  const url = cleanUrl(value.trim());
  if (url.length === 0 || url.length > BLOCKS_LIMITS.url) return null;
  for (const prefix of SAFE_URL_PREFIXES) {
    if (url.toLowerCase().startsWith(prefix)) return url;
  }
  return url.startsWith("/") || url.startsWith("#") || url.startsWith("./") ? url : null;
}

/** URL utilisable comme source d'image (http(s), interne, ou bitmap base64). */
export function safeImageUrl(value: string): string | null {
  const url = cleanUrl(value.trim());
  if (url.length === 0 || url.length > BLOCKS_LIMITS.url) return null;
  if (IMAGE_DATA_URI.test(url)) return url;
  return url.startsWith("https://") || url.startsWith("http://") || url.startsWith("/")
    ? url
    : null;
}

// ---------------------------------------------------------------------------
// Rendu HTML
// ---------------------------------------------------------------------------

const ALIGN_BLOCK: Record<SiteBlockAlign, string> = {
  left: "justify-start text-left",
  center: "justify-center text-center",
  right: "justify-end text-right",
};

const IMAGE_WIDTH: Record<SiteBlockWidth, string> = {
  medium: "max-w-xs",
  large: "max-w-2xl",
  full: "w-full",
};

const BUTTON_APPEARANCE: Record<SiteButtonStyle, string> = {
  primary: "bg-primary text-primary-foreground shadow-soft hover:opacity-90",
  secondary: "border border-border bg-card text-foreground hover:bg-muted",
  ghost: "text-primary underline underline-offset-4 hover:opacity-80",
};

function html(value: string): string {
  return escapeHtml(value).replaceAll("\n", "<br />");
}

/** HTML d'un bloc, prêt à être inséré dans la page (aucune donnée brute). */
export function renderBlock(block: SiteBlock): string {
  const align = ALIGN_BLOCK[block.align];
  switch (block.kind) {
    case "heading": {
      const size = { 1: "text-3xl", 2: "text-2xl", 3: "text-lg" }[block.level];
      return `<div class="flex ${align}"><h${block.level} class="font-display ${size} font-semibold tracking-tight text-foreground">${html(block.text)}</h${block.level}></div>`;
    }
    case "text":
      return `<div class="flex ${align}"><p class="max-w-prose text-sm leading-relaxed text-foreground">${html(block.text)}</p></div>`;
    case "image": {
      const src = safeImageUrl(block.src);
      if (!src) {
        return `<div class="flex ${align}"><p class="max-w-prose text-sm text-muted-foreground">Image indisponible : renseignez une URL valide.</p></div>`;
      }
      const radius = block.rounded ? "rounded-xl" : "rounded-none";
      return `<div class="flex ${align}"><img src="${escapeHtml(src)}" alt="${escapeHtml(block.alt)}" loading="lazy" decoding="async" class="${IMAGE_WIDTH[block.width]} ${radius} border border-border object-cover" /></div>`;
    }
    case "button": {
      const appearance = BUTTON_APPEARANCE[block.style];
      const base = `inline-flex items-center rounded-lg px-4 py-2 text-sm font-medium ${appearance}`;
      const href = safeUrl(block.href);
      const inner = html(block.label);
      if (!href) {
        return `<div class="flex ${align}"><span class="${base} opacity-60">${inner}</span></div>`;
      }
      const external = href.startsWith("http://") || href.startsWith("https://");
      const attrs = external ? ' target="_blank" rel="noreferrer"' : "";
      return `<div class="flex ${align}"><a href="${escapeHtml(href)}" class="${base}"${attrs}>${inner}</a></div>`;
    }
    case "columns": {
      const template = block.count === 2 ? "1fr 1fr" : "1fr 1fr 1fr";
      const children = block.children.map(renderBlock).join("\n");
      return `<div class="grid gap-6" style="grid-template-columns: ${template}">${children}</div>`;
    }
  }
}

/** HTML d'une page entière (empilement des blocs). */
export function renderBlocks(blocks: readonly SiteBlock[]): string {
  return `<div class="flex flex-col gap-8">${blocks.map(renderBlock).join("\n")}</div>`;
}

// ---------------------------------------------------------------------------
// Pont Markdown ↔ blocs
// ---------------------------------------------------------------------------

const HEADING_LINE = /^(#{1,3})\s+(.*)$/;

/**
 * Convertit le contenu Markdown d'une page en blocs : chaque titre devient
 * un bloc « titre », chaque groupe de lignes non vides un bloc « texte ».
 * Sert de point de départ à la construction d'une page existante (TASK-001).
 */
export function markdownToBlocks(source: string): SiteBlock[] {
  const blocks: SiteBlock[] = [];
  let paragraph: string[] = [];

  const flush = () => {
    if (paragraph.length === 0) return;
    blocks.push(createBlock("text", newId(), { text: paragraph.join("\n") }));
    paragraph = [];
  };

  for (const line of source.replace(/\r\n?/g, "\n").split("\n")) {
    const heading = HEADING_LINE.exec(line);
    if (heading?.[1] && heading[2] !== undefined) {
      flush();
      blocks.push(
        createBlock("heading", newId(), {
          text: heading[2].trim().slice(0, BLOCKS_LIMITS.heading),
          level: Math.min(3, heading[1].length) as SiteBlockLevel,
        }),
      );
      continue;
    }
    if (line.trim().length > 0) paragraph.push(line.trim());
    else flush();
  }
  flush();
  return blocks;
}

/**
 * Convertit une mise en page en Markdown : chemin inverse, utile lorsque
 * l'utilisateur revient de l'éditeur de blocs à l'éditeur Markdown.
 */
export function blocksToMarkdown(blocks: readonly SiteBlock[]): string {
  const lines: string[] = [];
  for (const block of blocks) {
    switch (block.kind) {
      case "heading":
        lines.push(`${"#".repeat(block.level)} ${block.text.trim()}`.trim());
        break;
      case "text":
        lines.push(block.text.trim());
        break;
      case "image":
        if (block.src.trim().length > 0) lines.push(`![${block.alt.trim()}](${block.src.trim()})`);
        else if (block.alt.trim().length > 0) lines.push(block.alt.trim());
        break;
      case "button":
        lines.push(`[${block.label.trim()}](${block.href.trim()})`);
        break;
      case "columns":
        for (const child of block.children) lines.push(blocksToMarkdown([child]));
        break;
    }
  }
  return lines.join("\n\n").trim();
}
