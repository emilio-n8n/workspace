/**
 * Types MIME autorisés à l'affichage `inline` par la route de téléchargement.
 *
 * Le type MIME vient du client à l'upload : il ne doit jamais permettre de
 * rendre du HTML ou du SVG sur l'origine de l'application. Tout le reste part
 * en pièce jointe (`attachment`) et avec `X-Content-Type-Options: nosniff`.
 */
const INLINE_IMAGE = /^image\/(png|jpeg|gif|webp|avif|bmp)$/;
const INLINE_TEXT = new Set([
  "text/plain",
  "text/markdown",
  "application/json",
  "application/x-yaml",
  "application/yaml",
]);

export function isInlinePreviewSafe(mimeType: string | null | undefined): boolean {
  if (!mimeType) return false;
  if (mimeType === "application/pdf") return true;
  if (INLINE_TEXT.has(mimeType)) return true;
  if (INLINE_IMAGE.test(mimeType)) return true;
  return /^(audio|video)\//.test(mimeType);
}
