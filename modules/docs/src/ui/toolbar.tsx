import { Button, cn } from "@workspace/ui";
import { type KeyboardEvent, type ReactNode, useEffect, useState } from "react";
import { ariaKeyshortcuts, MODIFIER_LABELS, shortcutHint } from "./format-actions.ts";
import { Tooltip } from "./tooltip.tsx";

export type ToolbarButtonProps = {
  /** Libellé français : nom accessible du bouton et texte de l'info-bulle. */
  label: string;
  /** Touche principale du raccourci (« b », « i », « u ») si le bouton en a un. */
  shortcutKey?: string;
  /** État d'un bouton bascule : alimente `aria-pressed` et l'aplat actif. */
  pressed?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
};

/** Filet de séparation entre groupes d'outils — hors arbre d'accessibilité. */
export function ToolbarSeparator() {
  return <span aria-hidden className="mx-1 h-5 w-px bg-border" />;
}

/**
 * Modificateur d'affichage des raccourcis — « ⌘ » sur macOS, « Ctrl » ailleurs.
 *
 * Résolu après le montage : le premier rendu, serveur compris, garde « Ctrl »,
 * donc l'hydratation ne diffère pas d'une plateforme à l'autre.
 */
export function useFormatModifier(): string {
  const [modifier, setModifier] = useState<string>(MODIFIER_LABELS.default);

  useEffect(() => {
    if (/Mac|iPhone|iPad|iPod/.test(navigator.userAgent)) {
      setModifier(MODIFIER_LABELS.mac);
    }
  }, []);

  return modifier;
}

/**
 * Navigation horizontale dans la barre (`←` / `→`) : les flèches déplacent le
 * focus d'un outil à l'autre, `Tab` continue de parcourir toute la barre puis
 * de sortir vers la suite de la page — aucun piège au clavier.
 */
/** Navigation horizontale dans la barre (`←` / `→`) : les flèches déplacent le
 * focus d'un outil à l'autre, `Tab` continue de parcourir toute la barre puis
 * de sortir vers la suite de la page — aucun piège au clavier. Les champs de
 * saisie et sélecteurs gardent leurs propres flèches. */
export function onToolbarArrowKeys(event: KeyboardEvent<HTMLDivElement>) {
  if (
    event.target instanceof HTMLSelectElement ||
    event.target instanceof HTMLInputElement ||
    event.target instanceof HTMLTextAreaElement
  ) {
    return;
  }
  const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
  if (step === 0) return;

  // Les outils désactivés ne reçoivent pas le focus : on les saute.
  const buttons = Array.from(
    event.currentTarget.querySelectorAll<HTMLElement>("button:not(:disabled)"),
  );
  if (buttons.length === 0) return;

  const current = event.target instanceof HTMLButtonElement ? buttons.indexOf(event.target) : -1;
  const target =
    current < 0
      ? step > 0
        ? 0
        : buttons.length - 1
      : (current + step + buttons.length) % buttons.length;

  event.preventDefault();
  buttons[target]?.focus();
}

/**
 * Bouton de la barre d'outils de l'éditeur.
 *
 * - info-bulle française avec le raccourci, ouverte au survol et au focus
 *   clavier, refermée par `Échap` ;
 * - `aria-pressed` **uniquement** sur les boutons bascule : un bouton simple
 *   n'annonce jamais un état enfoncé qui n'existe pas ;
 * - nom accessible explicite (un glyphe seul n'en est pas un) et raccourci
 *   exposé aux lecteurs d'écran ;
 * - position relative : l'info-bulle s'ancre au bouton, pas à la page.
 */
export function ToolbarButton({
  label,
  shortcutKey,
  pressed,
  disabled = false,
  onClick,
  children,
}: ToolbarButtonProps) {
  const modifier = useFormatModifier();
  const shortcut = shortcutKey === undefined ? undefined : shortcutHint(shortcutKey, modifier);

  return (
    <Tooltip content={label} shortcut={shortcut}>
      {(tooltip) => (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={cn("relative min-w-8 px-2", pressed && "bg-accent text-accent-foreground")}
          disabled={disabled}
          aria-pressed={pressed}
          aria-keyshortcuts={
            shortcutKey === undefined ? undefined : ariaKeyshortcuts(shortcutKey, modifier)
          }
          onClick={onClick}
          {...tooltip}
        >
          <span aria-hidden>{children}</span>
          <span className="sr-only">{label}</span>
        </Button>
      )}
    </Tooltip>
  );
}
