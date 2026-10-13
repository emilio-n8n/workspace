import { Collaboration } from "@tiptap/extension-collaboration";
import { CollaborationCaret } from "@tiptap/extension-collaboration-caret";
import { type Editor, EditorContent, type JSONContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Alert, Button, cn } from "@workspace/ui";
import { useCallback, useEffect, useRef, useState } from "react";
import { type CollabSession, createCollabSession } from "../collab-client.ts";
import { saveDocumentFn } from "../server.ts";
import { FORMAT_ACTIONS, type FormatActionId, matchFormatAction } from "./format-actions.ts";
import { OutlineIcon } from "./icons.tsx";
import { OutlinePanel } from "./outline-panel.tsx";
import { onToolbarArrowKeys, ToolbarButton, ToolbarSeparator } from "./toolbar.tsx";

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
    return <p className="px-6 py-8 text-sm text-muted-foreground">Chargement de l'éditeur…</p>;
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
  /** Zone de défilement du document : repère de la position courante dans le plan. */
  const scrollRef = useRef<HTMLDivElement>(null);
  /** Dernière révision connue (chargement ou réponse de sauvegarde). */
  const revisionRef = useRef<string | undefined>(initialRevision);
  /** Après un conflit, on n'écrase plus rien : rechargez la page. */
  const conflictRef = useRef(false);

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
    extensions: session
      ? [
          // La collaboration gère son propre historique : celui de StarterKit
          // est désactivé pour éviter deux gestionnaires concurrents.
          StarterKit.configure({ undoRedo: false }),
          Collaboration.configure({ document: session.doc, field: COLLAB_FIELD }),
          CollaborationCaret.configure({
            provider: session.provider,
            user: { name: collabUserName, color: COLLAB_CURSOR_COLOR },
          }),
        ]
      : [StarterKit],
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

  if (!editor) {
    return <p className="px-6 py-8 text-sm text-muted-foreground">Chargement de l'éditeur…</p>;
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

          {[1, 2, 3].map((level) => (
            <ToolbarButton
              key={level}
              label={`Titre ${level}`}
              pressed={editor.isActive("heading", { level })}
              disabled={!canEdit}
              onClick={() =>
                editor
                  .chain()
                  .focus()
                  .toggleHeading({ level: level as 1 | 2 | 3 })
                  .run()
              }
            >
              H{level}
            </ToolbarButton>
          ))}

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
          <ToolbarButton
            label="Citation"
            pressed={editor.isActive("blockquote")}
            disabled={!canEdit}
            onClick={() => editor.chain().focus().toggleBlockquote().run()}
          >
            ❝
          </ToolbarButton>
          <ToolbarButton
            label="Bloc de code"
            pressed={editor.isActive("codeBlock")}
            disabled={!canEdit}
            onClick={() => editor.chain().focus().toggleCodeBlock().run()}
          >
            {"{ }"}
          </ToolbarButton>
          <ToolbarButton
            label="Séparateur"
            disabled={!canEdit}
            onClick={() => editor.chain().focus().setHorizontalRule().run()}
          >
            ―
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

        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-3xl px-6 py-8">
            <EditorContent editor={editor} />
          </div>
        </div>
      </div>
    </div>
  );
}
