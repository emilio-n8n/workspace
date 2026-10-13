import { Dialog, Kbd } from "@workspace/ui";
import { formatShortcutKeys, SHORTCUTS } from "./shortcuts.ts";

/**
 * Aide des raccourcis — ouverte par « ? », listée dans une boîte de dialogue
 * nommée. Chaque geste est rappelé avec son rendu clavier (⌘, lettres).
 */
export function ShortcutsHelp({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onClose={onClose} title="Raccourcis clavier" className="max-w-md">
      <dl className="flex flex-col gap-1.5">
        {SHORTCUTS.map((shortcut) => (
          <div key={shortcut.action} className="flex items-center justify-between gap-3 text-sm">
            <dt className="min-w-0 flex-1 text-muted-foreground">{shortcut.label}</dt>
            <dd className="flex shrink-0 items-center gap-1">
              {shortcut.keys.map((entry) => (
                <Kbd key={entry.key + (entry.shiftKey ? "-shift" : "")}>
                  {formatShortcutKeys([entry])}
                </Kbd>
              ))}
            </dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-xs text-muted-foreground">
        Les raccourcis sont inactifs pendant la saisie d'un champ et quand une boîte de dialogue est
        ouverte.
      </p>
    </Dialog>
  );
}
