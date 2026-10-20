import { cn } from "@workspace/ui";
import { type KeyboardEvent, type ReactNode, useMemo, useState } from "react";
import {
  activeFunctionCall,
  type FormulaFunctionInfo,
  formulaTokenAtEnd,
  suggestFunctions,
} from "../formula.ts";

/**
 * Aide à la saisie des formules (comme Excel / Google Sheets) :
 * - pendant qu'on tape un nom de fonction (« =SOM »), liste de suggestions
 *   (noms français d'abord) ; ↑/↓ pour choisir, Tab ou Entrée pour insérer
 *   « SOMME( », Échap pour fermer la liste ;
 * - une fois la parenthèse ouverte, la syntaxe de la fonction s'affiche sous
 *   le champ (« SI(test; valeur_si_vrai; [valeur_si_faux]) »).
 *
 * Le crochet ne possède pas la valeur : le champ appelant la garde et reçoit
 * la nouvelle valeur par `onChange`.
 */
export function useFormulaAssist(value: string, onChange: (value: string) => void) {
  const [active, setActive] = useState(0);
  const [dismissedFor, setDismissedFor] = useState<string | null>(null);

  const token = formulaTokenAtEnd(value);
  const suggestions = useMemo(
    () => (token && dismissedFor !== value ? suggestFunctions(token) : []),
    [token, dismissedFor, value],
  );
  const current = Math.min(active, Math.max(0, suggestions.length - 1));
  const signature = suggestions.length === 0 ? activeFunctionCall(value) : null;

  function accept(fn: FormulaFunctionInfo | undefined) {
    if (!fn || !token) return;
    onChange(`${value.slice(0, value.length - token.length)}${fn.fr}(`);
    setActive(0);
  }

  /** À appeler en premier dans `onKeyDown` du champ : vrai si la touche est consommée. */
  function onKeyDown(event: KeyboardEvent<HTMLInputElement>): boolean {
    if (suggestions.length === 0) return false;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((current + 1) % suggestions.length);
      return true;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((current - 1 + suggestions.length) % suggestions.length);
      return true;
    }
    if (event.key === "Tab" || event.key === "Enter") {
      event.preventDefault();
      accept(suggestions[current]);
      return true;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setDismissedFor(value);
      return true;
    }
    return false;
  }

  const popup: ReactNode =
    suggestions.length > 0 ? (
      <div
        role="listbox"
        aria-label="Fonctions suggérées"
        className="absolute top-full left-0 z-30 mt-1 w-80 overflow-hidden rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-lift"
      >
        {suggestions.map((fn, index) => (
          <div
            key={fn.name}
            role="option"
            tabIndex={-1}
            aria-selected={index === current}
            // Le champ garde le focus : la souris choisit sans le lui retirer.
            onMouseDown={(event) => {
              event.preventDefault();
              accept(fn);
            }}
            className={cn(
              "flex cursor-pointer flex-col rounded-sm px-2 py-1 text-left",
              index === current ? "bg-accent text-accent-foreground" : "hover:bg-muted",
            )}
          >
            <span className="font-mono text-xs font-semibold">
              {fn.fr}
              {fn.fr !== fn.name ? (
                <span className="ml-2 font-normal text-muted-foreground">{fn.name}</span>
              ) : null}
            </span>
            <span className="truncate text-[11px] text-muted-foreground">{fn.description}</span>
          </div>
        ))}
      </div>
    ) : signature ? (
      <div
        role="note"
        className="absolute top-full left-0 z-30 mt-1 max-w-96 rounded-md border border-border bg-popover px-2 py-1 font-mono text-[11px] text-popover-foreground shadow-soft"
      >
        {signature.syntax}
        <span className="mt-0.5 block font-sans text-muted-foreground">
          {signature.description}
        </span>
      </div>
    ) : null;

  return { onKeyDown, popup, open: suggestions.length > 0 };
}
