import { EditorContent, type JSONContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Button, cn } from "@workspace/ui";
import { useCallback, useEffect, useRef, useState } from "react";
import { saveDocumentFn } from "../server.ts";

type Props = {
  fileId: string;
  initialContent: unknown;
  canEdit: boolean;
};

type SaveStatus = "idle" | "saving" | "saved" | "error";

const AUTOSAVE_DELAY_MS = 1200;

/**
 * Éditeur de documents (Tiptap 3 — ProseMirror).
 * - autosave continu (`replace-latest`) ;
 * - « Enregistrer une version » crée un instantané explicite (`append`).
 */
export function DocumentEditor({ fileId, initialContent, canEdit }: Props) {
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savingRef = useRef(false);

  const persist = useCallback(
    async (content: unknown, mode: "replace-latest" | "append") => {
      if (savingRef.current) return;
      savingRef.current = true;
      setStatus("saving");
      try {
        await saveDocumentFn({ data: { fileId, content, mode } });
        setStatus("saved");
        setLastSavedAt(
          new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }),
        );
      } catch {
        setStatus("error");
      } finally {
        savingRef.current = false;
      }
    },
    [fileId],
  );

  const editor = useEditor({
    extensions: [StarterKit],
    content: initialContent as JSONContent,
    editable: canEdit,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: "workspace-editor focus:outline-none",
        "aria-label": "Contenu du document",
      },
    },
    onUpdate: ({ editor: instance }) => {
      if (!canEdit) return;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        void persist(instance.getJSON(), "replace-latest");
      }, AUTOSAVE_DELAY_MS);
    },
  });

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  if (!editor) {
    return <p className="px-6 py-8 text-sm text-muted-foreground">Chargement de l'éditeur…</p>;
  }

  const statusLabel =
    status === "saving"
      ? "Enregistrement…"
      : status === "saved"
        ? `Enregistré${lastSavedAt ? ` à ${lastSavedAt}` : ""}`
        : status === "error"
          ? "Échec de l'enregistrement — nouvelle tentative à la prochaine saisie"
          : canEdit
            ? "Aucune modification"
            : "Lecture seule";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-1 border-b border-border px-3 py-2">
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

        <Separator />

        {[1, 2, 3].map((level) => (
          <ToolbarButton
            key={level}
            label={`Titre ${level}`}
            active={editor.isActive("heading", { level })}
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

        <Separator />

        <ToolbarButton
          label="Gras"
          active={editor.isActive("bold")}
          disabled={!canEdit}
          onClick={() => editor.chain().focus().toggleBold().run()}
        >
          <span className="font-bold">B</span>
        </ToolbarButton>
        <ToolbarButton
          label="Italique"
          active={editor.isActive("italic")}
          disabled={!canEdit}
          onClick={() => editor.chain().focus().toggleItalic().run()}
        >
          <span className="italic">I</span>
        </ToolbarButton>
        <ToolbarButton
          label="Barré"
          active={editor.isActive("strike")}
          disabled={!canEdit}
          onClick={() => editor.chain().focus().toggleStrike().run()}
        >
          <span className="line-through">S</span>
        </ToolbarButton>
        <ToolbarButton
          label="Code en ligne"
          active={editor.isActive("code")}
          disabled={!canEdit}
          onClick={() => editor.chain().focus().toggleCode().run()}
        >
          {"</>"}
        </ToolbarButton>

        <Separator />

        <ToolbarButton
          label="Liste à puces"
          active={editor.isActive("bulletList")}
          disabled={!canEdit}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
        >
          •
        </ToolbarButton>
        <ToolbarButton
          label="Liste numérotée"
          active={editor.isActive("orderedList")}
          disabled={!canEdit}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
        >
          1.
        </ToolbarButton>
        <ToolbarButton
          label="Citation"
          active={editor.isActive("blockquote")}
          disabled={!canEdit}
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
        >
          ❝
        </ToolbarButton>
        <ToolbarButton
          label="Bloc de code"
          active={editor.isActive("codeBlock")}
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
          <span
            className={cn(
              "text-xs text-muted-foreground",
              status === "error" && "text-destructive",
            )}
            role="status"
          >
            {statusLabel}
          </span>
          {canEdit ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => void persist(editor.getJSON(), "append")}
            >
              Enregistrer une version
            </Button>
          ) : null}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-6 py-8">
          <EditorContent editor={editor} />
        </div>
      </div>
    </div>
  );
}

function Separator() {
  return <span aria-hidden className="mx-1 h-5 w-px bg-border" />;
}

function ToolbarButton({
  label,
  active = false,
  disabled = false,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className={cn("min-w-8 px-2", active && "bg-accent text-accent-foreground")}
      aria-label={label}
      aria-pressed={active}
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}
