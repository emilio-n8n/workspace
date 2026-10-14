import { useNavigate } from "@tanstack/react-router";
import { Button, Dialog, Input, Label, LoadingState } from "@workspace/ui";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { createSpreadsheetFn, listSpreadsheetsFn } from "../server.ts";

type SheetSummary = {
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

/** Liste des feuilles de calcul visibles (fichiers Drive liés). */
export function SheetsList() {
  const navigate = useNavigate();
  const [sheets, setSheets] = useState<SheetSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setSheets(await listSpreadsheetsFn());
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
      const created = await createSpreadsheetFn({
        data: { parentFolderId: null, title: clean },
      });
      setTitle("");
      setDialogOpen(false);
      await navigate({ to: "/sheet/$fileId", params: { fileId: created.fileId } });
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
          <h1 className="font-display text-2xl font-semibold tracking-tight">Feuilles de calcul</h1>
          <p className="text-sm text-muted-foreground">
            Formules (SUM, AVG, MIN, MAX, COUNT), onglets et export CSV.
          </p>
        </div>
        <Button className="ml-auto" size="sm" onClick={() => setDialogOpen(true)}>
          Nouvelle feuille
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
        <LoadingState label="Chargement des feuilles…" />
      ) : sheets.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-8 text-center">
          <p className="text-sm text-muted-foreground">
            Aucune feuille pour le moment. Créez-en une — elle apparaîtra aussi dans le Drive.
          </p>
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {sheets.map((sheet) => (
            <li key={sheet.fileId}>
              <button
                type="button"
                onClick={() =>
                  void navigate({ to: "/sheet/$fileId", params: { fileId: sheet.fileId } })
                }
                className="flex h-full w-full flex-col gap-2 rounded-xl border border-border bg-card p-4 text-left shadow-soft transition-colors hover:bg-muted"
              >
                <span className="truncate font-display text-sm font-semibold">{sheet.title}</span>
                <span className="text-xs text-muted-foreground">
                  Modifiée le {formatDate(sheet.updatedAt)}
                  {sheet.canEdit ? "" : " · lecture seule"}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <Dialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        title="Nouvelle feuille de calcul"
      >
        <form onSubmit={onCreate} method="post" className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="sheet-title">Titre de la feuille</Label>
            <Input
              id="sheet-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Budget 2026"
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
