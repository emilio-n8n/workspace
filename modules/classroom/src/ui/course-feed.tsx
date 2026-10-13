import { Alert, Badge, Button, ConfirmDialog, EmptyState, IconChat } from "@workspace/ui";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import {
  type AnnouncementView,
  addCommentFn,
  type CourseRole,
  createAnnouncementFn,
  deleteAnnouncementFn,
  deleteCommentFn,
  listAnnouncementsFn,
} from "../server.ts";
import type { Notify } from "./attachment-picker.tsx";
import { formatDateTime } from "./format.ts";
import { MAX_ANNOUNCEMENT_BODY, MAX_COMMENT_BODY } from "./limits.ts";

/** Initiales affichées à la place d'une photo de profil (aucune image en base). */
function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
}

type DeleteTarget = { kind: "announcement" | "comment"; id: string; label: string };

/**
 * Fil d'actualité du cours : les enseignants publient, tous les membres
 * commentent. Les conversations sont repliées par défaut (le fil reste lisible)
 * et se déplient au clic comme au clavier (`aria-expanded`).
 */
export function CourseFeed({
  courseId,
  role,
  notify,
}: {
  courseId: string;
  role: CourseRole;
  /** Messages éphémères partagés avec le reste de la page (une seule pile). */
  notify: Notify;
}) {
  const [announcements, setAnnouncements] = useState<AnnouncementView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [openThreads, setOpenThreads] = useState<Record<string, boolean>>({});
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});
  const [sendingCommentFor, setSendingCommentFor] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [deleting, setDeleting] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setAnnouncements(await listAnnouncementsFn({ data: { courseId } }));
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Chargement du fil impossible.");
    }
  }, [courseId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function publish(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (draft.trim().length === 0) return;
    setPublishing(true);
    try {
      await createAnnouncementFn({ data: { courseId, body: draft } });
      setDraft("");
      await refresh();
      notify("success", "Publication envoyée.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Publication impossible.");
    } finally {
      setPublishing(false);
    }
  }

  async function sendComment(announcementId: string) {
    const body = (commentDrafts[announcementId] ?? "").trim();
    if (body.length === 0) return;
    setSendingCommentFor(announcementId);
    try {
      await addCommentFn({ data: { announcementId, body } });
      setCommentDrafts((current) => ({ ...current, [announcementId]: "" }));
      setOpenThreads((current) => ({ ...current, [announcementId]: true }));
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Commentaire impossible.");
    } finally {
      setSendingCommentFor(null);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      if (deleteTarget.kind === "announcement") {
        await deleteAnnouncementFn({ data: { announcementId: deleteTarget.id } });
      } else {
        await deleteCommentFn({ data: { commentId: deleteTarget.id } });
      }
      setDeleteTarget(null);
      await refresh();
      notify("success", "Élément supprimé.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Suppression impossible.");
    } finally {
      setDeleting(false);
    }
  }

  const loading = announcements === null;

  return (
    <section aria-labelledby="course-feed-title" className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <h2 id="course-feed-title" className="font-display text-sm font-semibold">
          Fil d'actualité
        </h2>
        {announcements ? (
          <Badge variant="outline">
            {announcements.length} publication{announcements.length > 1 ? "s" : ""}
          </Badge>
        ) : null}
      </div>

      {role === "teacher" ? (
        <form
          onSubmit={publish}
          method="post"
          className="flex flex-col gap-2 rounded-xl border border-border bg-card p-3"
        >
          <label htmlFor="course-feed-draft" className="text-sm font-medium">
            Publier une annonce
          </label>
          <textarea
            id="course-feed-draft"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            rows={3}
            maxLength={MAX_ANNOUNCEMENT_BODY}
            placeholder="Informez vos élèves : nouvel horaire, rappel de matériel…"
            className="rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
          <div className="flex items-center justify-between gap-2">
            <p aria-live="polite" className="text-xs text-muted-foreground">
              {draft.length} / {MAX_ANNOUNCEMENT_BODY} caractères
            </p>
            <Button
              type="submit"
              size="sm"
              loading={publishing}
              disabled={draft.trim().length === 0}
            >
              Publier
            </Button>
          </div>
        </form>
      ) : null}

      {error ? <Alert tone="danger">{error}</Alert> : null}

      {loading ? (
        <p className="text-sm text-muted-foreground">Chargement du fil…</p>
      ) : announcements.length === 0 ? (
        <EmptyState
          icon={<IconChat />}
          title="Aucune publication"
          hint={
            role === "teacher"
              ? "Publiez une annonce pour prévenir tous les élèves du cours."
              : "Les annonces de votre enseignant apparaîtront ici."
          }
        />
      ) : (
        <ul aria-label="Publications du cours" className="flex flex-col gap-3">
          {announcements.map((announcement) => {
            const threadOpen = openThreads[announcement.id] ?? false;
            const threadId = `feed-thread-${announcement.id}`;
            return (
              <li
                key={announcement.id}
                className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4"
              >
                <div className="flex items-start gap-2">
                  <span
                    aria-hidden
                    className="grid size-8 shrink-0 place-items-center rounded-full bg-muted text-xs font-semibold text-muted-foreground"
                  >
                    {initials(announcement.author.name)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                      <span className="truncate">{announcement.author.name}</span>
                      {/* Seuls les enseignants publient : l'auteur en est un. */}
                      <Badge variant="outline">Enseignant</Badge>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatDateTime(announcement.createdAt) ?? "date inconnue"}
                    </p>
                  </div>
                  {announcement.canDelete ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="text-destructive"
                      onClick={() =>
                        setDeleteTarget({
                          kind: "announcement",
                          id: announcement.id,
                          label: "cette publication et ses commentaires",
                        })
                      }
                    >
                      Supprimer
                    </Button>
                  ) : null}
                </div>

                <p className="whitespace-pre-wrap text-sm text-foreground">{announcement.body}</p>

                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-expanded={threadOpen}
                    aria-controls={threadId}
                    onClick={() =>
                      setOpenThreads((current) => ({
                        ...current,
                        [announcement.id]: !threadOpen,
                      }))
                    }
                  >
                    {announcement.comments.length > 0
                      ? `${announcement.comments.length} commentaire${announcement.comments.length > 1 ? "s" : ""}`
                      : "Commenter"}
                  </Button>
                </div>

                <div id={threadId} hidden={!threadOpen} className="flex flex-col gap-2">
                  {announcement.comments.length > 0 ? (
                    <ul
                      aria-label="Commentaires de la publication"
                      className="flex flex-col gap-2 border-l border-border pl-3"
                    >
                      {announcement.comments.map((comment) => (
                        <li key={comment.id} className="flex flex-col gap-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-xs font-medium">{comment.author.name}</span>
                            <span className="text-xs text-muted-foreground">
                              {formatDateTime(comment.createdAt) ?? "date inconnue"}
                            </span>
                            {comment.canDelete ? (
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                aria-label={`Supprimer le commentaire de ${comment.author.name}`}
                                onClick={() =>
                                  setDeleteTarget({
                                    kind: "comment",
                                    id: comment.id,
                                    label: "ce commentaire",
                                  })
                                }
                              >
                                Supprimer
                              </Button>
                            ) : null}
                          </div>
                          <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                            {comment.body}
                          </p>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      Aucun commentaire pour l'instant.
                    </p>
                  )}

                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      void sendComment(announcement.id);
                    }}
                    method="post"
                    className="flex items-end gap-2"
                  >
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <label
                        htmlFor={`feed-comment-${announcement.id}`}
                        className="text-xs text-muted-foreground"
                      >
                        Votre commentaire
                      </label>
                      <textarea
                        id={`feed-comment-${announcement.id}`}
                        value={commentDrafts[announcement.id] ?? ""}
                        onChange={(event) =>
                          setCommentDrafts((current) => ({
                            ...current,
                            [announcement.id]: event.target.value,
                          }))
                        }
                        rows={2}
                        maxLength={MAX_COMMENT_BODY}
                        placeholder="Répondre à la classe"
                        className="rounded-md border border-input bg-background px-3 py-2 text-sm"
                      />
                    </div>
                    <Button
                      type="submit"
                      size="sm"
                      variant="outline"
                      loading={sendingCommentFor === announcement.id}
                      disabled={(commentDrafts[announcement.id] ?? "").trim().length === 0}
                    >
                      Envoyer
                    </Button>
                  </form>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => void confirmDelete()}
        title="Supprimer"
        message={<>Supprimer définitivement {deleteTarget?.label ?? "cet élément"} ?</>}
        confirmLabel="Supprimer"
        busy={deleting}
        destructive
      />
    </section>
  );
}
