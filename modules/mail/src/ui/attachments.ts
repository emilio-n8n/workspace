/**
 * Confort des pièces jointes du compositeur — fonctions pures, testées sans
 * navigateur : extraction du nom, bornes, jauge et cycle de vie d'un
 * téléversement (en attente → en cours → prêt | échec, avec reprise).
 */

/** Bornes alignées sur le service (MAX_ATTACHMENTS / MAX_ATTACHMENT_BYTES). */
export const MAX_ATTACHMENT_SLOTS = 5;
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
/** Enveloppe totale affichée par la jauge : 5 fichiers de 10 Mo. */
export const ATTACHMENT_BUDGET_BYTES = MAX_ATTACHMENT_SLOTS * MAX_ATTACHMENT_BYTES;

export type AttachmentPhase = "reading" | "uploading" | "ready" | "error";

/** Une pièce jointe en cours de composition, avec son état de téléversement. */
export type ComposerAttachment = {
  /** Clé locale stable (le fichier d'origine n'a pas d'identifiant serveur). */
  key: string;
  /** Nom déduit du fichier, jamais un chemin. */
  name: string;
  sizeBytes: number;
  contentType: string;
  phase: AttachmentPhase;
  /** Octets déjà lus (jauge de lecture), 0 à sizeBytes. */
  loadedBytes: number;
  /** Message d'erreur actionnable, rempli quand phase = "error". */
  error?: string;
  /** Jeton renvoyé par le serveur, présent quand phase = "ready". */
  token?: {
    storageKey: string;
    filename: string;
    contentType: string;
    sizeBytes: number;
  };
};

/** Taille lisible en unités françaises (o, Ko, Mo). */
export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 o";
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} Go`;
}

/**
 * Extrait le nom affichable d'un fichier : certains navigateurs fournissent un
 * chemin (« C:\fakepath\rapport.pdf »), les pièces reçues peuvent porter des
 * espaces ou des retours à la ligne. Seul le dernier segment est conservé, sans
 * séparateur, et jamais plus long que la borne du service.
 */
/** Caractères de contrôle interdits dans un nom de fichier (retour à la ligne, tabulation…). */
// biome-ignore lint/suspicious/noControlCharactersInRegex: la classe est là précisément pour les neutraliser.
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/g;

/**
 * Extrait le nom affichable d'un fichier : certains navigateurs fournissent un
 * chemin (« C:\fakepath\rapport.pdf »), les pièces reçues peuvent porter des
 * espaces ou des retours à la ligne. Seul le dernier segment est conservé, sans
 * séparateur, et jamais plus long que la borne du service.
 */
export function extractAttachmentName(raw: string, maxLength = 255): string {
  const unified = raw.replace(/\\/g, "/");
  const last = unified.split("/").pop() ?? "";
  const cleaned = last
    .replace(CONTROL_CHARACTERS, " ")
    .replace(/\s+/g, " ")
    .trim()
    // Un nom qui finit par des points ou des espaces trompe l'affichage.
    .replace(/[. ]+$/, "");
  if (cleaned.length === 0) return "";
  // Troncature par la fin : l'extension, porteuse de sens, est préservée.
  return cleaned.length > maxLength ? cleaned.slice(cleaned.length - maxLength) : cleaned;
}

/** Vrai si le fichier respecte la borne de taille (message prêt à afficher). */
export function isAttachmentTooLarge(sizeBytes: number): boolean {
  return sizeBytes > MAX_ATTACHMENT_BYTES;
}

/** Message d'erreur lisible pour un fichier dépassant la borne. */
export function oversizedMessage(name: string): string {
  return `« ${name} » dépasse ${formatFileSize(MAX_ATTACHMENT_BYTES)}.`;
}

/** Emplacements encore libres (0 quand le composeur est plein). */
export function remainingSlots(current: ComposerAttachment[]): number {
  return Math.max(0, MAX_ATTACHMENT_SLOTS - current.length);
}

/**
 * Message de refus quand la sélection dépasse les emplacements libres : la
 * sélection est tronquée, jamais silencieusement ignorée.
 */
export function tooManyMessage(selected: number, remaining: number): string {
  return `${MAX_ATTACHMENT_SLOTS} pièces jointes au maximum (${remaining} emplacement${remaining > 1 ? "s" : ""} restant${remaining > 1 ? "s" : ""} pour ${selected} fichier${selected > 1 ? "s" : ""}).`;
}

/** Progression de lecture d'un fichier, de 0 à 1. */
export function readProgress(attachment: ComposerAttachment): number {
  if (attachment.phase === "ready") return 1;
  if (attachment.sizeBytes <= 0) return attachment.phase === "error" ? 0 : 0.5;
  return Math.min(1, Math.max(0, attachment.loadedBytes / attachment.sizeBytes));
}

/** Occupation totale de l'enveloppe (0 à 1) — valeur de la jauge. */
export function budgetUsage(attachments: ComposerAttachment[]): number {
  const used = attachments.reduce((total, item) => total + item.sizeBytes, 0);
  return Math.min(1, used / ATTACHMENT_BUDGET_BYTES);
}

/** Octets déjà engagés par les pièces jointes du compositeur. */
export function usedBytes(attachments: ComposerAttachment[]): number {
  return attachments.reduce((total, item) => total + item.sizeBytes, 0);
}

/** Texte de la jauge : « 3 fichiers · 12,4 Mo sur 50 Mo ». */
export function budgetLabel(attachments: ComposerAttachment[]): string {
  const used = formatFileSize(usedBytes(attachments));
  return `${attachments.length} fichier${attachments.length > 1 ? "s" : ""} · ${used} sur ${formatFileSize(ATTACHMENT_BUDGET_BYTES)}`;
}

/** Pièces jointes effectivement prêtes à être envoyées. */
export function readyAttachments(attachments: ComposerAttachment[]): ComposerAttachment[] {
  return attachments.filter((item) => item.phase === "ready" && item.token !== undefined);
}

/** Vrai si au moins un téléversement a échoué (bouton « Tout réessayer »). */
export function hasFailedUpload(attachments: ComposerAttachment[]): boolean {
  return attachments.some((item) => item.phase === "error");
}

/** Paramètres ARIA d'une barre de progression (0 à 100, arrondi). */
export function progressBarProps(
  value: number,
  label: string,
): {
  role: "progressbar";
  "aria-label": string;
  "aria-valuemin": number;
  "aria-valuemax": number;
  "aria-valuenow": number;
} {
  const ratio = Math.min(1, Math.max(0, value));
  return {
    role: "progressbar",
    "aria-label": label,
    "aria-valuemin": 0,
    "aria-valuemax": 100,
    "aria-valuenow": Math.round(ratio * 100),
  };
}

/** Libellé d'état d'une pièce jointe, en français, pour les lecteurs d'écran. */
export function attachmentStatusLabel(attachment: ComposerAttachment): string {
  switch (attachment.phase) {
    case "reading":
      return "Lecture du fichier";
    case "uploading":
      return "Téléversement";
    case "ready":
      return "Prêt à être envoyé";
    case "error":
      return attachment.error ?? "Échec du téléversement";
  }
}
