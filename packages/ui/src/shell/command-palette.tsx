import { Command, defaultFilter } from "cmdk";
import { useEffect } from "react";
import { Dialog } from "../components/dialog.tsx";

export type PaletteAction = {
  id: string;
  label: string;
  group: string;
  onSelect: () => void;
};

/** Résultat de la recherche globale, déjà filtré et classé par le service. */
export type PaletteSearchResult = {
  id: string;
  title: string;
  subtitle: string;
  href: string;
};

export type CommandPaletteProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  actions: PaletteAction[];
  /** Résultats de la recherche globale, affichés au-dessus des applications. */
  results?: PaletteSearchResult[];
  /** Une recherche globale est en cours : affiche « Recherche… ». */
  searching?: boolean;
  /** Transmet chaque frappe à l'appelant pour alimenter la recherche globale. */
  onQueryChange?: (q: string) => void;
};

const GROUP_CLASS =
  "px-1 text-xs font-medium uppercase tracking-widest text-muted-foreground [&_[cmdk-group-items]]:mt-1 [&_[cmdk-group-items]]:flex [&_[cmdk-group-items]]:flex-col";

const ITEM_CLASS =
  "cursor-pointer rounded-md px-3 py-2 text-sm font-normal normal-case tracking-normal text-foreground data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground";

/** Préfixe cmdk des résultats : le service a déjà filtré, le filtre local doit les laisser visibles. */
const SEARCH_RESULT_VALUE_PREFIX = "palette-result:";

function paletteFilter(value: string, search: string, keywords?: string[]): number {
  if (value.startsWith(SEARCH_RESULT_VALUE_PREFIX)) {
    return 1;
  }
  return defaultFilter(value, search, keywords);
}

/** Palette de commandes (⌘K / Ctrl+K) — navigation rapide dans toute la suite. */
export function CommandPalette({
  open,
  onOpenChange,
  actions,
  results,
  searching,
  onQueryChange,
}: CommandPaletteProps) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        onOpenChange(!open);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onOpenChange]);

  const groups = [...new Set(actions.map((action) => action.group))];

  return (
    <Dialog
      open={open}
      onClose={() => onOpenChange(false)}
      title="Palette de commandes"
      bare
      className="max-w-xl"
    >
      <Command
        label="Palette de commandes"
        filter={paletteFilter}
        className="overflow-hidden rounded-b-xl"
      >
        <Command.Input
          autoFocus
          placeholder="Rechercher une application ou une action…"
          onValueChange={onQueryChange}
          className="h-12 w-full border-b border-border bg-transparent px-4 text-sm outline-none placeholder:text-muted-foreground"
        />
        <Command.List className="max-h-80 overflow-y-auto p-2">
          {searching ? (
            <div className="px-3 py-2 text-sm text-muted-foreground">Recherche…</div>
          ) : (
            <Command.Empty className="px-3 py-6 text-center text-sm text-muted-foreground">
              Aucun résultat.
            </Command.Empty>
          )}
          {results && results.length > 0 ? (
            <Command.Group heading="Résultats" className={GROUP_CLASS}>
              {results.map((result) => (
                <Command.Item
                  key={result.id}
                  value={`${SEARCH_RESULT_VALUE_PREFIX}${result.id}`}
                  onSelect={() => {
                    onOpenChange(false);
                    window.location.assign(result.href);
                  }}
                  className={ITEM_CLASS}
                >
                  <span className="flex flex-col gap-0.5">
                    <span className="font-medium">{result.title}</span>
                    <span className="text-xs text-muted-foreground">{result.subtitle}</span>
                  </span>
                </Command.Item>
              ))}
            </Command.Group>
          ) : null}
          {groups.map((group) => (
            <Command.Group key={group} heading={group} className={GROUP_CLASS}>
              {actions
                .filter((action) => action.group === group)
                .map((action) => (
                  <Command.Item
                    key={action.id}
                    onSelect={() => {
                      onOpenChange(false);
                      action.onSelect();
                    }}
                    className={ITEM_CLASS}
                  >
                    {action.label}
                  </Command.Item>
                ))}
            </Command.Group>
          ))}
        </Command.List>
      </Command>
    </Dialog>
  );
}
