import { Button, cn, IconChevronDown, Input, Label } from "@workspace/ui";
import { useState } from "react";
import { NAV_LABEL_MAX, type NavigationItem, type NavigationPage } from "../navigation.ts";

export type SiteNavigationPanelProps = {
  /** Pages du site, dans l'ordre du menu. */
  pages: readonly NavigationPage[];
  /** Personnalisation enregistrée (libellé, visibilité). */
  items: readonly NavigationItem[];
  canEdit: boolean;
  busy: boolean;
  error: string | null;
  /** Message de confirmation de la dernière opération. */
  feedback?: string | null;
  onLabelChange: (pageId: string, label: string) => void;
  onToggleVisibility: (pageId: string) => void;
  /** Déplace la page (donc son entrée de menu) d'un cran. */
  onMove: (pageId: string, direction: "up" | "down") => void;
};

/**
 * Menu de navigation éditable (TASK-006) : libellé de chaque entrée
 * (indépendant du titre de la page), visibilité, et ordre.
 *
 * L'ordre suit celui des pages : déplacer une entrée ici déplace la page, si
 * bien qu'il n'existe jamais deux ordres divergents entre la liste des pages
 * et le menu publié.
 */
export function SiteNavigationPanel({
  pages,
  items,
  canEdit,
  busy,
  error,
  feedback = null,
  onLabelChange,
  onToggleVisibility,
  onMove,
}: SiteNavigationPanelProps) {
  // Les libellés sont modifiés localement puis enregistrés à la sortie du
  // champ : pas d'appel serveur à chaque frappe.
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  return (
    <section aria-labelledby="site-navigation-title" className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2
          id="site-navigation-title"
          className="text-xs font-medium uppercase tracking-widest text-muted-foreground"
        >
          Menu de navigation
        </h2>
        <p className="text-xs text-muted-foreground">{pages.length} pages</p>
      </div>
      <p className="text-xs text-muted-foreground">
        Le libellé peut différer du titre de la page ; une page masquée reste accessible par son
        adresse. Un libellé vide reprend le titre de la page.
      </p>

      <ul className="flex flex-col gap-2">
        {items.map((item, index) => {
          const page = pages.find((candidate) => candidate.id === item.pageId);
          if (!page) return null;
          const inputId = `nav-label-${item.pageId}`;
          return (
            <li
              key={item.pageId}
              className={cn(
                "flex flex-col gap-1.5 rounded-lg border border-border p-2",
                item.visible ? "bg-card" : "bg-muted/50",
              )}
              data-visible={item.visible || undefined}
            >
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor={inputId} className="truncate text-xs text-muted-foreground">
                  {page.title} <span className="text-[10px]">/{page.slug}</span>
                </Label>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={`Monter ${page.title} dans le menu`}
                    title={`Monter ${page.title} dans le menu`}
                    disabled={!canEdit || busy || index === 0}
                    onClick={() => onMove(item.pageId, "up")}
                    className="size-7 justify-center p-0 text-muted-foreground"
                  >
                    <IconChevronDown className="rotate-180" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={`Descendre ${page.title} dans le menu`}
                    title={`Descendre ${page.title} dans le menu`}
                    disabled={!canEdit || busy || index === items.length - 1}
                    onClick={() => onMove(item.pageId, "down")}
                    className="size-7 justify-center p-0 text-muted-foreground"
                  >
                    <IconChevronDown />
                  </Button>
                </div>
              </div>

              <Input
                id={inputId}
                aria-label={`Libellé de ${page.title} dans le menu`}
                value={drafts[item.pageId] ?? item.label}
                disabled={!canEdit}
                maxLength={NAV_LABEL_MAX}
                onChange={(event) =>
                  setDrafts((current) => ({ ...current, [item.pageId]: event.currentTarget.value }))
                }
                onBlur={(event) => {
                  const next = event.currentTarget.value;
                  setDrafts((current) => {
                    const copy = { ...current };
                    delete copy[item.pageId];
                    return copy;
                  });
                  if (next !== item.label) onLabelChange(item.pageId, next);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") event.currentTarget.blur();
                  if (event.key === "Escape") {
                    setDrafts((current) => {
                      const copy = { ...current };
                      delete copy[item.pageId];
                      return copy;
                    });
                  }
                }}
              />

              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={item.visible}
                  disabled={!canEdit || busy}
                  onChange={() => onToggleVisibility(item.pageId)}
                  className="size-3.5 rounded border-input accent-primary"
                />
                Afficher dans le menu
              </label>
            </li>
          );
        })}
      </ul>

      {error ? (
        <p
          role="alert"
          className="rounded-lg border border-destructive/40 bg-destructive/10 px-2 py-1 text-xs text-destructive"
        >
          {error}
        </p>
      ) : null}

      <p aria-live="polite" className="min-h-4 text-xs text-muted-foreground">
        {busy ? "Enregistrement du menu…" : (feedback ?? "")}
      </p>
    </section>
  );
}
