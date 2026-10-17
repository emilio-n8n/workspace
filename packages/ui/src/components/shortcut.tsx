import type { ReactNode } from "react";
import { cn } from "../cn.ts";
import { Kbd } from "./kbd.tsx";

/** Touche de raccourci : chaîne simple (« ⌘ », « K ») ou paire libellé/puce. */
export type ShortcutKey = string | { keys: string; label?: string };

const isLabeledKey = (key: ShortcutKey): key is { keys: string; label?: string } =>
  typeof key === "object" && key !== null && "keys" in key;

/** Nom lisible d'une touche (libellé fourni ou glyphe). */
const labeledName = (key: ShortcutKey): string =>
  isLabeledKey(key) ? (key.label ?? key.keys) : key;

/** Raccourci clavier — puces `Kbd` séparées par « + », nom accessible global. */
export function Shortcut({
  keys,
  className,
  ariaLabel,
}: {
  /** Touches dans l'ordre de frappe (ex. : ["⌘", "K"] ou "⌘K"). */
  keys: ShortcutKey[];
  className?: string;
  /** Nom accessible global (défaut : « Raccourci : {touches} »). */
  ariaLabel?: string;
}) {
  const readable = keys.map(labeledName).join(" + ");
  const label = ariaLabel ?? `Raccourci : ${readable}`;
  return (
    <fieldset className={cn("m-0 inline-flex items-center gap-0.5 border-0 p-0", className)}>
      <legend className="sr-only">{label}</legend>
      {keys.map((key, index) => {
        const glyph = isLabeledKey(key) ? key.keys : key;
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: une même touche peut se répéter et la combinaison n'est jamais réordonnée
          <span key={`${glyph}-${index}`} className="inline-flex items-center gap-0.5">
            {index > 0 ? (
              <span aria-hidden className="text-muted-foreground">
                +
              </span>
            ) : null}
            <Kbd className="px-1 py-0.5 text-[11px]">{glyph}</Kbd>
          </span>
        );
      })}
    </fieldset>
  );
}

/** Ligne d'aide : action à gauche, raccourci à droite. */
export function ShortcutListRow({
  action,
  keys,
  className,
  shortcutClassName,
}: {
  /** Libellé de l'action (ex. : « Ouvrir la palette de commandes »). */
  action: ReactNode;
  /** Touches dans l'ordre de frappe. */
  keys: ShortcutKey[];
  className?: string;
  /** Classes appliquées au raccourci. */
  shortcutClassName?: string;
}) {
  return (
    <div className={cn("flex items-center justify-between gap-3 text-sm", className)}>
      <span className="min-w-0 flex-1 text-muted-foreground">{action}</span>
      <Shortcut keys={keys} className={cn("shrink-0", shortcutClassName)} />
    </div>
  );
}

/** Ensemble de lignes d'aide, présenté comme une liste de définitions. */
export function ShortcutList({ children, className }: { children: ReactNode; className?: string }) {
  return <dl className={cn("flex flex-col gap-1.5", className)}>{children}</dl>;
}
