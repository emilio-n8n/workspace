// biome-ignore-all lint/correctness/useExhaustiveDependencies: effets volontairement liés aux seules valeurs stables (handlers recréés à chaque rendu) — arbitrage documenté dans la refonte parité.
import {
  Alert,
  Button,
  ConfirmDialog,
  cn,
  Dialog,
  IconClose,
  IconMore,
  IconPlus,
  IconRedo,
  IconUndo,
  Input,
  Label,
  Menu,
  SegmentedTabs,
} from "@workspace/ui";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import {
  addChildBlock,
  BLOCKS_LIMITS,
  blockLabel,
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

/** Profondeur de l'historique des blocs (annuler / rétablir). */
const BLOCKS_HISTORY_LIMIT = 50;

/** Fenêtre de fusion des actions répétées (frappe) dans l'historique. */
const COALESCE_MS = 600;

/** Un champ de saisie a le clavier : les raccourcis de l'éditeur s'effacent. */
function isTypingTarget(target: Element | null): boolean {
  if (!target) return false;
  const tag = target.tagName.toUpperCase();
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

/** Une fenêtre modale est ouverte : elle garde le clavier pour elle. */
function isInsideModal(target: Element | null): boolean {
  return target?.closest("dialog, [role='dialog']") != null;
}

/** Position d'un bloc dans sa propre liste (premier niveau ou colonne). */
function blockPosition(
  blocks: readonly SiteBlock[],
  id: string,
): { index: number; count: number } | null {
  const index = blocks.findIndex((block) => block.id === id);
  if (index >= 0) return { index, count: blocks.length };
  for (const block of blocks) {
    if (block.kind !== "columns") continue;
    const child = block.children.findIndex((candidate) => candidate.id === id);
    if (child >= 0) return { index: child, count: block.children.length };
  }
  return null;
}

/**
 * Éditeur de site : une barre d'outils unique, les pages et l'organisation
 * dans un panneau repliable, le contenu édité en place (Markdown ou blocs) et
 * l'aperçu en plein volet. Le rendu échappe le HTML puis applique des
 * transformations contrôlées (voir `markdown.ts`), l'insertion est donc sûre.
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
  /** Bloc dont le texte est édité en place sur la page. */
  const [editingBlockId, setEditingBlockId] = useState<string | null>(null);
  /** Dialogue des propriétés du bloc sélectionné. */
  const [propsOpen, setPropsOpen] = useState(false);
  /** Panneau d'organisation (pages, menu, publication) ouvert. */
  const [panelOpen, setPanelOpen] = useState(true);
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

  /** Blocs de référence pour l'historique (dernier état connu). */
  const blocksRef = useRef<SiteBlock[]>([]);
  /** Historique annuler/rétablir des blocs : instantanés empilés, bornés. */
  const pastRef = useRef<SiteBlock[][]>([]);
  const futureRef = useRef<SiteBlock[][]>([]);
  /** Dernière action poussée : fusionne les répétitions (frappe). */
  const lastPushRef = useRef<{ kind: string; at: number } | null>(null);
  /** Re-rend les boutons Annuler/Rétablir quand les piles changent. */
  const [historyVersion, setHistoryVersion] = useState(0);

  useEffect(() => {
    blocksRef.current = blocks;
  }, [blocks]);

  const canEdit = site?.canEdit === true;

  /** Nouvelle page ou nouveau mode : l'historique repart vierge. */
  const resetHistory = useCallback(() => {
    pastRef.current = [];
    futureRef.current = [];
    lastPushRef.current = null;
    setHistoryVersion((version) => version + 1);
  }, []);

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
      setEditingBlockId(null);
      setPropsOpen(false);
      setDirty(false);
      setSaved(false);
      setPreview(false);
      resetHistory();
    },
    [fileId, resetHistory],
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
  // Historique des blocs (annuler / rétablir)
  // -------------------------------------------------------------------------

  /** Empile l'état courant des blocs ; les répétitions (frappe) se fusionnent. */
  function pushHistory(kind: string) {
    const now = Date.now();
    const last = lastPushRef.current;
    if (last && last.kind === kind && now - last.at < COALESCE_MS) {
      last.at = now;
      return;
    }
    pastRef.current = [...pastRef.current, blocksRef.current].slice(-BLOCKS_HISTORY_LIMIT);
    futureRef.current = [];
    lastPushRef.current = { kind, at: now };
    setHistoryVersion((version) => version + 1);
  }

  /** Remet une mise en page en place, en recadrant la sélection. */
  function applyBlocks(next: SiteBlock[]) {
    blocksRef.current = next;
    setBlocks(next);
    setSelectedBlockId((current) => (current && findBlock(next, current) ? current : null));
    setEditingBlockId(null);
    markDirty();
  }

  function doUndo() {
    const previous = pastRef.current[pastRef.current.length - 1];
    if (!previous) return;
    pastRef.current = pastRef.current.slice(0, -1);
    futureRef.current = [blocksRef.current, ...futureRef.current].slice(0, BLOCKS_HISTORY_LIMIT);
    applyBlocks(previous);
    setHistoryVersion((version) => version + 1);
  }

  function doRedo() {
    const [next, ...rest] = futureRef.current;
    if (!next) return;
    futureRef.current = rest;
    pastRef.current = [...pastRef.current, blocksRef.current].slice(-BLOCKS_HISTORY_LIMIT);
    applyBlocks(next);
    setHistoryVersion((version) => version + 1);
  }

  const canUndo = historyVersion >= 0 && pastRef.current.length > 0;
  const canRedo = historyVersion >= 0 && futureRef.current.length > 0;

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
    setEditingBlockId(null);
    setPropsOpen(false);
    resetHistory();
    markDirty();
  }

  /** Repère d'insertion de la bibliothèque : la sélection, si elle est au premier niveau. */
  const anchoredId = blocks.some((block) => block.id === selectedBlockId) ? selectedBlockId : null;

  function addBlock(kind: SiteBlockKind) {
    pushHistory("block-add");
    const block = createBlock(kind);
    // Insertion après la sélection : l'utilisateur garde son contexte.
    setBlocks((current) => insertBlock(current, block, anchoredId));
    setSelectedBlockId(block.id);
    editingReset();
    markDirty();
  }

  function patchBlockProp(blockId: string, key: string, value: SiteBlockValue) {
    pushHistory(`block-patch:${key}`);
    setBlocks((current) => patchBlock(current, blockId, key, value));
    markDirty();
  }

  /** Frappe dans l'éditeur en place : l'instantané a déjà été poussé au départ. */
  function changeBlockText(blockId: string, text: string) {
    setBlocks((current) => patchBlock(current, blockId, "text", text));
    markDirty();
  }

  /**
   * Clic sur le contenu d'un bloc (2-clic, Entrée, frappe) : un titre ou un
   * texte s'édite en place, les autres blocs ouvrent leurs propriétés.
   */
  function startBlockEdit(blockId: string, seed?: string) {
    if (!canEdit) return;
    const block = findBlock(blocks, blockId);
    if (!block) return;
    setSelectedBlockId(blockId);
    if (block.kind !== "heading" && block.kind !== "text") {
      setPropsOpen(true);
      return;
    }
    pushHistory("block-text");
    setEditingBlockId(blockId);
    if (seed !== undefined) {
      const text = block.text.trim().length === 0 ? seed : block.text + seed;
      setBlocks((current) => patchBlock(current, blockId, "text", text));
      markDirty();
    }
  }

  function editingReset() {
    setEditingBlockId(null);
  }

  /** Déplace un bloc d'un cran dans sa propre liste (premier niveau ou colonne). */
  function moveBlockById(blockId: string, direction: "up" | "down") {
    if (!canEdit) return;
    const position = blockPosition(blocks, blockId);
    if (!position) return;
    if (direction === "up" && position.index === 0) return;
    if (direction === "down" && position.index === position.count - 1) return;
    pushHistory("block-move");
    setBlocks((current) => moveBlock(current, blockId, direction));
    markDirty();
  }

  function removeBlockById(blockId: string) {
    if (!canEdit) return;
    pushHistory("block-remove");
    setBlocks((current) => removeBlock(current, blockId));
    if (selectedBlockId === blockId) {
      setSelectedBlockId(null);
      setPropsOpen(false);
    }
    if (editingBlockId === blockId) setEditingBlockId(null);
    markDirty();
  }

  function addChildToBlock(parentId: string, kind: "heading" | "text") {
    pushHistory("block-child-add");
    setBlocks((current) => addChildBlock(current, parentId, kind));
    markDirty();
  }

  function removeChildBlock(childId: string) {
    pushHistory("block-child-remove");
    setBlocks((current) => removeBlock(current, childId));
    markDirty();
  }

  /** Bascule édition / aperçu : l'aperçu referme les outils d'édition. */
  function togglePreview() {
    if (!preview) {
      setEditingBlockId(null);
      setPropsOpen(false);
    }
    setPreview((current) => !current);
  }

  // Raccourcis d'historique du constructeur : Ctrl+Z / Ctrl+Maj+Z / Ctrl+Y.
  // Les champs de saisie gardent leurs raccourcis natifs.
  useEffect(() => {
    if (preview || mode !== "blocks" || !canEdit) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as Element | null;
      if (isTypingTarget(target) || isInsideModal(target)) return;
      if (!(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      if (key !== "z" && key !== "y") return;
      event.preventDefault();
      if (key === "y" || event.shiftKey) doRedo();
      else doUndo();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [preview, mode, canEdit, doUndo, doRedo]);

  const selectedBlock = findBlock(blocks, selectedBlockId ?? "");
  const selectedLabel = selectedBlock ? blockLabel(selectedBlock.kind) : "";
  const selectedPosition = selectedBlock ? blockPosition(blocks, selectedBlock.id) : null;
  const canMoveUp = selectedPosition !== null && selectedPosition.index > 0;
  const canMoveDown =
    selectedPosition !== null && selectedPosition.index < selectedPosition.count - 1;

  if (loading) {
    return (
      <div className="site-editor flex h-full min-h-0 flex-1 items-start justify-center p-8">
        <p aria-live="polite" className="animate-pulse text-sm text-muted-foreground">
          Chargement…
        </p>
      </div>
    );
  }

  return (
    <div className="site-editor flex h-full min-h-0 flex-1 flex-col">
      <header className="flex flex-wrap items-center gap-2 border-b border-border bg-card px-3 py-2">
        <a
          href="/"
          className="rounded-md px-1.5 py-1 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
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
          <Button size="sm" variant="outline" aria-pressed={preview} onClick={togglePreview}>
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
        <div className="px-3 pt-3">
          <Alert tone="danger">{error}</Alert>
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {panelOpen ? (
          <aside
            aria-label="Organisation du site"
            className="flex max-h-[45dvh] w-full shrink-0 flex-col border-b border-border bg-card lg:max-h-none lg:w-64 lg:border-b-0 lg:border-r"
          >
            <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-1.5">
              <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
                Organisation
              </p>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label="Fermer les panneaux"
                title="Fermer les panneaux"
                onClick={() => setPanelOpen(false)}
                className="-mr-1 size-7 justify-center p-0 text-muted-foreground"
              >
                <IconClose />
              </Button>
            </div>
            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-3">
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
            </div>
          </aside>
        ) : null}

        <section aria-label="Éditeur de la page" className="flex min-h-0 min-w-0 flex-1 flex-col">
          {!preview ? (
            <div
              role="toolbar"
              aria-label="Outils de la page"
              className="flex h-10 flex-nowrap items-center gap-0.5 overflow-x-auto border-b border-border bg-card px-2 [&>*]:shrink-0"
            >
              {mode === "blocks" ? (
                <>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label="Annuler"
                    title="Annuler (Ctrl+Z)"
                    disabled={!canEdit || !canUndo}
                    onClick={doUndo}
                  >
                    <IconUndo />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label="Rétablir"
                    title="Rétablir (Ctrl+Maj+Z)"
                    disabled={!canEdit || !canRedo}
                    onClick={doRedo}
                  >
                    <IconRedo />
                  </Button>
                  <span aria-hidden className="mx-1 h-4 w-px shrink-0 bg-border" />
                </>
              ) : null}

              <Button
                size="sm"
                variant="ghost"
                aria-pressed={panelOpen}
                aria-label={panelOpen ? "Masquer les panneaux" : "Afficher les panneaux"}
                title={panelOpen ? "Masquer les panneaux" : "Afficher les panneaux"}
                onClick={() => setPanelOpen((open) => !open)}
              >
                Panneaux
              </Button>
              <Button
                size="sm"
                variant="ghost"
                aria-label="Ajouter une page"
                title="Ajouter une page"
                disabled={!canEdit}
                onClick={() => setPageDialogOpen(true)}
              >
                <IconPlus className="size-3.5" />
                Page
              </Button>

              {mode === "blocks" ? (
                <>
                  <span aria-hidden className="mx-1 h-4 w-px shrink-0 bg-border" />
                  <BlockLibrary
                    canEdit={canEdit}
                    full={blocks.length >= BLOCKS_LIMITS.blocks}
                    onAdd={addBlock}
                  />
                  {selectedBlock ? (
                    <>
                      <span aria-hidden className="mx-1 h-4 w-px shrink-0 bg-border" />
                      <span className="px-1 text-xs text-muted-foreground">{selectedLabel}</span>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={!canEdit}
                        aria-label="Propriétés du bloc"
                        title="Propriétés du bloc"
                        onClick={() => setPropsOpen(true)}
                      >
                        Propriétés
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={!canEdit || !canMoveUp}
                        aria-label={`Monter le bloc ${selectedLabel}`}
                        title={`Monter le bloc ${selectedLabel}`}
                        onClick={() => moveBlockById(selectedBlock.id, "up")}
                      >
                        ↑
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={!canEdit || !canMoveDown}
                        aria-label={`Descendre le bloc ${selectedLabel}`}
                        title={`Descendre le bloc ${selectedLabel}`}
                        onClick={() => moveBlockById(selectedBlock.id, "down")}
                      >
                        ↓
                      </Button>
                      <Menu
                        label="Autres actions du bloc"
                        triggerIcon={<IconMore />}
                        triggerClassName="h-8 w-8 border-transparent bg-transparent px-0 hover:bg-muted focus-visible:ring-offset-0"
                        items={[
                          {
                            id: "delete",
                            label: `Supprimer le bloc ${selectedLabel}`,
                            destructive: true,
                            disabled: !canEdit,
                            onSelect: () => removeBlockById(selectedBlock.id),
                          },
                        ]}
                      />
                    </>
                  ) : null}
                </>
              ) : null}
            </div>
          ) : null}

          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            <div
              className={cn(
                "mx-auto flex w-full flex-col gap-3",
                preview ? "max-w-6xl" : "max-w-3xl",
              )}
            >
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
                blocks.length === 0 ? (
                  <BlocksEmptyState canEdit={canEdit} onAdd={addBlock} />
                ) : (
                  <BlocksCanvas
                    blocks={blocks}
                    selectedId={selectedBlockId}
                    editingId={editingBlockId}
                    canEdit={canEdit}
                    onSelect={setSelectedBlockId}
                    onStartEdit={startBlockEdit}
                    onTextChange={changeBlockText}
                    onEndEdit={editingReset}
                    onMove={moveBlockById}
                    onRemove={removeBlockById}
                  />
                )
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
            </div>
          </div>
        </section>
      </div>

      <Dialog
        open={propsOpen && selectedBlock !== null}
        onClose={() => setPropsOpen(false)}
        title="Propriétés du bloc"
        className="max-w-lg"
      >
        {selectedBlock ? (
          <BlockProperties
            block={selectedBlock}
            canEdit={canEdit}
            onPatch={patchBlockProp}
            onMoveChild={moveBlockById}
            onAddChild={(kind) => addChildToBlock(selectedBlock.id, kind)}
            onRemoveChild={removeChildBlock}
          />
        ) : null}
      </Dialog>

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
