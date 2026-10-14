/**
 * Participants d'une salle — logique pure : rôles, droits de modération, ordre
 * d'affichage et annonces. Tout ce qui est présenté à l'écran ou lu à haute
 * voix passe par ici, afin qu'une même décision ait le même libellé partout.
 */

/** Rôles côté service (miroir de `MEET_ROLES` dans schema.ts). */
export type MeetRoleView = "host" | "moderator" | "participant";

/** Période de rafraîchissement du panneau des participants (millisecondes). */
export const ROSTER_POLL_MS = 4000;

export type ParticipantStateView = {
  userId: string;
  name: string;
  role: MeetRoleView;
  /** La ligne décrit la personne connectée. */
  self: boolean;
  mutedByHost: boolean;
  removed: boolean;
  handRaised: boolean;
  /** Horodatage de levée de main, `null` si la main est baissée. */
  handRaisedAt: string | null;
};

const ROLE_LABELS: Record<MeetRoleView, string> = {
  host: "Créateur",
  moderator: "Animateur",
  participant: "Participant",
};

/** Libellé du rôle d'une personne (« Vous » pour soi-même). */
export function roleLabel(state: ParticipantStateView): string {
  if (state.self) return "Vous";
  return ROLE_LABELS[state.role];
}

/**
 * Droit de modération : le créateur modère toujours ; un animateur modère tant
 * qu'il est présent (non retiré, non raccroché).
 */
export function canModerate(input: {
  isCreator: boolean;
  role: MeetRoleView;
  removed: boolean;
  left: boolean;
}): boolean {
  if (input.removed || input.left) return false;
  if (input.isCreator) return true;
  return input.role === "moderator";
}

/** Ordre d'affichage : créateur, animateurs, puis participants par nom. */
export function orderParticipants(
  participants: readonly ParticipantStateView[],
): ParticipantStateView[] {
  const weight = (state: ParticipantStateView) =>
    state.role === "host" ? 0 : state.role === "moderator" ? 1 : 2;
  return [...participants].sort((a, b) => {
    if (weight(a) !== weight(b)) return weight(a) - weight(b);
    return a.name.localeCompare(b.name, "fr");
  });
}

/** Effectif en français (« 1 participant », « 3 participants »). */
export function participantsCountLabel(count: number): string {
  if (count <= 0) return "Aucun participant";
  if (count === 1) return "1 participant";
  return `${count} participants`;
}

/** Personnes avec la main levée, dans l'ordre de levée. */
export function raisedHandQueue(
  participants: readonly ParticipantStateView[],
): ParticipantStateView[] {
  return participants
    .filter((state) => state.handRaised)
    .sort((a, b) => (a.handRaisedAt ?? "").localeCompare(b.handRaisedAt ?? ""));
}

/** Annonce lisible (aria-live) d'une levée ou d'un baissement de main. */
export function handAnnouncement(name: string, raised: boolean): string {
  return raised ? `${name} a levé la main.` : `${name} a baissé la main.`;
}

/** Annonce d'une modération de micro par l'organisateur. */
export function muteAnnouncement(name: string, muted: boolean): string {
  return muted
    ? `Micro de ${name} coupé par l'organisateur.`
    : `Micro de ${name} rétabli par l'organisateur.`;
}

/** Annonce d'un retrait de réunion. */
export function removalAnnouncement(name: string): string {
  return `${name} a été retiré de la réunion par l'organisateur.`;
}

/** Annonce d'un changement de rôle (nomination ou retrait d'animateur). */
export function roleAnnouncement(name: string, role: MeetRoleView): string {
  return role === "moderator"
    ? `${name} est désormais animateur.`
    : `${name} n'est plus animateur.`;
}

/** Libellé du bouton qui nomme ou rétrograde un animateur. */
export function roleActionLabel(role: MeetRoleView): string {
  return role === "moderator" ? "Retirer le rôle d'animateur" : "Nommer animateur";
}

/** Libellé du bouton personnel de main levée. */
export function raiseHandLabel(raised: boolean): string {
  return raised ? "Baisser la main" : "Lever la main";
}

/** Marque affichée sur la ligne d'une personne au micro coupé par l'organisateur. */
export function mutedByHostLabel(): string {
  return "Micro coupé par l'organisateur";
}

/** Indicateur de main levée, visible par toute la salle. */
export function raisedHandLabel(): string {
  return "Main levée";
}

/** Texte de la file des mains levées, vue par l'organisateur. */
export function raisedHandsCountLabel(count: number): string {
  if (count <= 0) return "Aucune main levée";
  if (count === 1) return "1 main levée";
  return `${count} mains levées`;
}

/** Message affiché à la personne retirée. */
export const REMOVED_MESSAGE =
  "L'organisateur vous a retiré de cette réunion. Contactez-le pour y revenir.";

/** Libellé du bouton de modération du micro d'autrui. */
export function moderateMicrophoneLabel(state: ParticipantStateView): string {
  return state.mutedByHost ? "Rétablir le micro" : "Couper le micro";
}
