import { Badge, Button, cn } from "@workspace/ui";
import { isPublished, publishActionLabel, publishStatus } from "../publish.ts";

export type SitePublishPanelProps = {
  /** Date de publication (ISO), `null` si le site est un brouillon. */
  publishedAt: string | null;
  canEdit: boolean;
  /** Opération de publication en vol. */
  busy: boolean;
  /** Message d'erreur de la dernière opération (reprise après échec). */
  error: string | null;
  onPublish: () => void;
  onUnpublish: () => void;
};

/**
 * Publication du site (TASK-005) : état publié / brouillon, date de mise en
 * ligne, et reprise après erreur — un échec laisse l'affichage sur le dernier
 * état **connu du serveur** (jamais sur un état optimiste) et le message
 * français expliquant l'échec est annoncé (`role="alert"`).
 */
export function SitePublishPanel({
  publishedAt,
  canEdit,
  busy,
  error,
  onPublish,
  onUnpublish,
}: SitePublishPanelProps) {
  const status = publishStatus(publishedAt);
  const enLigne = isPublished(publishedAt);

  return (
    <section aria-labelledby="site-publish-title" className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <h2
          id="site-publish-title"
          className="text-xs font-medium uppercase tracking-widest text-muted-foreground"
        >
          Publication
        </h2>
        <Badge variant={status.tone}>{status.label}</Badge>
      </div>

      <p role="status" className="text-xs text-muted-foreground">
        {status.detail}
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={!canEdit} loading={busy} onClick={onPublish}>
          {publishActionLabel(publishedAt)}
        </Button>
        {enLigne ? (
          <Button
            size="sm"
            variant="outline"
            disabled={!canEdit}
            loading={busy}
            onClick={onUnpublish}
          >
            Dépublier
          </Button>
        ) : null}
      </div>

      {error ? (
        <p
          role="alert"
          className="rounded-lg border border-destructive/40 bg-destructive/10 px-2 py-1 text-xs text-destructive"
        >
          {error}
        </p>
      ) : null}

      {!canEdit ? (
        <p className="text-xs text-muted-foreground">
          Seul un éditeur du site peut le publier ou le dépublier.
        </p>
      ) : null}
    </section>
  );
}

/** Bandeau de résultat d'une opération de publication, sous le panneau. */
export function SitePublishFeedback({
  busy,
  message,
  className,
}: {
  busy: boolean;
  message: string | null;
  className?: string;
}) {
  return (
    <p aria-live="polite" className={cn("min-h-4 text-xs text-muted-foreground", className)}>
      {busy ? "Envoi de l'opération…" : (message ?? "")}
    </p>
  );
}
