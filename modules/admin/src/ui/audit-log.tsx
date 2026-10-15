import { Badge, Button, Input, Label } from "@workspace/ui";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { type AuditEntry, type AuditPage, listAuditFn } from "../server.ts";

/** Libellés français des résultats journalisés. */
const RESULT_LABELS: Record<string, { label: string; bad?: boolean }> = {
  success: { label: "Succès" },
  denied: { label: "Refusé", bad: true },
  error: { label: "Erreur", bad: true },
};

/** Brouillon de filtres — chaîne vide = critère absent. */
type AuditFilters = {
  action: string;
  actorId: string;
  from: string;
  to: string;
};

const EMPTY_FILTERS: AuditFilters = { action: "", actorId: "", from: "", to: "" };

/**
 * Journal d'audit : filtres (préfixe d'action, acteur, plage de dates),
 * compteur et pagination « Précédent / Suivant ». La page parente incrémente
 * `refreshKey` après une mutation pour recharger la vue courante.
 */
export function AuditLog({ refreshKey = 0 }: { refreshKey?: number }) {
  const [draft, setDraft] = useState<AuditFilters>(EMPTY_FILTERS);
  const [applied, setApplied] = useState<AuditFilters>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<AuditPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (filters: AuditFilters, targetPage: number) => {
    setLoading(true);
    try {
      const result = await listAuditFn({
        data: {
          action: filters.action.trim() || undefined,
          actorId: filters.actorId.trim() || undefined,
          from: filters.from || undefined,
          to: filters.to || undefined,
          page: targetPage,
        },
      });
      setData(result);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Chargement du journal impossible.");
    } finally {
      setLoading(false);
    }
  }, []);

  // `refreshKey` est un déclencheur volontaire (mutations de la page parente),
  // pas une donnée lue dans l'effet.
  // biome-ignore lint/correctness/useExhaustiveDependencies: rechargement après mutation parente.
  useEffect(() => {
    void load(applied, page);
  }, [load, applied, page, refreshKey]);

  function submitFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPage(1);
    setApplied({ ...draft });
  }

  function resetFilters() {
    setDraft(EMPTY_FILTERS);
    setPage(1);
    setApplied(EMPTY_FILTERS);
  }

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const pageSize = data?.pageSize ?? 0;
  const pageCount = pageSize > 0 ? Math.max(1, Math.ceil(total / pageSize)) : 1;

  return (
    <section
      className="flex min-h-0 flex-1 flex-col gap-3 rounded-xl border border-border bg-card p-4"
      aria-busy={loading}
    >
      <h2 className="font-display text-sm font-semibold">Journal d'audit</h2>

      <form className="flex flex-wrap items-end gap-2" onSubmit={submitFilters}>
        <div className="flex min-w-40 flex-1 flex-col gap-1">
          <Label htmlFor="audit-action">Action</Label>
          <Input
            id="audit-action"
            value={draft.action}
            placeholder="docs.document"
            autoComplete="off"
            onChange={(event) => setDraft({ ...draft, action: event.target.value })}
          />
        </div>
        <div className="flex min-w-40 flex-1 flex-col gap-1">
          <Label htmlFor="audit-actor">Acteur</Label>
          <Input
            id="audit-actor"
            value={draft.actorId}
            placeholder="Identifiant utilisateur"
            autoComplete="off"
            onChange={(event) => setDraft({ ...draft, actorId: event.target.value })}
          />
        </div>
        <div className="flex w-40 flex-col gap-1">
          <Label htmlFor="audit-from">Du</Label>
          <Input
            id="audit-from"
            type="date"
            value={draft.from}
            onChange={(event) => setDraft({ ...draft, from: event.target.value })}
          />
        </div>
        <div className="flex w-40 flex-col gap-1">
          <Label htmlFor="audit-to">Au</Label>
          <Input
            id="audit-to"
            type="date"
            value={draft.to}
            onChange={(event) => setDraft({ ...draft, to: event.target.value })}
          />
        </div>
        <div className="flex gap-2">
          <Button type="submit" size="sm" loading={loading}>
            Filtrer
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={loading}
            onClick={resetFilters}
          >
            Réinitialiser
          </Button>
        </div>
      </form>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {total} évènement{total === 1 ? "" : "s"}
          {loading ? " · chargement…" : ""}
        </p>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={loading || page <= 1}
            onClick={() => setPage((current) => Math.max(1, current - 1))}
          >
            Précédent
          </Button>
          <span className="text-xs text-muted-foreground">
            Page {data?.page ?? page} sur {pageCount}
          </span>
          <Button
            size="sm"
            variant="outline"
            disabled={loading || page >= pageCount}
            onClick={() => setPage((current) => Math.min(pageCount, current + 1))}
          >
            Suivant
          </Button>
        </div>
      </div>

      {error ? (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      {loading && rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Chargement…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {total === 0 ? "Aucun évènement pour ces critères." : "Aucun évènement sur cette page."}
        </p>
      ) : (
        <ul className="flex min-h-0 flex-1 flex-col divide-y divide-border overflow-y-auto">
          {rows.map((entry: AuditEntry) => {
            const result = RESULT_LABELS[entry.result] ?? { label: entry.result };
            return (
              <li key={entry.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                <span className="font-mono text-xs">{entry.action}</span>
                {entry.resourceType ? (
                  <span className="text-xs text-muted-foreground">
                    {entry.resourceType}/{entry.resourceId?.slice(0, 8) ?? "?"}
                  </span>
                ) : null}
                {entry.actorUserId ? (
                  <span
                    className="font-mono text-xs text-muted-foreground"
                    title={entry.actorUserId}
                  >
                    {entry.actorUserId.slice(0, 8)}
                  </span>
                ) : null}
                <Badge
                  variant={result.bad ? "outline" : "accent"}
                  className={result.bad ? "text-destructive" : undefined}
                >
                  {result.label}
                </Badge>
                <span className="ml-auto text-xs text-muted-foreground">
                  {entry.actorTokenId ? "jeton · " : ""}
                  {new Date(entry.createdAt).toLocaleString("fr-FR")}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
