import { Collaboration } from "@tiptap/extension-collaboration";
import { CollaborationCaret } from "@tiptap/extension-collaboration-caret";
import { Highlight } from "@tiptap/extension-highlight";
import { Image } from "@tiptap/extension-image";
import { TableKit } from "@tiptap/extension-table";
import { TextAlign } from "@tiptap/extension-text-align";
import { TextStyleKit } from "@tiptap/extension-text-style";
import { NodeSelection } from "@tiptap/pm/state";
import { type Editor, EditorContent, type JSONContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Alert, Button, cn, Dialog, Input, Label, LoadingState } from "@workspace/ui";
import { useCallback, useEffect, useRef, useState } from "react";
import { type CollabSession, createCollabSession } from "../collab-client.ts";
import {
  DOC_FONT_SIZES,
  DOC_HIGHLIGHTS,
  DOC_TEXT_COLORS,
  normalizeDocFontSize,
  PARAGRAPH_STYLES,
  type ParagraphStyleId,
} from "../doc-format.ts";
import { type DocumentStats, documentStats, formatStats } from "../document-stats.ts";
import { toPlainText } from "../export.ts";
import { PageBreak } from "../page-break.ts";
import { saveDocumentFn } from "../server.ts";
import { DocumentSearch } from "./document-search.tsx";
import { FORMAT_ACTIONS, type FormatActionId, matchFormatAction } from "./format-actions.ts";
import {
  AlignCenterIcon,
  AlignJustifyIcon,
  AlignLeftIcon,
  AlignRightIcon,
  FocusIcon,
  ImageIcon,
  LinkIcon,
  OutlineIcon,
  PageBreakIcon,
  SearchIcon,
  TableIcon,
} from "./icons.tsx";
import { OutlinePanel } from "./outline-panel.tsx";
import { SearchHighlight } from "./search-plugin.ts";
import { onToolbarArrowKeys, ToolbarButton, ToolbarSeparator } from "./toolbar.tsx";
import { useFocusMode } from "./use-focus-mode.ts";

type Props = {
  fileId: string;
  initialContent: unknown;
  canEdit: boolean;
  /** Révision connue au chargement (voir `getDocumentFn().revision`). */
  initialRevision?: string;
  /** Recharge le document côté hôte ; à défaut, la page est rechargée. */
  onReload?: () => void;
  /**
   * Collaboration temps réel (serveur Yjs) : absent ou `null`, l'éditeur est
   * strictement local — comportement historique inchangé.
   */
  collab?: { url: string; room: string; token: string; userName: string } | null;
};

type SaveStatus = "idle" | "saving" | "saved" | "error" | "conflict";
type SaveMode = "replace-latest" | "append";

const AUTOSAVE_DELAY_MS = 1200;

/** Fragment Yjs synchronisé (voir `Collaboration.configure({ field })`). */
const COLLAB_FIELD = "content";
/** Couleur du curseur distant (hexadécimal à 6 chiffres : seule forme acceptée). */
const COLLAB_CURSOR_COLOR = "#2f5d54";

/** Statistiques d'un document vide, avant tout calcul. */
const EMPTY_STATS: DocumentStats = {
  words: 0,
  characters: 0,
  charactersWithoutSpaces: 0,
  readingMinutes: 0,
};

/**
 * Applique une action de mise en forme — exactement la commande utilisée par la
 * barre d'outils : clavier et boutons ne peuvent pas diverger.
 */
function runFormatAction(editor: WorkspaceEditor, id: FormatActionId) {
  if (id === "bold") return editor.chain().focus().toggleBold().run();
  if (id === "italic") return editor.chain().focus().toggleItalic().run();
  return editor.chain().focus().toggleUnderline().run();
}

/** État actif d'une action de mise en forme sur la sélection courante. */
function isFormatActive(editor: WorkspaceEditor, id: FormatActionId): boolean {
  if (id === "bold") return editor.isActive("bold");
  if (id === "italic") return editor.isActive("italic");
  return editor.isActive("underline");
}

/** Classe commune des sélecteurs compacts de la barre d'outils. */
const TOOLBAR_SELECT_CLASS =
  "h-7 rounded-md border border-input bg-background px-1.5 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** Style de paragraphe actif sous le curseur (catalogue `doc-format.ts`). */
function activeParagraphStyle(editor: WorkspaceEditor): ParagraphStyleId {
  if (editor.isActive("heading", { level: 1 })) return "heading1";
  if (editor.isActive("heading", { level: 2 })) return "heading2";
  if (editor.isActive("heading", { level: 3 })) return "heading3";
  if (editor.isActive("blockquote")) return "blockquote";
  if (editor.isActive("codeBlock")) return "codeBlock";
  return "paragraph";
}

