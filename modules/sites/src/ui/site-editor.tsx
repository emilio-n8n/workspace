import {
  Alert,
  Button,
  ConfirmDialog,
  cn,
  Dialog,
  Input,
  Label,
  SegmentedTabs,
} from "@workspace/ui";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import {
  addChildBlock,
  blocksToMarkdown,
  createBlock,
  findBlock,
  insertBlock,
  markdownToBlocks,
  moveBlock,
  patchBlock,
  removeBlock,
  renderBlocks,
  type SiteBlock,
  type SiteBlockKind,
  type SiteBlockValue,
} from "../blocks.ts";
import { renderMarkdown } from "../markdown.ts";
import {
  type NavigationItem,
  renderNavigation,
  setNavigationLabel,
  toggleNavigationVisibility,
} from "../navigation.ts";
import { DEFAULT_PREVIEW_VIEWPORT, type PreviewViewportId } from "../preview.ts";
import {
  addPageFn,
  deletePageFn,
  getPageFn,
  getSiteFn,
  movePageFn,
  type PageView,
  publishSiteFn,
  renameSiteFn,
  type SiteDetail,
  saveNavigationFn,
  savePageFn,
  unpublishSiteFn,
} from "../server.ts";
import { BlockLibrary } from "./block-library.tsx";
import { BlockProperties } from "./block-properties.tsx";
import { BlocksCanvas, BlocksEmptyState } from "./blocks-canvas.tsx";
import { SiteNavigationPanel } from "./site-navigation.tsx";
import { SitePagesPanel } from "./site-pages.tsx";
import { SitePreview } from "./site-preview.tsx";
import { SitePublishFeedback, SitePublishPanel } from "./site-publish.tsx";

/**
 * Éditeur de site : pages à gauche, contenu Markdown ou blocs à droite avec
 * aperçu. Le rendu échappe le HTML puis applique des transformations
 * contrôlées (voir `markdown.ts`), l'insertion est donc sûre.
 */
