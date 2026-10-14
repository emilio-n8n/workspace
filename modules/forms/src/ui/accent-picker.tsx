import { cn } from "@workspace/ui";
import { useEffect, useState } from "react";
import {
  accentContrastInTheme,
  FORM_ACCENTS,
  type FormAccentId,
  isAccessibleContrast,
  MIN_TEXT_CONTRAST,
} from "../theme.ts";

type ThemeTokens = { background: string; foreground: string; dark: boolean };

/** Lit les tokens du thème courant pour mesurer le contraste du texte sur l'accent. */
function readThemeTokens(): ThemeTokens | null {
  if (typeof window === "undefined" || typeof getComputedStyle !== "function") return null;
  const root = document.documentElement;
  const style = getComputedStyle(root);
  const background = style.getPropertyValue("--background").trim();
  const foreground = style.getPropertyValue("--foreground").trim();
  if (background.length === 0 || foreground.length === 0) return null;
  return { background, foreground, dark: root.classList.contains("dark") };
}

/**
 * Choix de l'accent du formulaire — chaque pastille désigne un token
 * `--color-app-*` de la palette ; aucun hex n'est codé ici. Le contraste du
 * texte posé sur l'accent est mesuré dans le thème courant (WCAG 2.1).
 */
export function AccentPicker({
  value,
  onChange,
}: {
  value: FormAccentId;
  onChange: (id: FormAccentId) => void;
}) {
  const [tokens, setTokens] = useState<ThemeTokens | null>(null);

  useEffect(() => {
    setTokens(readThemeTokens());
  }, []);

  const selected = FORM_ACCENTS.find((accent) => accent.id === value);
  const measurement = selected && tokens ? accentContrastInTheme(selected, tokens) : null;

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-sm font-medium">Couleur d'accent</legend>
      <div className="flex flex-wrap gap-2">
        {FORM_ACCENTS.map((accent) => {
          const active = accent.id === value;
          const id = `forms-accent-${accent.id}`;
          return (
            <label
              key={accent.id}
              htmlFor={id}
              className={cn(
                "flex cursor-pointer items-center gap-2 rounded-lg border px-2 py-1 text-xs transition-colors",
                "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-offset-1 has-[:focus-visible]:ring-offset-background",
                active ? "border-foreground bg-muted" : "border-border hover:bg-muted",
              )}
            >
              <input
                id={id}
                type="radio"
                name="forms-accent"
                value={accent.id}
                checked={active}
                onChange={() => onChange(accent.id)}
                className="sr-only"
              />
              <span
                aria-hidden
                className="size-4 rounded-full border border-border"
                style={{ backgroundColor: accent.token }}
              />
              {accent.label}
            </label>
          );
        })}
      </div>
      {measurement ? (
        <p className="text-xs text-muted-foreground">
          Texte sur l'accent : {measurement.ratio.toFixed(1)}:1 ({measurement.level}){" "}
          {isAccessibleContrast(measurement.ratio)
            ? "— conforme AA"
            : `— sous le seuil AA (${MIN_TEXT_CONTRAST}:1)`}
        </p>
      ) : null}
    </fieldset>
  );
}
