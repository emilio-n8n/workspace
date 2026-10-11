import { Command } from "cmdk";
import { useEffect } from "react";
import { Dialog } from "../components/dialog.tsx";

export type PaletteAction = {
  id: string;
  label: string;
  group: string;
  onSelect: () => void;
};

export type CommandPaletteProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  actions: PaletteAction[];
};

/** Palette de commandes (⌘K / Ctrl+K) — navigation rapide dans toute la suite. */
export function CommandPalette({ open, onOpenChange, actions }: CommandPaletteProps) {
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
      <Command label="Palette de commandes" className="overflow-hidden rounded-b-lg">
        <Command.Input
          autoFocus
          placeholder="Rechercher une application ou une action…"
          className="h-12 w-full border-b border-border bg-transparent px-4 text-sm outline-none placeholder:text-muted-foreground"
        />
        <Command.List className="max-h-80 overflow-y-auto p-2">
          <Command.Empty className="px-3 py-6 text-center text-sm text-muted-foreground">
            Aucun résultat.
          </Command.Empty>
          {groups.map((group) => (
            <Command.Group
              key={group}
              heading={group}
              className="px-1 text-xs font-medium uppercase tracking-widest text-muted-foreground [&_[cmdk-group-items]]:mt-1 [&_[cmdk-group-items]]:flex [&_[cmdk-group-items]]:flex-col"
            >
              {actions
                .filter((action) => action.group === group)
                .map((action) => (
                  <Command.Item
                    key={action.id}
                    onSelect={() => {
                      onOpenChange(false);
                      action.onSelect();
                    }}
                    className="cursor-pointer rounded-md px-3 py-2 text-sm font-normal normal-case tracking-normal text-foreground data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground"
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
