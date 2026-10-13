/**
 * Lecture locale d'un fichier destiné au téléversement : base64 (sans préfixe
 * `data:`) et progression réelle, lue par `FileReader`. La progression rend la
 * jauge du compositeur honnête — elle ne simule rien.
 */

export type ReadProgress = (loaded: number, total: number) => void;

/** Message d'erreur quand le navigateur refuse de lire le fichier. */
export function readErrorMessage(name: string): string {
  return `Lecture de « ${name} » impossible — vérifiez le fichier, puis réessayez.`;
}

/** Lit un fichier en base64, en reportant la progression (0 → size). */
export function readFileAsBase64(file: File, onProgress?: ReadProgress): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => {
      reject(new Error(readErrorMessage(file.name)));
    };
    reader.onabort = () => {
      reject(new Error(`Lecture de « ${file.name} » interrompue.`));
    };
    reader.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(event.loaded, event.total);
    };
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      const comma = result.indexOf(",");
      if (comma < 0) {
        reject(new Error(readErrorMessage(file.name)));
        return;
      }
      onProgress?.(file.size, file.size);
      resolve(result.slice(comma + 1));
    };
    reader.readAsDataURL(file);
  });
}

/** Type MIME de repli quand le navigateur n'en fournit pas. */
export function contentTypeOf(file: File): string {
  return file.type.trim() || "application/octet-stream";
}

/** Clé locale stable d'un fichier choisi (avant tout identifiant serveur). */
export function attachmentKey(file: File, salt: number): string {
  return `${salt}-${file.name}-${file.size}-${file.lastModified}`;
}
