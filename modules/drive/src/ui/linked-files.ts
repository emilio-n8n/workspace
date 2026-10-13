/**
 * Fichiers « liés » : leur contenu vit dans une autre application de la suite
 * (Docs, Sheets, Slides, Forms) et s'ouvre chez elle, jamais dans le Drive.
 *
 * Ces valeurs doublent les constantes de `@workspace/ui` (`DOCS_MIME`, …) pour
 * garder ce module — et les tests qui l'utilisent — sans dépendance au paquet
 * d'interface. Toute nouvelle application éditrice doit être ajoutée ici.
 */

/** Types MIME des fichiers ouverts par une application dédiée. */
export const LINKED_MIME_TYPES = [
  "application/vnd.workspace.docs+json",
  "application/vnd.workspace.sheets+json",
  "application/vnd.workspace.slides+json",
  "application/vnd.workspace.forms+json",
] as const;

/** Nombre maximal de fichiers joints à un téléchargement groupé. */
export const MAX_BULK_DOWNLOAD = 20;

const LINKED_MIME_SET: ReadonlySet<string> = new Set(LINKED_MIME_TYPES);

/** Vrai si le type MIME désigne un fichier ouvert par une autre application. */
export function isLinkedMime(mimeType: string | null): boolean {
  return mimeType !== null && LINKED_MIME_SET.has(mimeType);
}
