import { useNavigate } from "@tanstack/react-router";
import {
  Alert,
  Badge,
  Button,
  Dialog,
  EmptyState,
  IconClipboard,
  Input,
  Label,
  LoadingState,
  PageHeader,
} from "@workspace/ui";
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
      <PageHeader
        title="Formulaires"
        description="Créez, ouvrez et collectez des réponses — chaque formulaire vit aussi dans le Drive."
        actions={
          <Button size="sm" onClick={() => setDialogOpen(true)}>
            Nouveau formulaire
          </Button>
        }
      />

      {error ? <Alert tone="danger">{error}</Alert> : null}

      {loading ? (
        <LoadingState label="Chargement des formulaires…" />
      ) : forms.length === 0 ? (
        <EmptyState
          icon={<IconClipboard />}
          title="Aucun formulaire pour le moment"
          hint="Créez-en un pour commencer à collecter des réponses."
          action={
            <Button size="sm" onClick={() => setDialogOpen(true)}>
              Nouveau formulaire
            </Button>
          }
        />
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
