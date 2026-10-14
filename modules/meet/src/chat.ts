/**
 * Chat de réunion — logique pure : longueur des messages, aperçus, horodatage
 * français et compte des non lus. Le médiateur n'est pas audité (volume) : ces
 * règles sont donc testées ici plutôt que par le journal.
 */

/** Longur maximale d'un message (alignée sur la validation serveur). */
export const CHAT_MAX_LENGTH = 2000;

/** Période de rafraîchissement du chat tant qu'il est ouvert (millisecondes). */
export const CHAT_POLL_MS = 4000;

/** Longueur d'un aperçu dans les notifications. */
const PREVIEW_LENGTH = 120;

export type ChatBodyValidation = { ok: true; body: string } | { ok: false; error: string };

/**
 * Valide un message saisi : espaces retirés aux extrémités, message vide ou
 * trop long refusé avec un motif en français.
 */
export function validateChatBody(raw: string): ChatBodyValidation {
  if (typeof raw !== "string") return { ok: false, error: "Message invalide." };
  const body = raw.trim();
  if (body.length === 0) return { ok: false, error: "Écrivez un message avant de l'envoyer." };
  if (Array.from(body).length > CHAT_MAX_LENGTH) {
    return {
      ok: false,
      error: `Message trop long (${CHAT_MAX_LENGTH} caractères maximum).`,
    };
  }
  return { ok: true, body };
}

/** Nombre de caractères saisis (points de code, pas d'approximation UTF-16). */
export function chatBodyLength(raw: string): number {
  return Array.from(raw).length;
}

/** Aperçu court d'un message pour une notification ou une réponse. */
export function messagePreview(body: string): string {
  const clean = body.trim().replace(/\s+/g, " ");
  if (clean.length <= PREVIEW_LENGTH) return clean;
  return `${clean.slice(0, PREVIEW_LENGTH).trimEnd()}…`;
}

/** Heure d'envoi au format français (« 14:05 »). */
export function formatMessageTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

/** Compte des messages non lus (ceux des autres, postérieurs à la lecture). */
export function countUnread(
  messages: readonly { createdAt: string; own: boolean }[],
  lastReadAt: string | null,
): number {
  const boundary = lastReadAt === null ? null : Date.parse(lastReadAt);
  return messages.filter((message) => {
    if (message.own) return false;
    if (boundary === null) return true;
    return Date.parse(message.createdAt) > boundary;
  }).length;
}

/** Libellé du compteur de non lus (« 3 messages non lus »). */
export function unreadLabel(count: number): string {
  if (count <= 0) return "Aucun message non lu";
  if (count === 1) return "1 message non lu";
  return `${count} messages non lus`;
}

/** Annonce lisible d'un message reçu (aria-live). */
export function messageAnnouncement(author: string, body: string): string {
  return `Message de ${author} : ${messagePreview(body)}`;
}
