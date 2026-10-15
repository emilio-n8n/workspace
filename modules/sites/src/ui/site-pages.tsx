import { Button, cn, Menu } from "@workspace/ui";
import type { PageView } from "../server.ts";

export type SitePagesPanelProps = {
  pages: readonly PageView[];
  activePageId: string | null;
  canEdit: boolean;
  busy: boolean;
  onSelect: (pageId: string) => void;
  /** Déplace la page, donc son entrée de menu. */
  onMove: (pageId: string, direction: "up" | "down") => void;
  onDelete: (page: PageView) => void;
  onAdd: () => void;
};

/**
 * Pages du site (TASK-006) : liste ordonnée, création et suppression ;
 * l'ordre de cette liste **est** l'ordre du menu de navigation. Chaque page
 * tient sur une rangée : les actions rares (déplacer, supprimer) vivent dans
 * un menu « ⋯ » plutôt qu'en pavés de boutons empilés.
 */
export function SitePagesPanel({
  pages,
  activePageId,
  canEdit,
  busy,
  onSelect,
  onMove,
  onDelete,
  onAdd,
}: SitePagesPanelProps) {
  return (
    <section aria-labelledby="site-pages-title" className="flex flex-col gap-2">
      <h2
        id="site-pages-title"
        className="text-xs font-medium uppercase tracking-widest text-muted-foreground"
      >
        Pages
      </h2>
      <ul className="flex flex-col gap-1">
        {pages.map((page, index) => (
          <li key={page.id} className="flex items-center gap-1">
            <button
              type="button"
              aria-current={page.id === activePageId ? "true" : undefined}
              onClick={() => onSelect(page.id)}
              className={cn(
                "min-w-0 flex-1 truncate rounded-lg px-2 py-1.5 text-left text-sm transition-colors",
                page.id === activePageId ? "bg-accent text-accent-foreground" : "hover:bg-muted",
              )}
            >
              {page.title}
              <span className="block truncate text-[10px] text-muted-foreground">/{page.slug}</span>
            </button>
            {canEdit && pages.length > 1 ? (
              <Menu
                label={`Actions pour la page ${page.title}`}
                triggerIcon={<span aria-hidden>⋯</span>}
                triggerClassName="h-7 w-7 shrink-0 border-transparent bg-transparent px-0 text-muted-foreground hover:bg-muted focus-visible:ring-offset-0"
                items={[
                  {
                    id: "up",
                    label: `Monter la page ${page.title}`,
                    disabled: busy || index === 0,
                    onSelect: () => onMove(page.id, "up"),
                  },
                  {
                    id: "down",
                    label: `Descendre la page ${page.title}`,
                    disabled: busy || index === pages.length - 1,
                    onSelect: () => onMove(page.id, "down"),
                  },
                  {
                    id: "delete",
                    label: `Supprimer la page ${page.title}`,
                    separated: true,
                    destructive: true,
                    disabled: busy,
                    onSelect: () => onDelete(page),
                  },
                ]}
              />
            ) : null}
          </li>
        ))}
      </ul>
      {canEdit ? (
        <Button size="sm" variant="outline" onClick={onAdd}>
          ＋ Page
        </Button>
      ) : null}
    </section>
  );
}
