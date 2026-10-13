import { useEffect, useState } from "react";

/** Requête de préférence système « réduire les animations ». */
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/**
 * Lit la préférence « réduire les animations » (vaut `false` hors navigateur
 * ou si l'API `matchMedia` manque).
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

/**
 * Préférence « réduire les animations » sous forme d'état React — se met à jour
 * dès que le réglage système change. À utiliser pour désamorcer une animation
 * JS (transitions de valeur, auto-défilement) ou choisir un rendu stable.
 *
 * ```tsx
 * const reduced = usePrefersReducedMotion();
 * const duration = reduced ? 0 : 240;
 * ```
 */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(prefersReducedMotion);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const media = window.matchMedia(REDUCED_MOTION_QUERY);
    const onChange = () => setReduced(media.matches);
    onChange();
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  return reduced;
}
