import { useNavigate } from "@tanstack/react-router";
import {
  Alert,
  Button,
  Dialog,
  EmptyState,
  IconPresentation,
  Input,
  Label,
  PageHeader,
} from "@workspace/ui";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { createPresentationFn, listPresentationsFn } from "../server.ts";

type SlideSummary = {
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

/** Liste des présentations visibles (fichiers Drive liés). */
export function SlidesList() {
  const navigate = useNavigate();
  const [slides, setSlides] = useState<SlideSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setSlides(await listPresentationsFn());
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
    setError(null);
    try {
      const created = await createPresentationFn({
        data: { parentFolderId: null, title: clean },
      });
      setTitle("");
      setDialogOpen(false);
      await navigate({ to: "/slide/$fileId", params: { fileId: created.fileId } });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Création impossible.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4">
      <PageHeader
        title="Présentations"
        description="Zones de texte, formes, mode présentation plein écran."
        actions={
          <Button size="sm" onClick={() => setDialogOpen(true)}>
            Nouvelle présentation
          </Button>
        }
      />

      {error ? <Alert tone="danger">{error}</Alert> : null}

      {loading ? (
        <p className="text-sm text-muted-foreground">Chargement…</p>
      ) : slides.length === 0 ? (
        <EmptyState
          icon={<IconPresentation />}
          title="Aucune présentation pour le moment."
          hint="Créez-en une — elle apparaîtra aussi dans le Drive."
          action={
            <Button size="sm" onClick={() => setDialogOpen(true)}>
              Nouvelle présentation
            </Button>
          }
        />
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {slides.map((presentation) => (
            <li key={presentation.fileId}>
              <button
                type="button"
                onClick={() =>
                  void navigate({ to: "/slide/$fileId", params: { fileId: presentation.fileId } })
                }
                className="flex h-full w-full flex-col gap-2 rounded-xl border border-border bg-card p-4 text-left shadow-soft transition-colors hover:bg-muted"
              >
                <span className="truncate font-display text-sm font-semibold">
                  {presentation.title}
                </span>
                <span className="text-xs text-muted-foreground">
                  Modifiée le {formatDate(presentation.updatedAt)}
                  {presentation.canEdit ? "" : " · lecture seule"}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} title="Nouvelle présentation">
        <form onSubmit={onCreate} method="post" className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="slides-title">Titre de la présentation</Label>
            <Input
              id="slides-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Présentation client"
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
