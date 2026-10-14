/** Sélecteur des éléments focalisables à l'intérieur d'un conteneur. */
export const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex^="-"])',
  '[contenteditable="true"]',
].join(",");

/** Retourne les éléments focalisables de `container`, dans l'ordre du DOM. */
export function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) => el.tabIndex >= 0 && el.getAttribute("aria-hidden") !== "true",
  );
}

export type TrapFocusOptions = {
  /** Callback sur Échap (la fermeture reste à la charge de l'appelant). */
  onEscape?: () => void;
  /** Force le focus sur le premier élément focalisable à l'ouverture. */
  autoFocus?: boolean;
};

/**
 * Piège le focus dans `container` (Tab / Maj+Tab cyclent à l'intérieur) et
 * appelle `onEscape` sur Échap. Retourne une fonction de nettoyage qui retire
 * les écouteurs. La fermeture par Échap reste à la charge de l'appelant.
 */
export function trapFocus(container: HTMLElement, options: TrapFocusOptions = {}): () => void {
  const { onEscape, autoFocus = true } = options;

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault();
      onEscape?.();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = getFocusableElements(container);
    if (focusable.length === 0) {
      event.preventDefault();
      return;
    }
    const first = focusable[0] as HTMLElement;
    const last = focusable[focusable.length - 1] as HTMLElement;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  container.addEventListener("keydown", onKeyDown);
  if (autoFocus) {
    const first = getFocusableElements(container)[0];
    first?.focus();
  }
  return () => container.removeEventListener("keydown", onKeyDown);
}

/** Nombre de verrous de défilement actifs (compteur partagé entre appels). */
let scrollLockCount = 0;
let savedOverflow = "";
let savedPaddingRight = "";

/**
 * Verrouille le défilement du corps de page et retourne une fonction de
 * déverrouillage. La largeur de la barre de défilement est compensée par un
 * `paddingRight` pour éviter le saut de mise en page. Plusieurs appels
 * concurrents sont comptés : le défilement n'est restauré qu'au dernier
 * déverrouillage.
 */
export function lockScroll(): () => void {
  const root = document.documentElement;
  if (scrollLockCount === 0) {
    savedOverflow = root.style.overflow;
    savedPaddingRight = root.style.paddingRight;
    const scrollbar = `${window.innerWidth - document.documentElement.clientWidth}px`;
    const existing = Number.parseInt(savedPaddingRight, 10) || 0;
    const bar = Number.parseInt(scrollbar, 10) || 0;
    root.style.overflow = "hidden";
    root.style.paddingRight = `${existing + bar}px`;
  }
  scrollLockCount += 1;
  return () => {
    scrollLockCount = Math.max(0, scrollLockCount - 1);
    if (scrollLockCount > 0) return;
    root.style.overflow = savedOverflow;
    root.style.paddingRight = savedPaddingRight;
  };
}
