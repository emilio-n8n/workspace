/**
 * Règles de saisie — connexion et inscription.
 *
 * Fonctions pures, sans React : la même règle sert à la validation en direct,
 * au blocage de l'envoi et aux tests. Les messages sont en français, dits à
 * l'utilisateur (ce qu'il doit corriger), et jamais laissés à la devinette.
 */

/** Longueur minimale du mot de passe (même règle que le serveur). */
export const PASSWORD_MIN_LENGTH = 10;

/** Longueur minimale du nom affiché. */
export const NAME_MIN_LENGTH = 2;

/**
 * Adresse e-mail — forme « prenom@exemple.org ». Volontairement simple : une
 * regex stricte finit par refuser des adresses réelles.
 */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function isValidEmail(value: string): boolean {
  return EMAIL_SHAPE.test(value.trim());
}

/** Nom affiché : au moins deux caractères, espaces compris. */
export function validateName(value: string): string | undefined {
  const name = value.trim();
  if (name.length === 0) return "Indiquez votre nom.";
  if (name.length < NAME_MIN_LENGTH) {
    return `Le nom doit faire au moins ${NAME_MIN_LENGTH} caractères.`;
  }
  return undefined;
}

/** Adresse e-mail : renseignée et bien formée. */
export function validateEmail(value: string): string | undefined {
  const email = value.trim();
  if (email.length === 0) return "Indiquez votre adresse e-mail.";
  if (!isValidEmail(email)) {
    return "Cette adresse e-mail semble incorrecte : la forme attendue est prenom@exemple.org.";
  }
  return undefined;
}

/** Mot de passe — inscription : renseigné et assez long. */
export function validateNewPassword(value: string): string | undefined {
  if (value.length === 0) return "Choisissez un mot de passe.";
  if (value.length < PASSWORD_MIN_LENGTH) {
    return `Le mot de passe doit faire au moins ${PASSWORD_MIN_LENGTH} caractères (actuel : ${value.length}).`;
  }
  return undefined;
}

/** Mot de passe — connexion : seul le renseignement est vérifié. */
export function validatePassword(value: string): string | undefined {
  if (value.length === 0) return "Indiquez votre mot de passe.";
  return undefined;
}

/**
 * Messages serveur traduits en actionnable. Les codes de Better Auth sont
 * stables ; leur libellé doit dire à l'utilisateur quoi faire.
 */
const AUTH_ERRORS: Record<string, string> = {
  // Trois codes, un seul message : on ne révèle pas si l'adresse existe.
  INVALID_EMAIL_OR_PASSWORD: "Adresse e-mail ou mot de passe incorrect.",
  INVALID_EMAIL: "Adresse e-mail ou mot de passe incorrect.",
  INVALID_PASSWORD: "Adresse e-mail ou mot de passe incorrect.",
  USER_ALREADY_EXISTS: "Un compte existe déjà avec cette adresse e-mail — connectez-vous.",
  USER_NOT_FOUND: "Aucun compte ne correspond à cette adresse e-mail.",
  PASSWORD_TOO_SHORT: `Le mot de passe doit faire au moins ${PASSWORD_MIN_LENGTH} caractères.`,
  WEAK_PASSWORD: "Ce mot de passe est trop facile à deviner : choisissez-en un plus long.",
};

/** Traduit une erreur d'authentification en message actionnable. */
export function authErrorMessage(code: string | undefined | null, fallback: string): string {
  const message = code ? AUTH_ERRORS[code] : undefined;
  return message ?? fallback;
}