/** Applique un style de paragraphe à la sélection. */
function applyParagraphStyle(editor: WorkspaceEditor, id: ParagraphStyleId): void {
  const chain = editor.chain().focus();
  if (id === "heading1") chain.setHeading({ level: 1 }).run();
  else if (id === "heading2") chain.setHeading({ level: 2 }).run();
  else if (id === "heading3") chain.setHeading({ level: 3 }).run();
  else if (id === "blockquote") chain.setBlockquote().run();
  else if (id === "codeBlock") chain.setCodeBlock().run();
  else chain.setParagraph().run();
}

/** Taille de police active (taille du catalogue, ou `null` pour défaut). */
function activeFontSize(editor: WorkspaceEditor): string | null {
  return normalizeDocFontSize(editor.getAttributes("textStyle").fontSize);
}

/** Couleur de texte active : identifiant du catalogue, « default » sinon. */
function activeTextColor(editor: WorkspaceEditor): string {
  const value = editor.getAttributes("textStyle").color;
  const css = typeof value === "string" ? value : null;
  return (
    DOC_TEXT_COLORS.find((option) => option.css !== null && option.css === css)?.id ?? "default"
  );
}

/** Surlignage actif : identifiant du catalogue, « none » sinon. */
function activeHighlight(editor: WorkspaceEditor): string {
  const value = editor.getAttributes("highlight").color;
  const css = typeof value === "string" ? value : null;
  if (editor.isActive("highlight") && css === null) return "attention";
  return DOC_HIGHLIGHTS.find((option) => option.css !== null && option.css === css)?.id ?? "none";
}

/** Applique une couleur de texte du catalogue (ou la retire pour « default »). */
function applyTextColor(editor: WorkspaceEditor, id: string): void {
  const option = DOC_TEXT_COLORS.find((candidate) => candidate.id === id);
  if (!option) return;
  if (option.css === null) editor.chain().focus().unsetColor().run();
  else editor.chain().focus().setColor(option.css).run();
}

/** Applique un surlignage du catalogue (ou le retire pour « none »). */
function applyHighlight(editor: WorkspaceEditor, id: string): void {
  const option = DOC_HIGHLIGHTS.find((candidate) => candidate.id === id);
  if (!option) return;
  if (option.css === null) editor.chain().focus().unsetHighlight().run();
  else editor.chain().focus().setHighlight({ color: option.css }).run();
}

/** Applique une taille de police (chaîne vide = retour au défaut). */
function applyFontSize(editor: WorkspaceEditor, size: string): void {
  if (size === "") editor.chain().focus().unsetFontSize().run();
  else editor.chain().focus().setFontSize(`${size}px`).run();
}

/** URL d'image acceptée : http(s) uniquement, sans espace. */
function safeImageUrl(value: string): string | null {
  const trimmed = value.trim();
  return /^https?:\/\/\S+$/i.test(trimmed) ? trimmed : null;
}

/** URL de lien acceptée : http(s) ou mailto, sans espace. */
function safeLinkHref(value: string): string | null {
  const trimmed = value.trim();
  return /^(https?:\/\/|mailto:)\S+$/i.test(trimmed) ? trimmed : null;
}

/**
 * Vrai si la cible d'un raccourci est l'éditeur ou un champ de saisie : dans les
 * deux cas le raccourci est déjà appliqué par ProseMirror ou par le navigateur,
 * et le réappliquer annulerait la mise en forme au lieu de la poser.
 */
function isEditableArea(target: EventTarget | null, editor: WorkspaceEditor): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (editor.view.dom.contains(target)) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

/** Extrait le message d'une erreur, y compris sérialisée par le serveur. */
function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const record = error as { message?: unknown; data?: { message?: unknown } };
    if (typeof record.message === "string") return record.message;
    if (typeof record.data?.message === "string") return record.data.message;
  }
  return "";
}

/** Le service signale un conflit d'autosave par ce message. */
const isConflictError = (error: unknown): boolean =>
  errorMessage(error).includes("modifié ailleurs");

/**
 * Éditeur de documents (Tiptap 3 — ProseMirror).
 * - autosave continu (`replace-latest`) ;
 * - « Enregistrer une version » crée un instantané explicite (`append`) ;
 * - collaboration temps réel optionnelle (`collab`, serveur Yjs) — sans
 *   serveur configuré, le chemin reste strictement local.
 */