export function SiteEditor({ fileId }: { fileId: string }) {
  const [site, setSite] = useState<SiteDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [activePageId, setActivePageId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [pageTitle, setPageTitle] = useState("");
  const [content, setContent] = useState("");
  /** Mode d'édition de la page : Markdown ou blocs (constructeur). */
  const [mode, setMode] = useState<"markdown" | "blocks">("markdown");
  /** Mise en page de la page active (mode blocs). */
  const [blocks, setBlocks] = useState<SiteBlock[]>([]);
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
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
  /** Retour à l'édition Markdown en attente de confirmation. */
  const [pendingMode, setPendingMode] = useState<"markdown" | "blocks" | null>(null);
  /** Gabarit de l'aperçu (TASK-004). */
  const [viewport, setViewport] = useState<PreviewViewportId>(DEFAULT_PREVIEW_VIEWPORT);
  /** Opération de publication en vol (TASK-005). */
  const [publishBusy, setPublishBusy] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [publishFeedback, setPublishFeedback] = useState<string | null>(null);
  /** Dépublication en attente de confirmation. */
  const [unpublishConfirm, setUnpublishConfirm] = useState(false);
  /** Opération de menu en vol (TASK-006). */
  const [navBusy, setNavBusy] = useState(false);
  const [navError, setNavError] = useState<string | null>(null);
  const [navFeedback, setNavFeedback] = useState<string | null>(null);

  const canEdit = site?.canEdit === true;

  const loadPage = useCallback(
    async (pageId: string) => {
      const detail = await getPageFn({ data: { fileId, pageId } });
      setActivePageId(pageId);
      setPageTitle(detail.title);
      setContent(detail.content);
      // `blocks === null` : la page est écrite en Markdown. Sinon la page est
      // construite en blocs et `content` n'intervient plus au rendu.
      setBlocks(detail.blocks ?? []);
      setMode(detail.blocks === null ? "markdown" : "blocks");
      setSelectedBlockId(null);
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

  // -------------------------------------------------------------------------
  // Pages
  // -------------------------------------------------------------------------

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
        data: {
          fileId,
          pageId: activePageId,
          title: pageTitle.trim(),
          content,
          // Le mode d'édition est explicite : `null` rend la page au Markdown.
          blocks: mode === "blocks" ? blocks : null,
        },
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

  /** Recharge l'état du site sans toucher à la page affichée. */
  const refreshSite = useCallback(async () => {
    try {
      setSite(await getSiteFn({ data: { fileId } }));
    } catch {
      // La page complète reste affichée : seule l'erreur est visible.
    }
  }, [fileId]);

  /** Entrées du menu, alignées sur les pages courantes. */
  const items: NavigationItem[] = site?.navigation ?? [];

  /** Corps de page rendu (blocs ou Markdown) et menu, pour l'aperçu. */
  const bodyHtml = mode === "blocks" ? renderBlocks(blocks) : renderMarkdown(content);
  const navigationHtml = renderNavigation(site?.pages ?? [], items, activePageId);

  // -------------------------------------------------------------------------
  // Publication (TASK-005)
  // -------------------------------------------------------------------------

  /** Message français d'une erreur serveur, quel que soit son enrobage. */
  function messageOf(caught: unknown, fallback: string): string {
    if (caught instanceof Error && caught.message.length > 0) return caught.message;
    if (typeof caught === "string") return caught;
    const record = caught as { data?: { message?: unknown }; message?: unknown };
    if (typeof record?.data?.message === "string") return record.data.message;
    if (typeof record?.message === "string") return record.message;
    return fallback;
  }

  /**
   * Publie ou dépublie. En cas d'échec, on **revient** à l'état connu du
   * serveur (`refreshSite`) et on affiche le message : aucun état optimiste
   * ne survit à une erreur.
   */
  async function runPublish(action: "publish" | "unpublish") {
    setPublishBusy(true);
    setPublishError(null);
    try {
      const updated =
        action === "publish"
          ? await publishSiteFn({ data: { fileId } })
          : await unpublishSiteFn({ data: { fileId } });
      setSite(updated);
      setPublishFeedback(
        action === "publish" ? "Site publié." : "Site dépublié : il est de nouveau en brouillon.",
      );
    } catch (caught) {
      setPublishError(
        messageOf(
          caught,
          action === "publish" ? "Publication impossible." : "Dépublication impossible.",
        ),
      );
      await refreshSite();
    } finally {
      setPublishBusy(false);
    }
  }

  // -------------------------------------------------------------------------
  // Menu de navigation (TASK-006)
  // -------------------------------------------------------------------------

  /** Applique une modification du menu, puis l'enregistre immédiatement. */
  async function saveNavigation(items: NavigationItem[]) {
    setNavBusy(true);
    setNavError(null);
    try {
      const updated = await saveNavigationFn({ data: { fileId, items } });
      setSite(updated);
      setNavFeedback("Menu enregistré.");
    } catch (caught) {
      setNavError(messageOf(caught, "Enregistrement du menu impossible."));
      await refreshSite();
    } finally {
      setNavBusy(false);
    }
  }

  function onNavLabel(pageId: string, label: string) {
    void saveNavigation(setNavigationLabel(items, pageId, label));
  }

  function onNavVisibility(pageId: string) {
    void saveNavigation(toggleNavigationVisibility(items, pageId));
  }

  async function onMovePage(pageId: string, direction: "up" | "down") {
    setNavBusy(true);
    setNavError(null);
    try {
      const { pages } = await movePageFn({ data: { fileId, pageId, direction } });
      if (site) setSite({ ...site, pages });
      setNavFeedback("Ordre des pages enregistré.");
      // La page déplacée peut être celle affichée : son contenu, lui, ne bouge pas.
      await refreshSite();
    } catch (caught) {
      setNavError(messageOf(caught, "Déplacement impossible."));
    } finally {
      setNavBusy(false);
    }
  }

  // -------------------------------------------------------------------------
  // Blocs
  // -------------------------------------------------------------------------

  /** Change le mode d'édition de la page, en convertissant le contenu. */
  function requestMode(next: "markdown" | "blocks") {
    if (next === mode) return;
    if (next === "markdown" && blocks.length > 0) {
      // Conversion des blocs en Markdown : le contenu actuel serait remplacé,
      // on demande confirmation avant d'écraser.
      setPendingMode(next);
      return;
    }
    applyMode(next);
  }

  function applyMode(next: "markdown" | "blocks") {
    setPendingMode(null);
    if (next === mode) return;
    if (next === "blocks") {
      // Pont Markdown → blocs : la page existante devient un point de départ.
      setBlocks((current) => (current.length > 0 ? current : markdownToBlocks(content)));
    } else {
      // Chemin inverse : le Markdown redevient la source de vérité et reprend
      // exactement la mise en page affichée (jamais de perte silencieuse).
      setContent(blocksToMarkdown(blocks));
    }
    setMode(next);
    setSelectedBlockId(null);
    markDirty();
  }

  /** Repère d'insertion de la bibliothèque : la sélection, si elle est au premier niveau. */
  const anchoredId = blocks.some((block) => block.id === selectedBlockId) ? selectedBlockId : null;

  function addBlock(kind: SiteBlockKind) {
    const block = createBlock(kind);
    // Insertion après la sélection : l'utilisateur garde son contexte.
    setBlocks((current) => insertBlock(current, block, anchoredId));
    setSelectedBlockId(block.id);
    markDirty();
  }

  function patchBlockProp(blockId: string, key: string, value: SiteBlockValue) {
    setBlocks((current) => patchBlock(current, blockId, key, value));
    markDirty();
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
    <div className="mx-auto flex max-w-6xl flex-col gap-3">
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
          {activePageId ? (
            // En lecture seule, le mode reste lisible mais n'est pas actionnable
            // (le composant partagé n'expose pas d'état désactivé).
            <span
              aria-disabled={!canEdit}
              className={cn(!canEdit && "pointer-events-none opacity-60")}
            >
              <SegmentedTabs
                ariaLabel="Mode d'édition de la page"
                value={mode}
                onChange={(next) => requestMode(next)}
                items={[
                  { id: "markdown", label: "Markdown" },
                  { id: "blocks", label: "Blocs" },
                ]}
              />
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

      {error ? <Alert tone="danger">{error}</Alert> : null}

      <div className="flex flex-col gap-3 lg:flex-row">
        <aside className="flex shrink-0 flex-col gap-4 lg:w-60">
          <SitePagesPanel
            pages={site?.pages ?? []}
            activePageId={activePageId}
            canEdit={canEdit}
            busy={busy || navBusy}
            onSelect={requestPageSwitch}
            onMove={(pageId, direction) => void onMovePage(pageId, direction)}
            onDelete={setPageToDelete}
            onAdd={() => setPageDialogOpen(true)}
          />
          <SiteNavigationPanel
            pages={site?.pages ?? []}
            items={items}
            canEdit={canEdit}
            busy={navBusy}
            error={navError}
            feedback={navFeedback}
            onLabelChange={onNavLabel}
            onToggleVisibility={onNavVisibility}
            onMove={(pageId, direction) => void onMovePage(pageId, direction)}
          />
          <SitePublishPanel
            publishedAt={site?.publishedAt ?? null}
            canEdit={canEdit}
            busy={publishBusy}
            error={publishError}
            onPublish={() => void runPublish("publish")}
            onUnpublish={() => setUnpublishConfirm(true)}
          />
          <SitePublishFeedback busy={publishBusy} message={publishFeedback} />
        </aside>

        <section className="flex min-w-0 flex-1 flex-col gap-3">
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
            <SitePreview
              viewport={viewport}
              onViewportChange={setViewport}
              title={site?.title ?? title}
              navigationHtml={navigationHtml}
              bodyHtml={bodyHtml}
              dirty={dirty}
            />
          ) : mode === "blocks" ? (
            <>
              <BlockLibrary canEdit={canEdit} afterId={anchoredId} onAdd={addBlock} />
              {blocks.length === 0 ? (
                <BlocksEmptyState canEdit={canEdit} onAdd={addBlock} />
              ) : (
                <BlocksCanvas
                  blocks={blocks}
                  selectedId={selectedBlockId}
                  canEdit={canEdit}
                  onSelect={setSelectedBlockId}
                  onMove={(id, direction) => {
                    setBlocks((current) => moveBlock(current, id, direction));
                    markDirty();
                  }}
                  onRemove={(id) => {
                    setBlocks((current) => removeBlock(current, id));
                    if (selectedBlockId === id) setSelectedBlockId(null);
                    markDirty();
                  }}
                />
              )}
            </>
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

        {mode === "blocks" && !preview ? (
          <aside className="flex shrink-0 flex-col gap-2 lg:w-72 xl:w-80">
            <BlockProperties
              block={findBlock(blocks, selectedBlockId ?? "")}
              canEdit={canEdit}
              onPatch={patchBlockProp}
              onMoveChild={(id, direction) => {
                setBlocks((current) => moveBlock(current, id, direction));
                markDirty();
              }}
              onAddChild={(kind) => {
                if (!selectedBlockId) return;
                setBlocks((current) => addChildBlock(current, selectedBlockId, kind));
                markDirty();
              }}
              onRemoveChild={(id) => {
                setBlocks((current) => removeBlock(current, id));
                markDirty();
              }}
            />
          </aside>
        ) : null}
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

      <ConfirmDialog
        open={pendingPageId !== null}
        onClose={() => setPendingPageId(null)}
        onConfirm={confirmDiscard}
        title="Modifications non enregistrées"
        message="Abandonner les modifications non enregistrées ?"
        confirmLabel="Abandonner"
        destructive
      />

      <ConfirmDialog
        open={pageToDelete !== null}
        onClose={() => setPageToDelete(null)}
        onConfirm={() => {
          const page = pageToDelete;
          setPageToDelete(null);
          if (page) void onDeletePage(page);
        }}
        title={pageToDelete ? `Supprimer la page « ${pageToDelete.title} » ?` : "Supprimer la page"}
        message="Cette action est définitive."
        confirmLabel="Supprimer"
        busy={busy}
        destructive
      />

      <ConfirmDialog
        open={pendingMode !== null}
        onClose={() => setPendingMode(null)}
        onConfirm={() => applyMode(pendingMode ?? "markdown")}
        title="Revenir au Markdown ?"
        message="Les blocs sont convertis en texte Markdown ; la mise en page est simplifiée."
        confirmLabel="Convertir"
        destructive
      />

      <ConfirmDialog
        open={unpublishConfirm}
        onClose={() => setUnpublishConfirm(false)}
        onConfirm={() => {
          setUnpublishConfirm(false);
          void runPublish("unpublish");
        }}
        title="Dépublier ce site ?"
        message="Le site repasse en brouillon : son adresse ne sera plus accessible aux autres membres."
        confirmLabel="Dépublier"
        busy={publishBusy}
        destructive
      />
    </div>
  );
}
