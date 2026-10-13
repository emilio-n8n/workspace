/**
 * Bornes côté client, alignées sur le service (`src/service.ts`).
 *
 * Elles sont dupliquées volontairement : l'interface ne charge jamais la couche
 * base de données, elle reflète seulement les mêmes règles de saisie. Le
 * serveur reste l'unique juge — ces valeurs évitent un aller-retour réseau
 * pour une faute évidente.
 */

export const MAX_ASSIGNMENT_TITLE = 150;
export const MAX_ASSIGNMENT_INSTRUCTIONS = 20_000;
export const MAX_ASSIGNMENT_POINTS = 1000;
export const MAX_ANNOUNCEMENT_BODY = 5000;
export const MAX_COMMENT_BODY = 2000;

/** Pièces jointes d'une copie : 5 fichiers de 10 Mo au maximum. */
export const MAX_SUBMISSION_ATTACHMENTS = 5;
export const MAX_SUBMISSION_ATTACHMENT_BYTES = 10 * 1024 * 1024;
/** Longueur maximale de la réponse d'un élève (alignée sur le service). */
export const MAX_SUBMISSION_CONTENT = 50_000;
