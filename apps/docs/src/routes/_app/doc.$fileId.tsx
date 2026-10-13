import { createFileRoute, Link } from "@tanstack/react-router";
import type { CommentView } from "@workspace/docs";
import {
  addCommentFn,
  deleteCommentFn,
  getCollabTokenFn,
  getDocumentFn,
  listCommentsFn,
  listDocumentVersionsFn,
  renameDocumentFn,
  resolveCommentFn,
} from "@workspace/docs/server";
import { DocumentEditor } from "@workspace/docs/ui";
import {
  Alert,
  Badge,
  Button,
  ConfirmDialog,
  cn,
  EmptyState,
  IconChat,
  IconClose,
  IconFileText,
  Input,
} from "@workspace/ui";
import { type FormEvent, useEffect, useState } from "react";

export const Route = createFileRoute("/_app/doc/$fileId")({ component: DocumentPage });

type Loaded = {
  fileId: string;
  title: string;
  content: unknown;
  currentVersion: number;
  updatedAt: string;
  canEdit: boolean;
  canComment: boolean;
  viewerId: string;
  isOwner: boolean;
  revision: string;
};

/** Temps relatif court (« il y a 5 min ») pour la liste des commentaires. */
function formatRelativeTime(iso: string): string {
  const elapsedMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(elapsedMs / 60_000);
  if (minutes < 1) return "à l'instant";
  if (minutes < 60) return `il y a ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `il y a ${hours} h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `il y a ${days} j`;
  return new Date(iso).toLocaleDateString("fr-FR", { dateStyle: "short" });
}

