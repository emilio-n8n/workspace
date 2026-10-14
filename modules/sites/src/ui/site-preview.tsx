import { cn, SegmentedTabs } from "@workspace/ui";
import {
  PREVIEW_VIEWPORTS,
  type PreviewViewportId,
  previewFrameHeight,
  previewFrameWidth,
  previewViewport,
} from "../preview.ts";

export type SitePreviewProps = {
  /** Gabarit courant (ordinateur, tablette, mobile). */
  viewport: PreviewViewportId;
  onViewportChange: (viewport: PreviewViewportId) => void;
  /** Nom du site, affiché dans la barre de l'aperçu. */
  title: string;
  /** Menu de navigation (voir `renderNavigation`). */
  navigationHtml: string;
  /** Corps de page : blocs ou Markdown rendu. */
  bodyHtml: string;
  /** Modifications non enregistrées : rappelé dans l'aperçu. */
  dirty: boolean;
};

/**
 * Aperçu du site (TASK-004) : gabarits réalistes — ordinateur 1 280 px,
 * tablette 834 px, mobile 390 px — appliqués comme **largeur explicite**.
 *
 * Le contenu n'est jamais rogné : le cadre est plus large que la colonne de
 * l'éditeur, et c'est le conteneur qui défile horizontalement
 * (`overflow-x-auto`) plutôt que la page qui se retrouve coupée.
 */
export function SitePreview({
  viewport,
  onViewportChange,
  title,
  navigationHtml,
  bodyHtml,
  dirty,
}: SitePreviewProps) {
  const width = previewFrameWidth(viewport);

  return (
    <section aria-labelledby="site-preview-title" className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <h2
          id="site-preview-title"
          className="text-xs font-medium uppercase tracking-widest text-muted-foreground"
        >
          Aperçu du site
        </h2>
        <SegmentedTabs
          ariaLabel="Largeur de l'aperçu"
          value={viewport}
          onChange={onViewportChange}
          items={PREVIEW_VIEWPORTS.map((item) => ({ id: item.id, label: item.label }))}
        />
        <span role="status" className="text-xs text-muted-foreground">
          {previewViewport(viewport).label} — {width}
        </span>
      </div>

      <div className="max-w-full overflow-x-auto rounded-xl border border-border bg-muted/40 p-2">
        <div className="mx-auto" style={{ width, minHeight: previewFrameHeight(viewport) }}>
          <div className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4 shadow-soft sm:p-6">
            <header className="flex flex-wrap items-center gap-3 border-b border-border pb-3">
              <p className="font-display text-sm font-semibold tracking-tight text-foreground">
                {title}
              </p>
              <div
                // biome-ignore lint/security/noDangerouslySetInnerHtml: HTML produit par `renderNavigation` (libellés échappés, liens internes).
                dangerouslySetInnerHTML={{ __html: navigationHtml }}
              />
            </header>
            {dirty ? (
              <p className="rounded-lg bg-attention/15 px-3 py-1.5 text-xs text-attention-foreground">
                Aperçu incluant des modifications non enregistrées.
              </p>
            ) : null}
            <div
              className="workspace-site-preview text-sm"
              // biome-ignore lint/security/noDangerouslySetInnerHtml: HTML produit par `renderBlocks` / `renderMarkdown` (échappement puis transformations contrôlées, URL assainies).
              dangerouslySetInnerHTML={{ __html: bodyHtml }}
            />
          </div>
        </div>
      </div>
    </section>
  );
}

/** Résumé lisible du gabarit, pour les libellés annexes. */
export function SitePreviewLegend({ viewport }: { viewport: PreviewViewportId }) {
  const view = previewViewport(viewport);
  return (
    <p className={cn("text-xs text-muted-foreground")}>
      {view.label} : {view.width} px de large, {view.height} px de haut.
    </p>
  );
}
