import { useCallback, useEffect, useState } from "react";
import { browserStorage, FOCUS_MODE_CLASS, loadFocusMode, storeFocusMode } from "../focus-mode.ts";

export type FocusMode = {
  /** Mode focus actif. */
  active: boolean;
  /** Bascule le mode focus et mémorise le choix. */
  toggle: () => void;
  /** Sort du mode focus (utilisé par `Échap`). */
  exit: () => void;
};

/**
 * Mode focus du document : masque l'interface autour de la page et mémorise le
 * choix d'une visite à l'autre.
 *
 * La bascule porte sur `<body>` (convention `FOCUS_MODE_CLASS`) : c'est le seul
 * point d'accès à la coque applicative depuis l'éditeur, qui ne la rend pas.
 * Une erreur de stockage ne bloque rien — le mode fonctionne pour la session.
 */
export function useFocusMode(): FocusMode {
  // Lecture à l'initialisation, pas dans un effet : sinon la persistance
  // écrirait `false` au montage avant que la préférence ne soit relue, et un
  // utilisateur en mode focus reverrait l'interface clignoter une frame.
  // `browserStorage()` rend `null` hors navigateur (rendu serveur) : la valeur
  // initiale est déterministe des deux côtés.
  const [active, setActive] = useState(() => loadFocusMode(browserStorage()));

  // Application de la classe et persistance à chaque changement.
  useEffect(() => {
    document.body.classList.toggle(FOCUS_MODE_CLASS, active);
    storeFocusMode(browserStorage(), active);
    // Nettoyage : sans ça, la classe survivrait au démontage de l'éditeur.
    return () => document.body.classList.remove(FOCUS_MODE_CLASS);
  }, [active]);

  const toggle = useCallback(() => setActive((current) => !current), []);
  const exit = useCallback(() => setActive(false), []);

  return { active, toggle, exit };
}