export function DocumentEditor(props: Props) {
  const collab = props.collab ?? null;
  if (!collab) return <EditorSurface {...props} />;
  return <CollabGate {...props} collab={collab} />;
}

type CollabGateProps = Props & { collab: NonNullable<Props["collab"]> };

/**
 * Ouvre la session de collaboration (une fois par salle et par jeton) et la
 * détruit au démontage, puis monte l'éditeur collaboratif. Si la session ne
 * peut pas être ouverte, repli silencieux sur l'éditeur local.
 */
function CollabGate({ collab, ...props }: CollabGateProps) {
  const [session, setSession] = useState<CollabSession | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    let created: CollabSession;
    try {
      created = createCollabSession({ url: collab.url, room: collab.room, token: collab.token });
    } catch {
      // Serveur injoignable au montage : repli local silencieux.
      setUnavailable(true);
      return;
    }
    setSession(created);
    return () => created.destroy();
  }, [collab.url, collab.room, collab.token]);

  if (!session && !unavailable) {
    return <LoadingState className="py-6" label="Chargement de l'éditeur…" />;
  }

  return <EditorSurface {...props} session={session} />;
}

type SurfaceProps = Props & {
  /** Session de collaboration active ; `null` ou absent = éditeur local. */
  session?: CollabSession | null;
};

/** Instance Tiptap telle que la consomment les commandes de mise en forme. */
type WorkspaceEditor = Editor;

