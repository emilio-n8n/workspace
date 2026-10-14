/**
 * Mode focus — persistance et convention de nommage.
 *
 * Le mode focus masque l'interface autour de la page (rail d'applications,
 * barre supérieure) pour ne laisser que le document. La préférence survit au
 * rechargement ; `Échap` en sort à tout moment.
 *
 * La persistance est isolée ici et testable sans navigateur : le stockage est
 * injecté, et un stockage qui refuse d'écrire (navigation privée, quota) ne
 * casse rien — le mode fonctionne alors pour la session en cours.
 */

/** Clé de la préférence de mode focus. */
export const FOCUS_MODE_KEY = "workspace.docs.focus";

/** Classe posée sur `<body>` quand le mode focus est actif. */
export const FOCUS_MODE_CLASS = "workspace-docs-focus";

/** Stockage minimal — `localStorage` ou n'importe quel double de test. */
export type FocusModeStorage = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
};

/**
 * Lit la préférence de mode focus. Tout ce qui n'est pas exactement `"1"`
 * (valeur absente, vide, corrompue, ou stockage indisponible) vaut `false` :
 * le mode focus ne s'active jamais par accident.
 */
export function loadFocusMode(storage: FocusModeStorage | null | undefined): boolean {
  if (!storage) return false;
  try {
    return storage.getItem(FOCUS_MODE_KEY) === "1";
  } catch {
    // Stockage inaccessible (navigation privée) : on reste en mode normal.
    return false;
  }
}

/**
 * Enregistre la préférence. Un refus d'écriture est silencieux : le mode focus
 * reste actif pour la session, il ne sera simplement pas mémorisé.
 */
export function storeFocusMode(
  storage: FocusModeStorage | null | undefined,
  enabled: boolean,
): void {
  if (!storage) return;
  try {
    storage.setItem(FOCUS_MODE_KEY, enabled ? "1" : "0");
  } catch {
    // Rien à faire : l'écriture est un confort, pas une exigence.
  }
}

/** Stockage du navigateur, ou `null` là où il n'existe pas (rendu serveur). */
export function browserStorage(): FocusModeStorage | null {
  try {
    if (typeof window === "undefined" || !window.localStorage) return null;
    return window.localStorage;
  } catch {
    return null;
  }
}
