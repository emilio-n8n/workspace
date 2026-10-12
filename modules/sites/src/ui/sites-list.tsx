import { useNavigate } from "@tanstack/react-router";
import {
  Alert,
  Button,
  Dialog,
  EmptyState,
  IconGlobe,
  Input,
  Label,
  PageHeader,
} from "@workspace/ui";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { createSiteFn, listSitesFn } from "../server.ts";

type SiteSummary = {
  fileId: string;
  title: string;
  updatedAt: string;
  canEdit: boolean;
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** Liste des sites visibles (fichiers Drive liés). */
export function SitesList() {
  const navigate = useNavigate();
  const [sites, setSites] = useState<SiteSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setSites(await listSitesFn());
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Chargement impossible.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function onCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const clean = title.trim();
    if (clean.length === 0) return;
    setBusy(true);
    try {
      const created = await createSiteFn({
        data: { parentFolderId: null, title: clean },
      });
      setTitle("");
      setDialogOpen(false);
      await navigate({ to: "/site/$fileId", params: { fileId: created.fileId } });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Création impossible.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4">
      <PageHeader
        title="Sites internes"
        description="Pages en Markdown rendu en HTML sûr, réunies dans un site d'équipe."
        actions={
          <Button size="sm" onClick={() => setDialogOpen(true)}>
            Nouveau site
          </Button>
        }
      />

      {error ? <Alert tone="danger">{error}</Alert> : null}

      {loading ? (
        <p className="text-sm text-muted-foreground">Chargement…</p>
      ) : sites.length === 0 ? (
        <EmptyState
          icon={<IconGlobe />}
          title="Aucun site pour le moment"
          hint="Créez-en un — il apparaîtra aussi dans le Drive."
          action={
            <Button size="sm" onClick={() => setDialogOpen(true)}>
              Nouveau site
            </Button>
          }
        />
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {sites.map((site) => (
            <li key={site.fileId}>
              <button
                type="button"
                onClick={() =>
                  void navigate({ to: "/site/$fileId", params: { fileId: site.fileId } })
                }
                className="flex h-full w-full flex-col gap-2 rounded-xl border border-border bg-card p-4 text-left shadow-soft transition-colors hover:bg-muted"
              >
                <span className="truncate font-display text-sm font-semibold">{site.title}</span>
                <span className="text-xs text-muted-foreground">
                  Modifié le {formatDate(site.updatedAt)}
                  {site.canEdit ? "" : " · lecture seule"}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} title="Nouveau site">
        <form onSubmit={onCreate} method="post" className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="site-title">Nom du site</Label>
            <Input
              id="site-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Intranet de l'équipe"
              maxLength={255}
              autoFocus
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setDialogOpen(false)}>
              Annuler
            </Button>
            <Button type="submit" loading={busy} disabled={title.trim().length === 0}>
              Créer et ouvrir
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
