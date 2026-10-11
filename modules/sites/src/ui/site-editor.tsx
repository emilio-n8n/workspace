import { Button, cn, Dialog, Input, Label } from "@workspace/ui";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { renderMarkdown } from "../markdown.ts";
import {
  addPageFn,
  deletePageFn,
  getPageFn,
  getSiteFn,
  type PageView,
  renameSiteFn,
  type SiteDetail,
  savePageFn,
} from "../server.ts";

/**
 * Éditeur de site : pages à gauche, contenu Markdown à droite avec aperçu.
 * Le rendu échappe le HTML puis applique des transformations contrôlées
 * (voir `markdown.ts`), l'insertion est donc sûre.
 */
export function SiteEditor({ fileId }: { fileId: string }) {
  const [site, setSite] = useState<SiteDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [activePageId, setActivePageId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [pageTitle, setPageTitle] = useState("");
  const [content, setContent] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pageDialogOpen, setPageDialogOpen] = useState(false);
  const [newPageTitle, setNewPageTitle] = useState("");
  /** Page demandée alors que des modifications sont en attente de confirmation. */
  const [pendingPageId, setPendingPageId] = useState<string | null>(null);
  /** Page dont la suppression attend confirmation. */
  const [pageToDelete, setPageToDelete] = useState<PageView | null>(null);

  const loadPage = useCallback(
    async (pageId: string) => {
      const detail = await getPageFn({ data: { fileId, pageId } });
      setActivePageId(pageId);
      setPageTitle(detail.title);
      setContent(detail.content);
      setDirty(false);
      setSaved(false);
      setPreview(false);
    },
    [fileId],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getSiteFn({ data: { fileId } });
      setSite(data);
      setTitle(data.title);
      const first = data.pages[0];
      if (first) await loadPage(first.id);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Chargement impossible.");
    } finally {
      setLoading(false);
    }
  }, [fileId, loadPage]);

  useEffect(() => {
    void load();
  }, [load]);

  function markDirty() {
    setDirty(true);
    setSaved(false);
  }

  /** Change de page ; si des modifications sont en attente, demande confirmation. */
  function requestPageSwitch(pageId: string) {
    if (pageId === activePageId) return;
    if (dirty) {
      setPendingPageId(pageId);
      return;
    }
    void loadPage(pageId);
  }

  function confirmDiscard() {
    const pageId = pendingPageId;
    setPendingPageId(null);
    if (pageId) void loadPage(pageId);
  }

  async function onSave() {
    if (!activePageId) return;
    setBusy(true);
    setError(null);
    try {
      await savePageFn({
        data: { fileId, pageId: activePageId, title: pageTitle.trim(), content },
      });
      setDirty(false);
      setSaved(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Enregistrement impossible.");
    } finally {
      setBusy(false);
    }
  }

  async function onRenameSite() {
    if (!site) return;
    const clean = title.trim();
    if (clean.length === 0 || clean === site.title) {
      setTitle(site.title);
      return;
    }
    try {
      const renamed = await renameSiteFn({ data: { fileId, title: clean } });
      setSite({ ...site, title: renamed.title });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Renommage impossible.");
      setTitle(site.title);
    }
  }

  async function onAddPage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (newPageTitle.trim().length === 0) return;
    setBusy(true);
    try {
      const created = await addPageFn({ data: { fileId, title: newPageTitle.trim() } });
      setNewPageTitle("");
      setPageDialogOpen(false);
      if (site) setSite({ ...site, pages: created.pages });
      // Même garde que pour un clic de page : on ne sacrifie pas des
      // modifications en attente sans confirmation.
      requestPageSwitch(created.pageId);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Création impossible.");
    } finally {
      setBusy(false);
    }
  }

  async function onDeletePage(page: PageView) {
    setBusy(true);
    setError(null);
    try {
      const pages = await deletePageFn({ data: { fileId, pageId: page.id } });
      if (site) setSite({ ...site, pages });
      // On ne change de page que si la page active vient d'être supprimée :
      // les modifications en cours sur une autre page sont conservées.
      if (!activePageId || page.id === activePageId) {
        const next = pages[0];
        if (next) await loadPage(next.id);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Suppression impossible.");
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-5xl">
        <p aria-live="polite" className="animate-pulse text-sm text-muted-foreground">
          Chargement…
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-3">
      <header className="flex flex-wrap items-center gap-2">
        <a href="/" className="text-sm text-muted-foreground hover:text-foreground">
          ← Sites
        </a>
        <input
          aria-label="Nom du site"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          onBlur={() => void onRenameSite()}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
          disabled={!site?.canEdit}
          className="min-w-40 border-none bg-transparent font-display text-lg font-semibold tracking-tight outline-none"
        />
        <span
          role="status"
          className={cn("text-xs", saved ? "text-muted-foreground" : "text-attention")}
        >
          {dirty ? "Modifications non enregistrées" : saved ? "Enregistré" : ""}
        </span>
        <div className="ml-auto flex items-center gap-2">
          {!site?.canEdit ? (
            <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">
              Lecture seule
            </span>
          ) : null}
          <Button size="sm" variant="outline" onClick={() => setPreview((current) => !current)}>
            {preview ? "Éditer" : "Aperçu"}
          </Button>
          {site?.canEdit ? (
            <Button size="sm" loading={busy} disabled={!dirty} onClick={() => void onSave()}>
              Enregistrer
            </Button>
          ) : null}
        </div>
      </header>

      {error ? (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive"
        >
          {error}
        </p>
      ) : null}

      <div className="flex flex-col gap-3 lg:flex-row">
        <aside className="flex shrink-0 flex-col gap-2 lg:w-56">
          <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
            Pages
          </p>
          <ul className="flex flex-col gap-1">
            {site?.pages.map((page) => (
              <li key={page.id} className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => requestPageSwitch(page.id)}
                  className={cn(
                    "min-w-0 flex-1 truncate rounded-lg px-2 py-1.5 text-left text-sm transition-colors",
                    page.id === activePageId
                      ? "bg-accent text-accent-foreground"
                      : "hover:bg-muted",
                  )}
                >
                  {page.title}
                  <span className="block truncate text-[10px] text-muted-foreground">
                    /{page.slug}
                  </span>
                </button>
                {site.canEdit && site.pages.length > 1 ? (
                  <button
                    type="button"
                    aria-label={`Supprimer la page ${page.title}`}
                    className="grid size-7 shrink-0 place-items-center rounded-md text-xs text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                    onClick={() => setPageToDelete(page)}
                  >
                    ✕
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
          {site?.canEdit ? (
            <Button size="sm" variant="outline" onClick={() => setPageDialogOpen(true)}>
              ＋ Page
            </Button>
          ) : null}
        </aside>

        <section className="flex min-w-0 flex-1 flex-col gap-2">
          <Input
            aria-label="Titre de la page"
            value={pageTitle}
            onChange={(event) => {
              setPageTitle(event.target.value);
              markDirty();
            }}
            disabled={!site?.canEdit}
            maxLength={255}
          />
          {preview ? (
            <div
              className="workspace-site-preview min-h-96 rounded-xl border border-border bg-card p-6 text-sm"
              // biome-ignore lint/security/noDangerouslySetInnerHtml: HTML échappé puis transformé par `renderMarkdown` (aucun HTML brut accepté).
              dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }}
            />
          ) : (
            <textarea
              aria-label="Contenu Markdown"
              value={content}
              onChange={(event) => {
                setContent(event.target.value);
                markDirty();
              }}
              disabled={!site?.canEdit}
              rows={20}
              className="min-h-96 rounded-xl border border-border bg-card p-4 font-mono text-sm"
            />
          )}
        </section>
      </div>

      <Dialog open={pageDialogOpen} onClose={() => setPageDialogOpen(false)} title="Nouvelle page">
        <form onSubmit={onAddPage} method="post" className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="page-title">Titre de la page</Label>
            <Input
              id="page-title"
              value={newPageTitle}
              onChange={(event) => setNewPageTitle(event.target.value)}
              placeholder="Guide d'accueil"
              maxLength={255}
              autoFocus
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setPageDialogOpen(false)}>
              Annuler
            </Button>
            <Button type="submit" loading={busy} disabled={newPageTitle.trim().length === 0}>
              Ajouter la page
            </Button>
          </div>
        </form>
      </Dialog>

      <Dialog
        open={pendingPageId !== null}
        onClose={() => setPendingPageId(null)}
        title="Modifications non enregistrées"
      >
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">
            Abandonner les modifications non enregistrées ?
          </p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setPendingPageId(null)}>
              Annuler
            </Button>
            <Button type="button" variant="destructive" onClick={confirmDiscard}>
              Abandonner
            </Button>
          </div>
        </div>
      </Dialog>

      <Dialog
        open={pageToDelete !== null}
        onClose={() => setPageToDelete(null)}
        title={pageToDelete ? `Supprimer la page « ${pageToDelete.title} » ?` : "Supprimer la page"}
      >
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">Cette action est définitive.</p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setPageToDelete(null)}>
              Annuler
            </Button>
            <Button
              type="button"
              variant="destructive"
              loading={busy}
              onClick={() => {
                const page = pageToDelete;
                setPageToDelete(null);
                if (page) void onDeletePage(page);
              }}
            >
              Supprimer
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
