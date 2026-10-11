import { useNavigate } from "@tanstack/react-router";
import { Badge, Button, Dialog, Input, Label } from "@workspace/ui";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { createFormFn, type FormSummary, listFormsFn } from "../server.ts";

const STATUS_LABELS: Record<string, string> = {
  draft: "Brouillon",
  open: "Ouvert",
  closed: "Fermé",
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** Liste des formulaires visibles (fichiers Drive liés). */
export function FormsList() {
  const navigate = useNavigate();
  const [forms, setForms] = useState<FormSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setForms(await listFormsFn());
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
      const created = await createFormFn({
        data: { parentFolderId: null, title: clean },
      });
      setTitle("");
      setDialogOpen(false);
      await navigate({ to: "/form/$fileId", params: { fileId: created.fileId } });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Création impossible.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4">
      <header className="flex flex-wrap items-center gap-2">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">Formulaires</h1>
          <p className="text-sm text-muted-foreground">
            Créez, ouvrez et collectez des réponses — chaque formulaire vit aussi dans le Drive.
          </p>
        </div>
        <Button className="ml-auto" size="sm" onClick={() => setDialogOpen(true)}>
          Nouveau formulaire
        </Button>
      </header>

      {error ? (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive"
        >
          {error}
        </p>
      ) : null}

      {loading ? (
        <p className="text-sm text-muted-foreground">Chargement…</p>
      ) : forms.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-8 text-center">
          <p className="text-sm text-muted-foreground">
            Aucun formulaire pour le moment. Créez-en un pour commencer à collecter des réponses.
          </p>
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {forms.map((form) => (
            <li key={form.id}>
              <button
                type="button"
                onClick={() =>
                  void navigate({ to: "/form/$fileId", params: { fileId: form.fileId } })
                }
                className="flex h-full w-full flex-col gap-2 rounded-xl border border-border bg-card p-4 text-left shadow-soft transition-colors hover:bg-muted"
              >
                <span className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate font-display text-sm font-semibold">
                    {form.title}
                  </span>
                  <Badge variant={form.status === "open" ? "accent" : "outline"}>
                    {STATUS_LABELS[form.status] ?? form.status}
                  </Badge>
                </span>
                <span className="text-xs text-muted-foreground">
                  {form.responseCount} réponse(s) · modifié le {formatDate(form.updatedAt)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} title="Nouveau formulaire">
        <form onSubmit={onCreate} method="post" className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="form-title">Titre du formulaire</Label>
            <Input
              id="form-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Enquête de satisfaction"
              maxLength={255}
              autoFocus
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setDialogOpen(false)}>
              Annuler
            </Button>
            <Button type="submit" loading={busy} disabled={title.trim().length === 0}>
              Créer
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
