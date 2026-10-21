/**
 * Presse-papiers d'éléments entre présentations (et entre onglets).
 *
 * Copier dépose trois représentations : le texte brut (collable partout),
 * un fragment HTML portant les éléments sérialisés dans un attribut
 * `data-workspace-slides` (lu au collage par l'événement `paste`, y compris
 * dans un autre onglet ou une autre présentation), et une copie locale
 * (`localStorage`) pour les navigateurs qui ne transmettent pas le HTML.
 *
 * Les images référencent un média de la présentation **source** : le collage
 * dans une autre présentation les recopie côté serveur (contrôle d'accès en
 * lecture sur la source, en écriture sur la cible).
 *
 * Logique pure (encodage, validation, fraîcheur) : testable sans navigateur.
 */
import type { EditorElement } from "./editor-model.ts";

export const CLIPBOARD_VERSION = 1;
export const CLIPBOARD_STORAGE_KEY = "workspace.slides.clipboard";
/** Une copie locale plus vieille qu'une heure est ignorée. */
export const CLIPBOARD_TTL_MS = 60 * 60 * 1000;
export const MAX_CLIPBOARD_ELEMENTS = 100;

/** Élément transporté : sans clé React ni identifiant serveur. */
export type ClipboardElement = Omit<EditorElement, "key" | "id">;

export type SlidesClipboard = {
  v: typeof CLIPBOARD_VERSION;
  /** Fichier Drive de la présentation d'origine. */
  sourceFileId: string;
  copiedAt: number;
  elements: ClipboardElement[];
};

export function makeClipboard(
  sourceFileId: string,
  elements: readonly EditorElement[],
  now: number,
): SlidesClipboard {
  return {
    v: CLIPBOARD_VERSION,
    sourceFileId,
    copiedAt: now,
    elements: elements
      .slice(0, MAX_CLIPBOARD_ELEMENTS)
      .map(({ key: _key, id: _id, ...rest }) => ({ ...rest })),
  };
}

function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): string {
  const binary = atob(value);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/** Fragment HTML du presse-papiers (le texte brut reste lisible ailleurs). */
export function clipboardHtml(clip: SlidesClipboard, plainText: string): string {
  const escaped = plainText.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<span data-workspace-slides="${toBase64(JSON.stringify(clip))}">${escaped}</span>`;
}

/** Validation tolérante : `null` pour tout contenu inattendu (jamais d'exception). */
export function parseClipboard(
  raw: unknown,
  now: number,
  ttl = Number.POSITIVE_INFINITY,
): SlidesClipboard | null {
  if (typeof raw !== "object" || raw === null) return null;
  const value = raw as Partial<SlidesClipboard>;
  if (value.v !== CLIPBOARD_VERSION || typeof value.sourceFileId !== "string") return null;
  if (typeof value.copiedAt !== "number" || now - value.copiedAt > ttl) return null;
  if (!Array.isArray(value.elements) || value.elements.length === 0) return null;
  const elements = value.elements
    .slice(0, MAX_CLIPBOARD_ELEMENTS)
    .filter(
      (element): element is ClipboardElement =>
        typeof element === "object" &&
        element !== null &&
        typeof (element as ClipboardElement).kind === "string" &&
        typeof (element as ClipboardElement).text === "string" &&
        [element.x, element.y, element.w, element.h].every(
          (n) => typeof n === "number" && Number.isFinite(n),
        ),
    );
  if (elements.length === 0) return null;
  return {
    v: CLIPBOARD_VERSION,
    sourceFileId: value.sourceFileId,
    copiedAt: value.copiedAt,
    elements,
  };
}

/** Lit les éléments d'un fragment HTML collé ; `null` s'il n'en porte pas. */
export function clipboardFromHtml(html: string, now: number): SlidesClipboard | null {
  const match = /data-workspace-slides="([A-Za-z0-9+/=]+)"/.exec(html);
  if (!match?.[1]) return null;
  try {
    return parseClipboard(JSON.parse(fromBase64(match[1])), now);
  } catch {
    return null;
  }
}

/** Lit la copie locale (autre onglet) si elle est encore fraîche. */
export function clipboardFromStorage(stored: string | null, now: number): SlidesClipboard | null {
  if (!stored) return null;
  try {
    return parseClipboard(JSON.parse(stored), now, CLIPBOARD_TTL_MS);
  } catch {
    return null;
  }
}

/**
 * Décalage des éléments collés : sur la même diapositive d'origine on décale
 * (comme PowerPoint), sinon on conserve la position exacte.
 */
export function pastedPosition(
  element: ClipboardElement,
  offset: number,
): Pick<ClipboardElement, "x" | "y"> {
  const x = Math.min(Math.max(0, element.x + offset), Math.max(0, 100 - element.w));
  const y = Math.min(Math.max(0, element.y + offset), Math.max(0, 100 - element.h));
  return { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 };
}
