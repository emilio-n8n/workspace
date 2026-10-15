import { useCallback, useEffect, useState } from "react";

/** Classe posée sur <body> pendant le mode concentration (voir styles.css). */
const FOCUS_CLASS = "workspace-slides-focus";
/** Préférence mémorisée : le mode concentration survit au rechargement. */
const STORAGE_KEY = "workspace.slides.focus";

/**
 * Mode concentration de l'éditeur : masque le rail d'applications et la barre
 * haute de la suite pour ne garder que la présentation. La préférence est
 * mémorisée localement (jamais envoyée au serveur) et `Échap` en sort.
 */
export function useEditorFocus() {
  const [active, setActive] = useState(false);

  // Restauration de la préférence, après le montage (jamais côté serveur).
  useEffect(() => {
    try {
      if (window.localStorage.getItem(STORAGE_KEY) === "1") setActive(true);
    } catch {
      // Stockage indisponible (navigation privée) : mode concentration manuel.
    }
  }, []);

  useEffect(() => {
    document.body.classList.toggle(FOCUS_CLASS, active);
    try {
      window.localStorage.setItem(STORAGE_KEY, active ? "1" : "0");
    } catch {
      // Idem : l'échec de mémorisation ne bloque pas le mode.
    }
    return () => document.body.classList.remove(FOCUS_CLASS);
  }, [active]);

  const toggle = useCallback(() => setActive((value) => !value), []);
  const exit = useCallback(() => setActive(false), []);

  return { active, toggle, exit };
}
