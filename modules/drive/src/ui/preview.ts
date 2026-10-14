/**
 * Aperçu de fichier : décisions pures, sans DOM ni rendu.
 *
 * Extraites du navigateur pour être testables (test/preview.test.ts) : la
 * sélection du mode d'affichage, l'URL d'aperçu en ligne et le plafond de
 * lecture du texte. Le composant se contente de charger et d'afficher.
 */

/** Modes d'aperçu intégré (les autres fichiers passent par le dialogue de détails). */
export type PreviewMode = "image" | "pdf" | "text";

/**
 * Plafond du texte chargé pour l'aperçu (200 Kio) : le flux est coupé à cette
 * taille pour ne jamais aspirer un fichier entier dans l'onglet.
 */
export const TEXT_PREVIEW_LIMIT = 200 * 1024;

/** Mimes texte sans préfixe `text/` (JSON, Markdown, YAML) affichables dans l'aperçu. */
export const EXTRA_TEXT_MIMES: ReadonlySet<string> = new Set([
  "application/json",
  "application/markdown",
  "application/x-yaml",
  "application/yaml",
]);

/** Mode d'aperçu intégré selon le type MIME, ou null si le fichier n'est pas prévisualisable. */
export function previewModeFor(mimeType: string | null): PreviewMode | null {
  if (mimeType === null) return null;
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType === "application/pdf") return "pdf";
  if (mimeType.startsWith("text/") || EXTRA_TEXT_MIMES.has(mimeType)) return "text";
  return null;
}

/** URL d'aperçu en ligne : l'API répond en `content-disposition: inline`. */
export function previewUrl(id: string): string {
  return `/api/drive/download/${id}?inline=1`;
}

/**
 * Message de troncature de l'aperçu texte, en français : rappelle le plafond
 * sans le répéter à la main dans le composant.
 */
export function truncatedNotice(): string {
  return `Aperçu tronqué : seuls les ${Math.round(TEXT_PREVIEW_LIMIT / 1024)} premiers Kio sont affichés.`;
}

/**
 * Message d'échec de l'aperçu texte, en français : il nomme le problème et
 * laisse une issue (le téléchargement), pour ne pas laisser l'utilisateur dans
 * une impasse.
 */
export function textPreviewErrorMessage(): string {
  return "Le contenu du fichier n'a pas pu être chargé. Vous pouvez néanmoins le télécharger.";
}

/**
 * Message d'échec de l'aperçu image : le fichier existe peut-être encore, mais
 * le navigateur n'a pas su le décoder ou le chargement a échoué.
 */
export function imagePreviewErrorMessage(): string {
  return "L'image n'a pas pu être affichée. Vous pouvez néanmoins la télécharger.";
}
