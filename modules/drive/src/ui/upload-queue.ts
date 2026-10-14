/**
 * File de téléversement : état par fichier, avec reprise sur échec.
 *
 * Réducteur pur (test/upload-queue.test.ts) : le composant se contente de
 * l'appliquer et de lancer les requêtes. Chaque fichier garde son propre sort —
 * un échec n'annule pas les autres, et se relance seul.
 */

/** État d'un fichier dans la file. */
export type UploadStatus = "pending" | "uploading" | "done" | "error";

export type UploadItem = {
  /** Clé locale stable (un fichier peut être repris plusieurs fois). */
  id: string;
  name: string;
  status: UploadStatus;
  /** Message d'erreur en français, présent seulement après un échec. */
  message?: string;
  /** Taille en octets, si connue (reprise d'un même fichier). */
  size?: number;
  /**
   * Progression réelle de l'envoi, de 0 à 1 — renseignée par les événements
   * `upload.onprogress` de la requête, jamais simulée. Absente tant que l'envoi
   * n'a pas commencé.
   */
  progress?: number;
};

/** Message par défaut quand l'échec n'est pas explicable. */
const FALLBACK_ERROR = "Échec de l'envoi.";

/** Ajoute des fichiers en file d'attente ; un fichier déjà présent repart de zéro. */
export function enqueueUploads(state: UploadItem[], files: UploadItem[]): UploadItem[] {
  const known = new Map(state.map((item) => [item.id, item]));
  for (const file of files) {
    // Reprise : le statut et le message d'erreur repartent de zéro, la place
    // dans la file est conservée.
    const previous = known.get(file.id);
    known.set(file.id, {
      ...file,
      status: "pending",
      message: undefined,
      size: previous?.size ?? file.size,
      progress: undefined,
    });
  }
  return [...known.values()];
}

/**
 * Borne une progression à l'intervalle [0, 1] ; une valeur non finie (division
 * par zéro d'un `lengthComputable` douteux) retombe à 0 plutôt que d'afficher
 * une barre cassée.
 */
export function clampProgress(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(value, 0), 1);
}

/** Passe un ou plusieurs fichiers à l'état « envoi en cours » (progression remise à zéro). */
export function markUploading(state: UploadItem[], ids: readonly string[]): UploadItem[] {
  const targets = new Set(ids);
  return state.map((item) =>
    targets.has(item.id) ? { ...item, status: "uploading", message: undefined, progress: 0 } : item,
  );
}

/**
 * Enregistre la progression réelle d'un envoi. Ignore un identifiant inconnu :
 * un événement tardif (fichier retiré de la file) ne recrée pas de ligne.
 */
export function markUploadProgress(
  state: UploadItem[],
  id: string,
  progress: number,
): UploadItem[] {
  const value = clampProgress(progress);
  return state.map((item) =>
    item.id === id && item.status === "uploading" ? { ...item, progress: value } : item,
  );
}

/** Marque un fichier comme envoyé (progression complète). */
export function markUploaded(state: UploadItem[], id: string): UploadItem[] {
  return state.map((item) =>
    item.id === id ? { ...item, status: "done", message: undefined, progress: 1 } : item,
  );
}

/** Marque un fichier en échec, avec son message (jamais écrasé par un message vide). */
export function markUploadFailed(
  state: UploadItem[],
  id: string,
  message = FALLBACK_ERROR,
): UploadItem[] {
  const text = message.trim().length > 0 ? message : FALLBACK_ERROR;
  return state.map((item) => (item.id === id ? { ...item, status: "error", message: text } : item));
}

/** Pourcentage entier (0..100) d'un envoi, pour la barre de progression. */
export function uploadPercent(item: UploadItem): number {
  if (item.status === "done") return 100;
  return Math.round(clampProgress(item.progress ?? 0) * 100);
}

/** Libellé français de la progression (« 42 % »), accordé à l'affichage. */
export function uploadPercentLabel(item: UploadItem): string {
  return `${uploadPercent(item)} %`;
}

/** Vrai si un envoi en cours a une progression réelle à montrer (barre déterminée). */
export function hasKnownProgress(item: UploadItem): boolean {
  return item.status === "uploading" && item.progress !== undefined;
}

/** Identifiants des fichiers à relancer : en attente ou en échec. */
export function pendingUploadIds(state: readonly UploadItem[]): string[] {
  return state
    .filter((item) => item.status === "pending" || item.status === "error")
    .map((i) => i.id);
}

/** Nombre de fichiers qui peuvent être relancés. */
export function failedUploadCount(state: readonly UploadItem[]): number {
  return state.filter((item) => item.status === "error").length;
}

/** Retire de la file les fichiers envoyés (les échecs restent, à relancer). */
export function clearFinishedUploads(state: readonly UploadItem[]): UploadItem[] {
  return state.filter((item) => item.status !== "done");
}

/**
 * Compte rendu de la file, en français accordé : « 3 fichiers envoyés,
 * 1 en échec. » ; une chaîne vide quand il n'y a rien à dire.
 */
export function uploadSummary(state: readonly UploadItem[]): string {
  if (state.length === 0) return "";
  const done = state.filter((item) => item.status === "done").length;
  const failed = failedUploadCount(state);
  const parts: string[] = [];

  if (done > 0) {
    parts.push(done === 1 ? "1 fichier envoyé" : `${done} fichiers envoyés`);
  }
  if (failed > 0) {
    parts.push(failed === 1 ? "1 en échec" : `${failed} en échec`);
  }
  if (parts.length === 0) {
    const left = pendingUploadIds(state).length;
    return left === 1 ? "1 fichier en attente." : `${left} fichiers en attente.`;
  }
  return `${parts.join(", ")}.`;
}

/** Libellé du bouton de reprise, accordé au nombre d'échecs. */
export function retryLabel(failedCount: number): string {
  return failedCount === 1 ? "Réessayer l'envoi" : `Réessayer les ${failedCount} envois`;
}
