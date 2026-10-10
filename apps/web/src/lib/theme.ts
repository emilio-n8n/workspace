/** Gestion du thème clair/sombre (persisté, respecte la préférence système). */

export type Theme = "light" | "dark";

const STORAGE_KEY = "workspace-theme";

/** Script d'amorçage anti-flash (exécuté avant la première peinture). */
export const themeInitScript = `(function(){try{var stored=localStorage.getItem("${STORAGE_KEY}");var dark=stored?stored==="dark":window.matchMedia("(prefers-color-scheme: dark)").matches;if(dark)document.documentElement.classList.add("dark");}catch(e){}})();`;

export function applyTheme(theme: Theme): void {
  document.documentElement.classList.toggle("dark", theme === "dark");
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // stockage indisponible (navigation privée) : le thème s'applique sans persistance.
  }
}

export function currentTheme(): Theme {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

export function toggleTheme(): Theme {
  const next: Theme = currentTheme() === "dark" ? "light" : "dark";
  applyTheme(next);
  return next;
}