function DocumentPage() {
  const { fileId } = Route.useParams();
  const [doc, setDoc] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [savingTitle, setSavingTitle] = useState(false);
  const [versions, setVersions] = useState<
    { id: string; version: number; createdAt: string }[] | null
  >(null);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [versionsError, setVersionsError] = useState<string | null>(null);
  /**
   * Collaboration temps réel : `null` = aucune session (serveur non configuré,
   * jeton refusé, réseau…). Résolu une seule fois au chargement, puis statique.
   */
  const [collab, setCollab] = useState<{ url: string; token: string } | null>(null);

  // Panneau « Commentaires » : fils, résolution, suppression.
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [comments, setComments] = useState<CommentView[] | null>(null);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [commentsError, setCommentsError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [posting, setPosting] = useState(false);
  const [busyCommentId, setBusyCommentId] = useState<string | null>(null);
  const [commentToDelete, setCommentToDelete] = useState<CommentView | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // Jeton de collaboration demandé en parallèle du document ; toute erreur
      // (serveur non configuré, droits, réseau) laisse simplement l'éditeur local.
      const collabToken = getCollabTokenFn({ data: { fileId } }).catch(() => null);
      try {
        const [loaded, token] = await Promise.all([
          getDocumentFn({ data: { fileId } }),
          collabToken,
        ]);
        if (cancelled) return;
        setCollab(token?.url ? { url: token.url, token: token.token } : null);
        setDoc(loaded);
        setTitle(loaded.title);
      } catch {
        if (!cancelled) setError("Document introuvable ou accès refusé.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fileId]);

  async function onRename(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const clean = title.trim();
    if (!doc || clean.length === 0 || clean === doc.title) {
      setTitle(doc?.title ?? "");
      return;
    }

    setSavingTitle(true);
    try {
      const renamed = await renameDocumentFn({ data: { fileId, title: clean } });
      setDoc({ ...doc, title: renamed.title });
      setTitle(renamed.title);
    } catch {
      setTitle(doc.title);
    } finally {
      setSavingTitle(false);
    }
  }

  async function onLoadVersions() {
    if (versions !== null) {
      setVersions(null);
      setVersionsError(null);
      return;
    }
    setVersionsLoading(true);
    setVersionsError(null);
    try {
      setVersions(await listDocumentVersionsFn({ data: { fileId } }));
    } catch {
      setVersionsError("Impossible de charger l'historique des versions.");
    } finally {
      setVersionsLoading(false);
    }
  }

  async function loadComments() {
    setCommentsLoading(true);
    setCommentsError(null);
    try {
      setComments(await listCommentsFn({ data: { fileId } }));
    } catch {
      setCommentsError("Impossible de charger les commentaires.");
    } finally {
      setCommentsLoading(false);
    }
  }

  function toggleComments() {
    const next = !commentsOpen;
    setCommentsOpen(next);
    // Rechargement à chaque ouverture : les fils peuvent avoir changé ailleurs.
    if (next) void loadComments();
  }

  async function onAddComment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = draft.trim();
    if (body.length === 0) return;

    setPosting(true);
    setCommentsError(null);
    try {
      await addCommentFn({ data: { fileId, body } });
      setDraft("");
      await loadComments();
    } catch {
      setCommentsError("Impossible d'ajouter le commentaire.");
    } finally {
      setPosting(false);
    }
  }

  async function onToggleResolved(comment: CommentView) {
    setBusyCommentId(comment.id);
    setCommentsError(null);
    try {
      await resolveCommentFn({
        data: { fileId, commentId: comment.id, resolved: comment.resolvedAt === null },
      });
      await loadComments();
    } catch {
      setCommentsError("Impossible de mettre à jour le commentaire.");
    } finally {
      setBusyCommentId(null);
    }
  }

  async function onConfirmDelete() {
    if (!commentToDelete) return;
    const target = commentToDelete;
    setBusyCommentId(target.id);
    setCommentsError(null);
    try {
      await deleteCommentFn({ data: { fileId, commentId: target.id } });
      setCommentToDelete(null);
      await loadComments();
    } catch {
      setCommentsError("Impossible de supprimer le commentaire.");
    } finally {
      setBusyCommentId(null);
    }
  }

  if (error) {
    return (
      <div className="mx-auto flex max-w-3xl flex-col items-start gap-3">
        <p className="text-sm text-destructive">{error}</p>
        <Link to="/" className="text-sm font-medium text-primary hover:underline">
          Retour aux documents
        </Link>
      </div>
    );
  }

  if (!doc) {
    return <p className="text-sm text-muted-foreground">Chargement du document…</p>;
  }

  // Résolus en bas, visuellement atténués ; ordre chronologique conservé.
  const sortedComments = comments
    ? [...comments].sort((a, b) => {
        const aResolved = a.resolvedAt ? 1 : 0;
        const bResolved = b.resolvedAt ? 1 : 0;
        if (aResolved !== bResolved) return aResolved - bResolved;
        return a.createdAt.localeCompare(b.createdAt);
      })
    : [];

  return (
    <div className="flex h-full min-h-0 flex-col print-flow">
      <header className="flex flex-wrap items-center gap-3 border-b border-border pb-3 print-hide">
        <Link
          to="/"
          className="text-sm text-muted-foreground hover:text-foreground"
          aria-label="Retour aux documents"
        >
          ← Documents
        </Link>

        <form onSubmit={onRename} method="post" className="flex min-w-0 flex-1 items-center gap-2">
          <Input
            aria-label="Titre du document"
            className="h-8 max-w-md border-transparent bg-transparent px-1 text-base font-semibold focus-visible:border-input"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            disabled={!doc.canEdit || savingTitle}
            maxLength={255}
          />
        </form>

        {!doc.canEdit ? <Badge variant="outline">Lecture seule</Badge> : null}
        <Badge variant="default">v{doc.currentVersion}</Badge>
        {/* Statique après chargement : la collaboration est résolue avec le document. */}
        <Badge variant={collab ? "accent" : "outline"}>{collab ? "Temps réel" : "Local"}</Badge>

        <div className="ml-auto flex items-center gap-2">
          <Button
            variant={commentsOpen ? "secondary" : "ghost"}
            size="sm"
            aria-pressed={commentsOpen}
            onClick={toggleComments}
          >
            Commentaires
          </Button>
          <Button
            variant="ghost"
            size="sm"
            loading={versionsLoading}
            onClick={() => void onLoadVersions()}
          >
            Historique
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => window.print()}>
            Imprimer
          </Button>
          <a href={`/api/docs/export/${fileId}?format=md`} download>
            <Button variant="outline" size="sm">
              Exporter .md
            </Button>
          </a>
          <a href={`/api/docs/export/${fileId}?format=html`} download>
            <Button variant="outline" size="sm">
              Exporter .html
            </Button>
          </a>
        </div>
      </header>

      {versionsError ? (
        <div className="border-b border-border bg-muted/40 px-3 py-2 print-hide">
          <p role="alert" className="text-xs text-destructive">
            {versionsError}
          </p>
        </div>
      ) : null}

      {versions ? (
        <div className="border-b border-border bg-muted/40 px-3 py-2 print-hide">
          <p className="mb-1 text-xs font-medium uppercase tracking-widest text-muted-foreground">
            Versions
          </p>
          {versions.length === 0 ? (
            <p className="text-xs text-muted-foreground">Aucune version enregistrée.</p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {versions.map((version) => (
                <li key={version.id}>
                  <Badge variant="outline">
                    v{version.version} ·{" "}
                    {new Date(version.createdAt).toLocaleString("fr-FR", {
                      dateStyle: "short",
                      timeStyle: "short",
                    })}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1 print-surface">
        <div className="flex min-h-0 flex-1 flex-col">
          <DocumentEditor
            fileId={fileId}
            initialRevision={doc.revision}
            initialContent={doc.content}
            canEdit={doc.canEdit}
            // Étiquette du curseur — purement cosmétique : la page ne charge pas
            // le nom de session ; « Vous » n'apparaît que chez les autres.
            collab={
              collab
                ? { url: collab.url, room: fileId, token: collab.token, userName: "Vous" }
                : null
            }
          />
        </div>

        {commentsOpen ? (
          <aside
            aria-label="Commentaires"
            className="print-hide flex w-80 shrink-0 flex-col border-l border-border bg-card"
          >
            <header className="flex items-center justify-between border-b border-border px-3 py-2">
              <p className="text-sm font-medium">Commentaires</p>
              <Button
                variant="ghost"
                size="sm"
                aria-label="Fermer les commentaires"
                onClick={toggleComments}
              >
                <IconClose />
              </Button>
            </header>

            {doc.canComment ? (
              <form
                onSubmit={onAddComment}
                method="post"
                className="flex flex-col gap-2 border-b border-border p-3"
              >
                <textarea
                  aria-label="Nouveau commentaire"
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  rows={3}
                  maxLength={4000}
                  placeholder="Écrire un commentaire…"
                  className="resize-y rounded-md border border-input bg-background px-3 py-2 text-sm"
                />
                <div className="flex justify-end">
                  <Button
                    type="submit"
                    size="sm"
                    loading={posting}
                    disabled={draft.trim().length === 0}
                  >
                    Commenter
                  </Button>
                </div>
              </form>
            ) : (
              <p className="border-b border-border px-3 py-2 text-xs text-muted-foreground">
                Vous n'avez pas le droit de commenter ce document.
              </p>
            )}

            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
              {commentsError ? (
                <Alert tone="danger" className="text-xs">
                  {commentsError}
                </Alert>
              ) : null}

              {comments === null && commentsLoading ? (
                <div
                  role="status"
                  aria-label="Chargement des commentaires"
                  className="space-y-2 p-1"
                >
                  <div className="h-3 w-3/4 animate-pulse rounded bg-muted" />
                  <div className="h-3 w-full animate-pulse rounded bg-muted" />
                  <div className="h-3 w-1/2 animate-pulse rounded bg-muted" />
                </div>
              ) : null}

              {comments !== null && comments.length === 0 ? (
                <EmptyState
                  icon={<IconChat />}
                  title="Aucun commentaire"
                  hint="Ouvrez la discussion en ajoutant le premier commentaire."
                  className="p-4"
                />
              ) : null}

              {sortedComments.length > 0 ? (
                <ul className="space-y-3">
                  {sortedComments.map((comment) => {
                    const resolved = comment.resolvedAt !== null;
                    const canDelete = doc.isOwner || comment.authorId === doc.viewerId;
                    const busy = busyCommentId === comment.id;
                    return (
                      <li
                        key={comment.id}
                        className={cn(
                          "rounded-lg border border-border bg-background p-3 text-sm",
                          resolved && "bg-muted/40 text-muted-foreground",
                        )}
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{comment.authorName}</span>
                          <span className="text-xs text-muted-foreground">
                            {formatRelativeTime(comment.createdAt)}
                          </span>
                          {resolved ? (
                            <Badge variant="outline" className="ml-auto">
                              Résolu
                            </Badge>
                          ) : null}
                        </div>

                        {comment.quote ? (
                          <blockquote className="mt-2 border-l-2 border-border pl-2 text-xs italic text-muted-foreground">
                            {comment.quote}
                          </blockquote>
                        ) : null}

                        <p className="mt-2 whitespace-pre-wrap break-words">{comment.body}</p>

                        {doc.canComment || canDelete ? (
                          <div className="mt-1 flex items-center gap-1">
                            {doc.canComment ? (
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-6 px-2 text-xs"
                                disabled={busy}
                                onClick={() => void onToggleResolved(comment)}
                              >
                                {resolved ? "Rouvrir" : "Résoudre"}
                              </Button>
                            ) : null}
                            {canDelete ? (
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-6 px-2 text-xs text-destructive"
                                disabled={busy}
                                onClick={() => setCommentToDelete(comment)}
                              >
                                Supprimer
                              </Button>
                            ) : null}
                          </div>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </div>
          </aside>
        ) : null}
      </div>

      <p className="flex items-center gap-1 border-t border-border pt-2 text-xs text-muted-foreground print-hide">
        <IconFileText /> « {doc.title} » — fichier du Drive partagé avec les mêmes permissions.
      </p>

      <ConfirmDialog
        open={commentToDelete !== null}
        onClose={() => setCommentToDelete(null)}
        onConfirm={() => void onConfirmDelete()}
        title="Supprimer le commentaire"
        message="Cette action est définitive : le commentaire sera retiré pour tout le monde."
        confirmLabel="Supprimer"
        destructive
        busy={commentToDelete !== null && busyCommentId === commentToDelete.id}
      />
    </div>
  );
}
