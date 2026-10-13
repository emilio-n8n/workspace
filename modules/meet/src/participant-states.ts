/**
 * États d'un participant dans la salle (micro, caméra, parole). Les libellés
 * sont partagés par l'écran préparatoire, la galerie et les annonces faites
 * aux lecteurs d'écran : un état y est toujours dit de la même façon.
 */

export type ParticipantState = {
  name: string;
  /** Vignette de la personne connectée elle-même. */
  local: boolean;
  microphoneEnabled: boolean;
  cameraEnabled: boolean;
  speaking: boolean;
};

/** État du micro, tel qu'affiché sur une vignette. */
export function microphoneLabel(enabled: boolean): string {
  return enabled ? "Micro activé" : "Micro coupé";
}

/** État de la caméra, tel qu'affiché sur une vignette. */
export function cameraLabel(enabled: boolean): string {
  return enabled ? "Caméra activée" : "Caméra coupée";
}

/** Résumé d'une vignette lu par les lecteurs d'écran. */
export function participantLabel(state: ParticipantState): string {
  const who = state.local ? `${state.name} (vous)` : state.name;
  return `${who}, ${microphoneLabel(state.microphoneEnabled)}, ${cameraLabel(state.cameraEnabled)}`;
}
