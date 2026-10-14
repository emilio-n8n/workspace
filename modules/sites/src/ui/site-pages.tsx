import { Button, cn, IconChevronDown } from "@workspace/ui";
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
 * Pages du site (TASK-006) : liste ordonnée, création, suppression et
 * renommage (le renommage se fait dans le titre de page, il change aussi le
 * titre par défaut du menu). L'ordre de cette liste **est** l'ordre du menu
 * de navigation.
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
          <li key={page.id} className="flex flex-col gap-1 rounded-lg border border-border p-1">
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => onSelect(page.id)}
                className={cn(
                  "min-w-0 flex-1 truncate rounded-lg px-2 py-1.5 text-left text-sm transition-colors",
                  page.id === activePageId ? "bg-accent text-accent-foreground" : "hover:bg-muted",
                )}
              >
                {page.title}
                <span className="block truncate text-[10px] text-muted-foreground">
                  /{page.slug}
                </span>
              </button>
              {canEdit && pages.length > 1 ? (
                <button
                  type="button"
                  aria-label={`Supprimer la page ${page.title}`}
                  title={`Supprimer la page ${page.title}`}
                  className="grid size-7 shrink-0 place-items-center rounded-md text-xs text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => onDelete(page)}
                  disabled={busy}
                >
                  ✕
                </button>
              ) : null}
            </div>
            {canEdit && pages.length > 1 ? (
              <div className="flex items-center gap-1 pl-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={`Monter la page ${page.title}`}
                  title={`Monter la page ${page.title}`}
                  disabled={busy || index === 0}
                  onClick={() => onMove(page.id, "up")}
                  className="size-7 justify-center p-0 text-muted-foreground"
                >
                  <IconChevronDown className="rotate-180" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={`Descendre la page ${page.title}`}
                  title={`Descendre la page ${page.title}`}
                  disabled={busy || index === pages.length - 1}
                  onClick={() => onMove(page.id, "down")}
                  className="size-7 justify-center p-0 text-muted-foreground"
                >
                  <IconChevronDown />
                </Button>
                <span className="text-[10px] text-muted-foreground">
                  Position {index + 1} sur {pages.length}
                </span>
              </div>
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