/** Cœur de l'éditeur : autosave, conflits, et collaboration quand fournie. */
function EditorSurface({
  fileId,
  initialContent,
  canEdit,
  initialRevision,
  onReload,
  collab,
  session = null,
}: SurfaceProps) {
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [dirty, setDirty] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savingRef = useRef(false);
  const queuedRef = useRef<{ content: unknown; mode: SaveMode } | null>(null);
  const dirtyRef = useRef(false);
  const latestRef = useRef<unknown>(null);
  /** Panneau « Plan » (titres du document) : ouvert ou fermé. */
  const [outlineOpen, setOutlineOpen] = useState(false);
  /** Barre de recherche du document : ouverte ou fermée. */
  const [searchOpen, setSearchOpen] = useState(false);
  /** Zone de défilement du document : repère de la position courante dans le plan. */
  const scrollRef = useRef<HTMLDivElement>(null);
  /** Dernière révision connue (chargement ou réponse de sauvegarde). */
  const revisionRef = useRef<string | undefined>(initialRevision);
  /** Après un conflit, on n'écrase plus rien : rechargez la page. */
  const conflictRef = useRef(false);
  /** Mode focus : masque l'interface autour de la page, préférence mémorisée. */
  const { active: focusActive, toggle: toggleFocus, exit: exitFocus } = useFocusMode();
  /** Statistiques du document (mots, caractères, temps de lecture). */
  const [stats, setStats] = useState<DocumentStats>(EMPTY_STATS);
  /** Zoom d'affichage de la page (View > Zoom, comme un traitement de texte). */
  const [zoom, setZoom] = useState(100);
  /** Dialogue « Insérer un tableau » et ses dimensions. */
  const [tableOpen, setTableOpen] = useState(false);
  const [tableRows, setTableRows] = useState(3);
  const [tableCols, setTableCols] = useState(3);
  /** Dialogue « Insérer une image » (URL https + texte alternatif). */
  const [imageOpen, setImageOpen] = useState(false);
  const [imageUrl, setImageUrl] = useState("");
  const [imageAlt, setImageAlt] = useState("");
  const [imageError, setImageError] = useState<string | null>(null);
  /** Dialogue « Insérer un lien ». */
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [linkError, setLinkError] = useState<string | null>(null);

  /** Étiquette du curseur distant — purement cosmétique. */
  const collabUserName = collab?.userName ?? "Vous";

  /**
   * Enregistre `content`. Si un enregistrement est déjà en vol, le contenu le
   * plus récent est mis en file d'attente et sauvegardé à la fin du vol.
   * Le drapeau « sale » n'est effacé que lorsque la file est vide, pour que la
   * fermeture de l'onglet avertisse tant qu'il reste des modifications.
   */
  const persist = useCallback(
    async (content: unknown, mode: SaveMode) => {
      // Un conflit n'est jamais réessayé automatiquement : l'utilisateur doit
      // recharger pour repartir de la version la plus récente.
      if (conflictRef.current) return;

      if (savingRef.current) {
        const pending = queuedRef.current;
        queuedRef.current = {
          content,
          mode: mode === "append" || pending?.mode === "append" ? "append" : mode,
        };
        return;
      }

      savingRef.current = true;
      let current: { content: unknown; mode: SaveMode } | null = { content, mode };
      try {
        while (current) {
          setStatus("saving");
          try {
            const saved = await saveDocumentFn({
              data: {
                fileId,
                content: current.content,
                mode: current.mode,
                baseUpdatedAt: revisionRef.current,
              },
            });
            revisionRef.current = saved.updatedAt;
            if (queuedRef.current === null) {
              dirtyRef.current = false;
              setDirty(false);
            }
            setStatus("saved");
            setLastSavedAt(
              new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }),
            );
          } catch (error) {
            if (isConflictError(error)) {
              conflictRef.current = true;
              queuedRef.current = null;
              setStatus("conflict");
              break;
            }
            setStatus("error");
          }
          const queued = queuedRef.current;
          queuedRef.current = null;
          current = queued
            ? {
                content: queued.content,
                mode:
                  current.mode === "append" || queued.mode === "append" ? "append" : queued.mode,
              }
            : null;
        }
      } finally {
        savingRef.current = false;
      }
    },
    [fileId],
  );

  const editor = useEditor({
    extensions: [
      // La collaboration gère son propre historique : celui de StarterKit est
      // désactivé pour éviter deux gestionnaires concurrents.
      ...(session
        ? [
            StarterKit.configure({ undoRedo: false }),
            Collaboration.configure({ document: session.doc, field: COLLAB_FIELD }),
            CollaborationCaret.configure({
              provider: session.provider,
              user: { name: collabUserName, color: COLLAB_CURSOR_COLOR },
            }),
          ]
        : [StarterKit]),
      // Mise en forme avancée, commune aux deux modes : couleurs et tailles
      // (marque TextStyle), surlignage multicolore, alignement des paragraphes
      // et des titres, tableaux, images https et saut de page.
      TextStyleKit.configure({ backgroundColor: false, fontFamily: false, lineHeight: false }),
      Highlight.configure({ multicolor: true }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      TableKit.configure({ table: { resizable: false } }),
      Image.configure({ allowBase64: false }),
      PageBreak,
      // Recherche : décorations de vue seulement, sans effet sur le document.
      SearchHighlight,
    ],
    // En collaboration, Yjs fait foi : ne jamais injecter `content` d'emblée
    // (il serait fusionné à la salle), l'amorçage se fait après `sync`.
    content: session ? undefined : (initialContent as JSONContent),
    editable: canEdit,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: "workspace-editor focus:outline-none",
        "aria-label": "Contenu du document",
      },
    },
    onUpdate: ({ editor: instance }) => {
      if (!canEdit || conflictRef.current) return;
      const content = instance.getJSON();
      latestRef.current = content;
      dirtyRef.current = true;
      setDirty(true);
      setStatus((current) => (current === "saved" || current === "error" ? "idle" : current));
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        timer.current = null;
        void persist(content, "replace-latest");
      }, AUTOSAVE_DELAY_MS);
    },
  });

  // Amorçage : le premier client d'une salle vide promeut le contenu durable en
  // base partagée. Jamais en lecture seule (le serveur refuserait l'écriture).
  useEffect(() => {
    if (!session || !editor || !canEdit) return;
    if (initialContent === null || initialContent === undefined) return;

    const fragment = session.doc.getXmlFragment(COLLAB_FIELD);
    const seedIfEmpty = () => {
      if (fragment.length > 0) return;
      editor.commands.setContent(initialContent as JSONContent);
    };

    // La synchronisation a pu aboutir avant même la pose de l'écouteur.
    if (session.provider.synced) seedIfEmpty();
    session.provider.on("sync", seedIfEmpty);
    return () => session.provider.off("sync", seedIfEmpty);
  }, [session, editor, canEdit, initialContent]);

  // Raccourcis de mise en forme (Ctrl/⌘ + B, I, U) en dehors de la zone
  // d'édition — panneau « Plan », boutons de la barre d'outils.
  useEffect(() => {
    if (!editor || !canEdit) return;
    const active = editor;

    function onKeyDown(event: KeyboardEvent) {
      const action = matchFormatAction(event);
      if (!action) return;
      // Déjà consommé : ne jamais basculer deux fois la même marque.
      if (event.defaultPrevented) return;
      if (isEditableArea(event.target, active)) return;
      event.preventDefault();
      void runFormatAction(active, action.id);
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [editor, canEdit]);

  // Ctrl/⌘ + F ouvre la recherche du document — la recherche du navigateur
  // n'a pas accès au texte d'un éditeur riche.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && (event.key === "f" || event.key === "F")) {
        event.preventDefault();
        setSearchOpen(true);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Échap : la recherche d'abord, puis le mode focus. Sortie progressive, dans
  // l'ordre inverse de ce que l'utilisateur a ouvert.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (searchOpen) {
        setSearchOpen(false);
        return;
      }
      if (focusActive) exitFocus();
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [searchOpen, focusActive, exitFocus]);

  // Fermeture de l'onglet : avertissement tant que des modifications ne sont pas enregistrées.
  useEffect(() => {
    function onBeforeUnload(event: BeforeUnloadEvent) {
      if (!dirtyRef.current) return;
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  // Démontage : vide le minuteur en attente et sauvegarde une dernière fois, au mieux.
  useEffect(() => {
    return () => {
      const hadPendingTimer = timer.current !== null;
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
      }
      if (!dirtyRef.current && !hadPendingTimer) return;
      const content = latestRef.current;
      if (content === null) return;
      void persist(content, "replace-latest").catch(() => undefined);
    };
  }, [persist]);

  // Statistiques : recalculées aux seuls changements de document (frappe,
  // collaborateur). `update` ne part pas sur un simple déplacement de curseur,
  // et `useEditor` re-rendit à chaque transaction : hors de ce garde-fou, on
  // ressortirait tout le document à chaque mouvement de sélection.
  useEffect(() => {
    if (!editor) return;
    const sync = () => setStats(documentStats(toPlainText(editor.getJSON())));
    sync();
    editor.on("update", sync);
    return () => {
      editor.off("update", sync);
    };
  }, [editor]);

  if (!editor) {
    return <LoadingState className="py-6" label="Chargement de l'éditeur…" />;
  }

  const statusLabel =
    status === "saving"
      ? "Enregistrement…"
      : status === "saved"
        ? `Enregistré${lastSavedAt ? ` à ${lastSavedAt}` : ""}`
        : status === "conflict"
          ? "Modifié ailleurs"
          : status === "error"
            ? "Échec de l'enregistrement"
            : canEdit
              ? dirty
                ? "Modifications non enregistrées"
                : "Aucune modification"
              : "Lecture seule";

  return (
    <div className="flex min-h-0 flex-1 flex-row">
      {outlineOpen ? (
        <OutlinePanel
          editor={editor}
          scrollElement={scrollRef.current}
          canEdit={canEdit}
          onClose={() => setOutlineOpen(false)}
        />
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col">
        <div
          role="toolbar"
          aria-label="Mise en forme du document"
          onKeyDown={onToolbarArrowKeys}
          className="flex flex-wrap items-center gap-1 border-b border-border px-3 py-2"
        >
          <ToolbarButton
            label="Plan"
            pressed={outlineOpen}
            onClick={() => setOutlineOpen((current) => !current)}
          >
            <OutlineIcon />
          </ToolbarButton>
          <ToolbarButton
            label="Rechercher"
            shortcutKey="f"
            pressed={searchOpen}
            onClick={() => setSearchOpen((current) => !current)}
          >
            <SearchIcon />
          </ToolbarButton>
          <ToolbarButton label="Mode focus" pressed={focusActive} onClick={toggleFocus}>
            <FocusIcon />
          </ToolbarButton>

          <ToolbarSeparator />

          <ToolbarButton
            label="Annuler"
            disabled={!canEdit || !editor.can().undo()}
            onClick={() => editor.chain().focus().undo().run()}
          >
            ↺
          </ToolbarButton>
          <ToolbarButton
            label="Rétablir"
            disabled={!canEdit || !editor.can().redo()}
            onClick={() => editor.chain().focus().redo().run()}
          >
            ↻
          </ToolbarButton>

          <ToolbarSeparator />

          {/* Styles de paragraphe et taille de police — deux sélecteurs
              compacts, comme dans un traitement de texte. */}
          <select
            aria-label="Style de paragraphe"
            value={activeParagraphStyle(editor)}
            disabled={!canEdit}
            onChange={(event) =>
              applyParagraphStyle(editor, event.target.value as ParagraphStyleId)
            }
            className={TOOLBAR_SELECT_CLASS}
          >
            {PARAGRAPH_STYLES.map((style) => (
              <option key={style.id} value={style.id}>
                {style.label}
              </option>
            ))}
          </select>
          <select
            aria-label="Taille de police"
            value={activeFontSize(editor) ?? ""}
            disabled={!canEdit}
            onChange={(event) => applyFontSize(editor, event.target.value)}
            className={TOOLBAR_SELECT_CLASS}
          >
            <option value="">Taille</option>
            {DOC_FONT_SIZES.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>

          <ToolbarSeparator />

          {/* Mise en forme : libellés, glyphes et raccourcis viennent du
              catalogue — les mêmes commandes tournent au clavier. */}
          {FORMAT_ACTIONS.map((action) => (
            <ToolbarButton
              key={action.id}
              label={action.label}
              shortcutKey={action.shortcutKey}
              pressed={isFormatActive(editor, action.id)}
              disabled={!canEdit}
              onClick={() => runFormatAction(editor, action.id)}
            >
              <span className={action.glyphClassName}>{action.glyph}</span>
            </ToolbarButton>
          ))}

          <ToolbarSeparator />

          <ToolbarButton
            label="Barré"
            pressed={editor.isActive("strike")}
            disabled={!canEdit}
            onClick={() => editor.chain().focus().toggleStrike().run()}
          >
            <span className="line-through">S</span>
          </ToolbarButton>
          <ToolbarButton
            label="Code en ligne"
            pressed={editor.isActive("code")}
            disabled={!canEdit}
            onClick={() => editor.chain().focus().toggleCode().run()}
          >
            {"</>"}
          </ToolbarButton>

          <ToolbarSeparator />

          <select
            aria-label="Couleur du texte"
            value={activeTextColor(editor)}
            disabled={!canEdit}
            onChange={(event) => applyTextColor(editor, event.target.value)}
            className={TOOLBAR_SELECT_CLASS}
          >
            {DOC_TEXT_COLORS.map((color) => (
              <option key={color.id} value={color.id}>
                {color.label}
              </option>
            ))}
          </select>
          <select
            aria-label="Surlignage"
            value={activeHighlight(editor)}
            disabled={!canEdit}
            onChange={(event) => applyHighlight(editor, event.target.value)}
            className={TOOLBAR_SELECT_CLASS}
          >
            {DOC_HIGHLIGHTS.map((highlight) => (
              <option key={highlight.id} value={highlight.id}>
                {highlight.label}
              </option>
            ))}
          </select>

          <ToolbarSeparator />

          <ToolbarButton
            label="Liste à puces"
            pressed={editor.isActive("bulletList")}
            disabled={!canEdit}
            onClick={() => editor.chain().focus().toggleBulletList().run()}
          >
            •
          </ToolbarButton>
          <ToolbarButton
            label="Liste numérotée"
            pressed={editor.isActive("orderedList")}
            disabled={!canEdit}
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
          >
            1.
          </ToolbarButton>

          <ToolbarSeparator />

          <ToolbarButton
            label="Aligner à gauche"
            pressed={editor.isActive({ textAlign: "left" })}
            disabled={!canEdit}
            onClick={() => editor.chain().focus().setTextAlign("left").run()}
          >
            <AlignLeftIcon />
          </ToolbarButton>
          <ToolbarButton
            label="Centrer"
            pressed={editor.isActive({ textAlign: "center" })}
            disabled={!canEdit}
            onClick={() => editor.chain().focus().setTextAlign("center").run()}
          >
            <AlignCenterIcon />
          </ToolbarButton>
          <ToolbarButton
            label="Aligner à droite"
            pressed={editor.isActive({ textAlign: "right" })}
            disabled={!canEdit}
            onClick={() => editor.chain().focus().setTextAlign("right").run()}
          >
            <AlignRightIcon />
          </ToolbarButton>
          <ToolbarButton
            label="Justifier"
            pressed={editor.isActive({ textAlign: "justify" })}
            disabled={!canEdit}
            onClick={() => editor.chain().focus().setTextAlign("justify").run()}
          >
            <AlignJustifyIcon />
          </ToolbarButton>

          <ToolbarSeparator />

          <ToolbarButton
            label="Insérer un tableau"
            disabled={!canEdit}
            onClick={() => setTableOpen(true)}
          >
            <TableIcon />
          </ToolbarButton>
          <ToolbarButton
            label="Insérer une image"
            disabled={!canEdit}
            onClick={() => {
              setImageUrl("");
              setImageAlt("");
              setImageError(null);
              setImageOpen(true);
            }}
          >
            <ImageIcon />
          </ToolbarButton>
          <ToolbarButton
            label="Insérer un lien"
            shortcutKey="k"
            disabled={!canEdit}
            onClick={() => {
              const current = editor.getAttributes("link").href;
              setLinkUrl(typeof current === "string" ? current : "");
              setLinkError(null);
              setLinkOpen(true);
            }}
          >
            <LinkIcon />
          </ToolbarButton>
          <ToolbarButton
            label="Séparateur"
            disabled={!canEdit}
            onClick={() => editor.chain().focus().setHorizontalRule().run()}
          >
            ―
          </ToolbarButton>
          <ToolbarButton
            label="Saut de page"
            disabled={!canEdit}
            onClick={() => {
              const { selection } = editor.state;
              // Un nœud sélectionné (par exemple un saut précédent) serait
              // remplacé par la nouvelle insertion : le saut s'ajoute alors
              // juste après lui, jamais à sa place.
              if (selection instanceof NodeSelection) {
                editor.chain().focus().insertContentAt(selection.to, { type: "pageBreak" }).run();
              } else {
                editor.chain().focus().insertContent({ type: "pageBreak" }).run();
              }
            }}
          >
            <PageBreakIcon />
          </ToolbarButton>

          <div className="ml-auto flex items-center gap-2">
            {session ? (
              <span role="status" className="text-xs text-muted-foreground">
                Collaboration active
              </span>
            ) : null}
            <span
              className={cn(
                "text-xs text-muted-foreground",
                (status === "error" || status === "conflict") && "text-destructive",
              )}
              role="status"
            >
              {statusLabel}
            </span>
            {status === "error" && canEdit ? (
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-2 text-xs"
                onClick={() => void persist(editor.getJSON(), "replace-latest")}
              >
                Réessayer
              </Button>
            ) : null}
            {canEdit ? (
              <Button
                size="sm"
                variant="outline"
                disabled={status === "conflict"}
                onClick={() => void persist(editor.getJSON(), "append")}
              >
                Enregistrer une version
              </Button>
            ) : null}
          </div>
        </div>

        {/* Outils du tableau : visibles seulement quand le curseur est dans
            un tableau, comme la barre contextuelle d'un traitement de texte. */}
        {editor.isActive("table") ? (
          <div
            role="toolbar"
            aria-label="Outils du tableau"
            onKeyDown={onToolbarArrowKeys}
            className="flex flex-wrap items-center gap-1 border-b border-border px-3 py-1.5"
          >
            <span className="pr-1 text-xs font-medium text-muted-foreground">Tableau</span>
            <ToolbarButton
              label="Ajouter une ligne"
              disabled={!canEdit}
              onClick={() => editor.chain().focus().addRowAfter().run()}
            >
              + ligne
            </ToolbarButton>
            <ToolbarButton
              label="Supprimer la ligne"
              disabled={!canEdit}
              onClick={() => editor.chain().focus().deleteRow().run()}
            >
              − ligne
            </ToolbarButton>
            <ToolbarButton
              label="Ajouter une colonne"
              disabled={!canEdit}
              onClick={() => editor.chain().focus().addColumnAfter().run()}
            >
              + colonne
            </ToolbarButton>
            <ToolbarButton
              label="Supprimer la colonne"
              disabled={!canEdit}
              onClick={() => editor.chain().focus().deleteColumn().run()}
            >
              − colonne
            </ToolbarButton>
            <ToolbarButton
              label="Fusionner ou scinder les cellules"
              disabled={!canEdit}
              onClick={() => editor.chain().focus().mergeOrSplit().run()}
            >
              Fusionner
            </ToolbarButton>
            <ToolbarButton
              label="Supprimer le tableau"
              disabled={!canEdit}
              onClick={() => editor.chain().focus().deleteTable().run()}
            >
              Supprimer
            </ToolbarButton>
          </div>
        ) : null}

        <DocumentSearch editor={editor} open={searchOpen} onOpenChange={setSearchOpen} />

        {status === "conflict" ? (
          <div className="border-b border-border px-3 py-2">
            <Alert
              tone="warning"
              className="flex flex-wrap items-center gap-x-3 gap-y-2 py-1.5 text-xs"
            >
              <span className="flex-1">
                Le document a été modifié ailleurs ; votre contenu reste affiché. Rechargez la page
                pour repartir de la version la plus récente.
              </span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-6 px-2 text-xs"
                onClick={() => (onReload ? onReload() : window.location.reload())}
              >
                Recharger la page
              </Button>
            </Alert>
          </div>
        ) : null}

        <div ref={scrollRef} className="workspace-editor-scroll min-h-0 flex-1 overflow-y-auto">
          <div
            className="workspace-editor-page mx-auto w-full max-w-3xl px-6 py-8"
            style={{ zoom: zoom / 100 }}
          >
            <EditorContent editor={editor} />
          </div>
        </div>

        {/* Statistiques : information d'ambiance, délibérément hors région
            live — un `aria-live` ici annoncerait le compteur à chaque mot
            frappé. Le compteur qui demande une annonce est celui de la
            recherche, qui ne change que sur action explicite. */}
        <div className="print-hide flex items-center justify-between gap-3 border-t border-border px-3 py-1.5">
          <p className="text-xs text-muted-foreground">{formatStats(stats)}</p>
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span>Zoom</span>
            <select
              aria-label="Zoom"
              value={zoom}
              onChange={(event) => setZoom(Number(event.target.value))}
              className="h-6 rounded-md border border-input bg-background px-1 text-xs"
            >
              {[75, 100, 125, 150].map((value) => (
                <option key={value} value={value}>
                  {value} %
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {/* Insertion : tableau, image et lien — trois dialogues simples, comme
          les boîtes d'insertion d'un traitement de texte. */}
      <Dialog open={tableOpen} onClose={() => setTableOpen(false)} title="Insérer un tableau">
        <div className="flex flex-col gap-4">
          <div className="flex gap-3">
            <div className="flex flex-1 flex-col gap-1">
              <Label htmlFor="table-rows">Lignes</Label>
              <Input
                id="table-rows"
                type="number"
                min={1}
                max={20}
                value={tableRows}
                onChange={(event) =>
                  setTableRows(Math.min(20, Math.max(1, Number(event.target.value) || 1)))
                }
                className="h-8"
              />
            </div>
            <div className="flex flex-1 flex-col gap-1">
              <Label htmlFor="table-cols">Colonnes</Label>
              <Input
                id="table-cols"
                type="number"
                min={1}
                max={10}
                value={tableCols}
                onChange={(event) =>
                  setTableCols(Math.min(10, Math.max(1, Number(event.target.value) || 1)))
                }
                className="h-8"
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            La première ligne est une ligne d'en-tête.
          </p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setTableOpen(false)}>
              Annuler
            </Button>
            <Button
              type="button"
              onClick={() => {
                editor
                  .chain()
                  .focus()
                  .insertTable({ rows: tableRows, cols: tableCols, withHeaderRow: true })
                  .run();
                setTableOpen(false);
              }}
            >
              Insérer
            </Button>
          </div>
        </div>
      </Dialog>

      <Dialog open={imageOpen} onClose={() => setImageOpen(false)} title="Insérer une image">
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="image-url">Adresse de l'image</Label>
            <Input
              id="image-url"
              value={imageUrl}
              onChange={(event) => setImageUrl(event.target.value)}
              placeholder="https://…"
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="image-alt">Texte alternatif</Label>
            <Input
              id="image-alt"
              value={imageAlt}
              onChange={(event) => setImageAlt(event.target.value)}
              placeholder="Décrit l'image pour les lecteurs d'écran"
            />
          </div>
          {imageError ? (
            <p role="alert" className="text-xs text-destructive">
              {imageError}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setImageOpen(false)}>
              Annuler
            </Button>
            <Button
              type="button"
              onClick={() => {
                const src = safeImageUrl(imageUrl);
                if (!src) {
                  setImageError("Adresse invalide : une URL https est attendue.");
                  return;
                }
                editor.chain().focus().setImage({ src, alt: imageAlt.trim() }).run();
                setImageOpen(false);
              }}
            >
              Insérer
            </Button>
          </div>
        </div>
      </Dialog>

      <Dialog open={linkOpen} onClose={() => setLinkOpen(false)} title="Insérer un lien">
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="link-url">Adresse du lien</Label>
            <Input
              id="link-url"
              value={linkUrl}
              onChange={(event) => setLinkUrl(event.target.value)}
              placeholder="https://…"
            />
          </div>
          {linkError ? (
            <p role="alert" className="text-xs text-destructive">
              {linkError}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            {editor.isActive("link") ? (
              <Button
                type="button"
                variant="ghost"
                className="text-destructive"
                onClick={() => {
                  editor.chain().focus().unsetLink().run();
                  setLinkOpen(false);
                }}
              >
                Retirer le lien
              </Button>
            ) : null}
            <Button type="button" variant="ghost" onClick={() => setLinkOpen(false)}>
              Annuler
            </Button>
            <Button
              type="button"
              onClick={() => {
                const href = safeLinkHref(linkUrl);
                if (!href) {
                  setLinkError("Adresse invalide : https ou mailto attendu.");
                  return;
                }
                if (editor.state.selection.empty) {
                  editor
                    .chain()
                    .focus()
                    .insertContent({
                      type: "text",
                      text: href,
                      marks: [{ type: "link", attrs: { href } }],
                    })
                    .run();
                } else {
                  editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
                }
                setLinkOpen(false);
              }}
            >
              Appliquer
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
