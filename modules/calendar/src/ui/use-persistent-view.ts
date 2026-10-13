import { useCallback, useEffect, useState } from "react";
import {
  DEFAULT_VIEW_MODE,
  parseStoredView,
  serializeView,
  VIEW_STORAGE_KEY,
  type ViewMode,
} from "./view-state.ts";

/**
 * Lecture de la préférence de vue. Le rendu serveur et la première peinture
 * côté client partent de la vue par défaut : la valeur stockée n'est appliquée
 * qu'après le montage, ce qui évite un décalage d'hydratation.
 */
function readStoredMode(): ViewMode {
  if (typeof window === "undefined") return DEFAULT_VIEW_MODE;
  try {
    return parseStoredView(window.localStorage.getItem(VIEW_STORAGE_KEY));
  } catch {
    // Stockage indisponible (navigation privée, cookies bloqués) : vue par défaut.
    return DEFAULT_VIEW_MODE;
  }
}

/**
 * Vue courante, persistée dans le stockage local du navigateur : changer de
 * vue puis recharger la page retrouve le même affichage. Une valeur corrompue
 * ou un stockage indisponible retombent sur la vue par défaut.
 */
export function usePersistentViewMode(): [ViewMode, (mode: ViewMode) => void] {
  const [mode, setMode] = useState<ViewMode>(DEFAULT_VIEW_MODE);

  useEffect(() => {
    setMode(readStoredMode());
  }, []);

  const change = useCallback((next: ViewMode) => {
    setMode(next);
    try {
      window.localStorage.setItem(VIEW_STORAGE_KEY, serializeView(next));
    } catch {
      // Préférence non mémorisée : elle ne vaudra que pour cette session.
    }
  }, []);

  return [mode, change];
}
