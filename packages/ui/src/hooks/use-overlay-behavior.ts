import { type RefObject, useEffect, useRef } from "react";
import { lockScroll, trapFocus } from "../lib/overlay.ts";

export type OverlayBehaviorOptions = {
  /** Quand `active` passe à true, le focus est piégé et le défilement verrouillé. */
  active: boolean;
  /** Callback sur Échap (fermeture à la charge de l'appelant). */
  onEscape?: () => void;
  /** Conteneur à piéger (défaut : le corps de page, pour les popovers). */
  container?: RefObject<HTMLElement | null>;
  /** Restaure le focus sur l'élément actif à la fermeture (défaut : oui). */
  restoreFocus?: boolean;
  /** Focus immédiat sur le premier élément focalisable (défaut : oui). */
  autoFocus?: boolean;
};

/**
 * Branche le focus trap et le verrou de défilement sur tout conteneur non
 * `<dialog>` natif : palette, panneau latéral, popover. Le `<dialog>`
 * natif gère déjà le focus et Échap (voir `Dialog` et `Sheet`) ; ce hook sert
 * aux implémentations maison. Le focus est rendu à l'élément actif à la
 * fermeture.
 */
export function useOverlayBehavior({
  active,
  onEscape,
  container,
  restoreFocus = true,
  autoFocus = true,
}: OverlayBehaviorOptions): void {
  const previous = useRef<HTMLElement | null>(null);
  const optionsRef = useRef({ onEscape, restoreFocus, autoFocus });

  optionsRef.current = { onEscape, restoreFocus, autoFocus };

  useEffect(() => {
    if (!active) return;
    const containerElement = container?.current ?? document.body;
    const releaseScroll = lockScroll();
    const releaseFocus = trapFocus(containerElement, {
      onEscape: optionsRef.current.onEscape,
      autoFocus: optionsRef.current.autoFocus,
    });
    previous.current = document.activeElement as HTMLElement | null;
    return () => {
      releaseScroll();
      releaseFocus();
      if (restoreFocus) previous.current?.focus();
    };
  }, [active, container, restoreFocus]);
}
