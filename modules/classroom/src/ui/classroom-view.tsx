import { useNavigate } from "@tanstack/react-router";
import {
  Alert,
  Badge,
  Button,
  ConfirmDialog,
  Dialog,
  EmptyState,
  IconClipboard,
  IconGraduation,
  Input,
  Label,
  LoadingState,
  PageHeader,
  Toasts,
  useToasts,
} from "@workspace/ui";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import {
  type CourseDetail,
  type CourseSummary,
  createCourseFn,
  deleteAssignmentFn,
  getCourseFn,
  joinCourseFn,
  listCoursesFn,
} from "../server.ts";
import { AssignmentDialog } from "./assignment-dialog.tsx";
import { AttachmentLinks } from "./attachment-links.tsx";
import { CourseFeed } from "./course-feed.tsx";
import { formatDate, formatDateTime } from "./format.ts";
import { GradesPanel } from "./grades-panel.tsx";
import { MembersDialog } from "./members-dialog.tsx";
import { StatusBadge } from "./status-badge.tsx";
import { SubmissionDialog } from "./submission-dialog.tsx";
import { SubmissionsDialog, type SubmissionTarget } from "./submissions-dialog.tsx";

/** Liste des cours (enseignant ou élève) avec code d'accès. */
export function ClassroomView() {
  const navigate = useNavigate();
  const [courses, setCourses] = useState<CourseSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [joinOpen, setJoinOpen] = useState(false);
  const [name, setName] = useState("");
  const [section, setSection] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setCourses(await listCoursesFn());
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
    if (name.trim().length === 0) return;
    setBusy(true);
    try {
      const created = await createCourseFn({
        data: { name: name.trim(), section: section.trim() || null },
      });
      setName("");
      setSection("");
      setCreateOpen(false);
      await navigate({ to: "/course/$courseId", params: { courseId: created.id } });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Création impossible.");
    } finally {
      setBusy(false);
    }
  }

  async function onJoin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (code.trim().length === 0) return;
    setBusy(true);
    try {
      const joined = await joinCourseFn({ data: { code: code.trim() } });
      setCode("");
      setJoinOpen(false);
      await navigate({ to: "/course/$courseId", params: { courseId: joined.courseId } });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Connexion impossible.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4">
      <PageHeader
        title="Cours"
        description="Créez un cours ou rejoignez-en un avec le code fourni par l'enseignant."
        actions={
          <>
            <Button size="sm" variant="outline" onClick={() => setJoinOpen(true)}>
              Rejoindre avec un code
            </Button>
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              Créer un cours
            </Button>
          </>
        }
      />

      {error ? <Alert tone="danger">{error}</Alert> : null}

      {loading ? (
        <LoadingState label="Chargement du cours…" />
      ) : courses.length === 0 ? (
        <EmptyState
          icon={<IconGraduation />}
          title="Aucun cours pour le moment"
          hint="Créez-en un ou rejoignez un cours existant."
          action={
            <div className="flex flex-wrap items-center justify-center gap-2">
              <Button size="sm" variant="outline" onClick={() => setJoinOpen(true)}>
                Rejoindre avec un code
              </Button>
              <Button size="sm" onClick={() => setCreateOpen(true)}>
                Créer un cours
              </Button>
            </div>
          }
        />
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {courses.map((course) => (
            <li key={course.id}>
              <button
                type="button"
                onClick={() =>
                  void navigate({ to: "/course/$courseId", params: { courseId: course.id } })
                }
                className="flex h-full w-full flex-col gap-2 rounded-xl border border-border bg-card p-4 text-left shadow-soft transition-colors hover:bg-muted"
              >
                <span className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate font-display text-sm font-semibold">
                    {course.name}
                  </span>
                  <Badge variant={course.role === "teacher" ? "accent" : "outline"}>
                    {course.role === "teacher" ? "Enseignant" : "Élève"}
                  </Badge>
                </span>
                <span className="text-xs text-muted-foreground">
                  {course.section ? `${course.section} · ` : ""}
                  {course.studentCount} élève(s) · {course.assignmentCount} devoir(s)
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {createOpen ? (
        <Dialog open onClose={() => setCreateOpen(false)} title="Créer un cours">
          <form id="course-form" onSubmit={onCreate} method="post" className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="course-name">Nom du cours</Label>
              <Input
                id="course-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Mathématiques"
                maxLength={150}
                autoFocus
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="course-section">Section (facultatif)</Label>
              <Input
                id="course-section"
                value={section}
                onChange={(event) => setSection(event.target.value)}
                placeholder="2ᵈᵉ A"
                maxLength={150}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setCreateOpen(false)}>
                Annuler
              </Button>
              <Button type="submit" loading={busy} disabled={name.trim().length === 0}>
                Créer le cours
              </Button>
            </div>
          </form>
        </Dialog>
      ) : null}

      {joinOpen ? (
        <Dialog open onClose={() => setJoinOpen(false)} title="Rejoindre un cours">
          <form id="join-form" onSubmit={onJoin} method="post" className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="course-code">Code d'accès</Label>
              <Input
                id="course-code"
                value={code}
                onChange={(event) => setCode(event.target.value.toUpperCase())}
                placeholder="ABCD2345"
                maxLength={12}
                autoFocus
              />
              <p className="text-xs text-muted-foreground">
                Le code à 8 caractères fourni par votre enseignant.
              </p>
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setJoinOpen(false)}>
                Annuler
              </Button>
              <Button type="submit" loading={busy} disabled={code.trim().length === 0}>
                Rejoindre
              </Button>
            </div>
          </form>
        </Dialog>
      ) : null}
    </div>
  );
}

/**
 * Page d'un cours : fil d'actualité, puis devoirs. Un élève voit ses statuts
 * (à rendre, rendu, en retard, noté) et rend sa copie ; un enseignant voit le
 * suivi des copies, modifie ses devoirs et note.
 */
export function CoursePage({ courseId }: { courseId: string }) {
  const [course, setCourse] = useState<CourseDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  /** Devoir en création (`id: null`) ou en édition ; `null` = dialogue fermé. */
  const [editing, setEditing] = useState<{ id: string | null } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; title: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  /** Identifiant du devoir dont l'élève rédige la copie. */
  const [submitting, setSubmitting] = useState<string | null>(null);
  /** Copies consultées par l'enseignant. */
  const [submissionsFor, setSubmissionsFor] = useState<SubmissionTarget | null>(null);
  /** Gestion des membres (liste, retrait, code d'invitation). */
  const [membersOpen, setMembersOpen] = useState(false);
  const { toasts, push, dismiss } = useToasts();

  const refresh = useCallback(async () => {
    try {
      setCourse(await getCourseFn({ data: { courseId } }));
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Chargement impossible.");
    }
  }, [courseId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function onDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteAssignmentFn({ data: { assignmentId: deleteTarget.id } });
      setDeleteTarget(null);
      await refresh();
      push("success", "Devoir supprimé.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Suppression impossible.");
    } finally {
      setDeleting(false);
    }
  }

  const loading = course === null;
  const teacher = course?.role === "teacher";
  const assignments = course?.assignments ?? [];
  /** `null` à l'ouverture en création, le devoir à corriger en édition. */
  const edited = assignments.find((assignment) => assignment.id === editing?.id) ?? null;

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <header className="flex flex-wrap items-center gap-2">
        <a
          href="/"
          className="text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          ← Cours
        </a>
        <div className="min-w-0">
          <h1 className="truncate font-display text-xl font-semibold tracking-tight">
            {course?.name ?? "…"}
          </h1>
          <p className="text-xs text-muted-foreground">
            {course?.section ? `${course.section} · ` : ""}
            {course ? `${course.members.length} membre(s)` : ""}
          </p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {teacher && course?.joinCode ? (
            <>
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard?.writeText(course.joinCode ?? "");
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}
                className="rounded-full border border-border px-3 py-1 text-xs font-medium transition-colors hover:bg-muted"
                title="Copier le code d'accès"
              >
                Code : {course.joinCode} <span className="opacity-70">· copier</span>
              </button>
              {/* Annonce vocale de la copie : le bouton, lui, ne change pas. */}
              <span role="status" className="text-xs text-muted-foreground">
                {copied ? "Code copié." : ""}
              </span>
            </>
          ) : null}
          {teacher ? (
            <Button size="sm" onClick={() => setEditing({ id: null })}>
              Nouveau devoir
            </Button>
          ) : null}
          <Button size="sm" variant="outline" onClick={() => setMembersOpen(true)}>
            Membres ({course?.members.length ?? 0})
          </Button>
        </div>
      </header>

      {error ? <Alert tone="danger">{error}</Alert> : null}

      {loading ? (
        <LoadingState label="Chargement du cours…" />
      ) : course ? (
        <>
          <CourseFeed courseId={course.id} role={course.role} notify={push} />

          <section aria-labelledby="assignments-title" className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <h2 id="assignments-title" className="font-display text-sm font-semibold">
                Devoirs
              </h2>
              <Badge variant="outline">
                {assignments.length} devoir{assignments.length > 1 ? "s" : ""}
              </Badge>
            </div>

            {assignments.length === 0 ? (
              <EmptyState
                icon={<IconClipboard />}
                title="Aucun devoir pour le moment"
                hint={
                  teacher
                    ? "Créez un devoir : vos élèves le verront et pourront rendre leur copie."
                    : "Les devoirs de votre enseignant apparaîtront ici."
                }
                action={
                  teacher ? (
                    <Button size="sm" onClick={() => setEditing({ id: null })}>
                      Nouveau devoir
                    </Button>
                  ) : undefined
                }
              />
            ) : (
              <ul className="flex flex-col gap-2">
                {assignments.map((assignment) => {
                  // Note déjà posée sur la copie de l'élève connecté, s'il y en a une.
                  const myGrade = assignment.mySubmission?.grade ?? null;
                  return (
                    <li
                      key={assignment.id}
                      className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-display text-sm font-semibold">{assignment.title}</h3>
                        <Badge variant="outline">sur {assignment.points}</Badge>
                        {/* Le statut ne concerne que l'élève : pour un enseignant,
                          « non rendu » n'aurait aucun sens. */}
                        {teacher ? null : <StatusBadge code={assignment.status} />}
                        {/* La note n'a de sens que pour l'élève qui l'a reçue. */}
                        {teacher || myGrade === null ? null : (
                          <Badge variant="accent">
                            Note : {myGrade}/{assignment.points}
                          </Badge>
                        )}
                        <span className="text-xs text-muted-foreground">
                          {formatDate(assignment.dueAt) ?? "sans échéance"}
                        </span>
                        <div className="ml-auto flex flex-wrap items-center gap-2">
                          {teacher ? (
                            <>
                              <span className="text-xs text-muted-foreground">
                                {assignment.submissionCount} copie
                                {assignment.submissionCount > 1 ? "s" : ""}
                                {assignment.counts && assignment.counts.graded > 0
                                  ? ` · ${assignment.counts.graded} notée${assignment.counts.graded > 1 ? "s" : ""}`
                                  : ""}
                              </span>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() =>
                                  setSubmissionsFor({
                                    id: assignment.id,
                                    title: assignment.title,
                                    points: assignment.points,
                                    dueAt: assignment.dueAt,
                                  })
                                }
                              >
                                Copies ({assignment.submissionCount})
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => setEditing({ id: assignment.id })}
                              >
                                Modifier
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="text-destructive"
                                onClick={() =>
                                  setDeleteTarget({ id: assignment.id, title: assignment.title })
                                }
                              >
                                Supprimer
                              </Button>
                            </>
                          ) : (
                            <Button
                              size="sm"
                              variant={assignment.mySubmission ? "outline" : "primary"}
                              onClick={() => setSubmitting(assignment.id)}
                            >
                              {assignment.mySubmission ? "Modifier ma copie" : "Rendre ma copie"}
                            </Button>
                          )}
                        </div>
                      </div>

                      {assignment.instructions ? (
                        <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                          {assignment.instructions}
                        </p>
                      ) : null}

                      {!teacher && assignment.mySubmission ? (
                        <div className="flex flex-col gap-2">
                          <p className="text-xs text-muted-foreground">
                            Rendue le {formatDateTime(assignment.mySubmission.submittedAt)}
                          </p>
                          {/* Commentaire privé du professeur : séparé du fil
                              public, visible par cet élève et son enseignant. */}
                          {assignment.mySubmission.feedback ? (
                            <div className="rounded-md border border-border bg-muted/40 px-3 py-2">
                              <p className="text-xs font-medium text-muted-foreground">
                                Commentaire privé de votre professeur
                              </p>
                              <p className="whitespace-pre-wrap text-sm">
                                {assignment.mySubmission.feedback}
                              </p>
                            </div>
                          ) : null}
                          <AttachmentLinks attachments={assignment.mySubmission.attachments} />
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {/* Côté élève : sa moyenne du cours. Côté enseignant : le carnet de
              la classe. Le panneau choisit sa vue selon ce qui lui est fourni. */}
          <GradesPanel
            myGrades={course.myGrades}
            classGrades={course.classGrades}
            courseId={course.id}
          />
        </>
      ) : null}

      {editing && course ? (
        <AssignmentDialog
          open
          onClose={() => setEditing(null)}
          courseId={course.id}
          assignment={edited}
          onSaved={async () => {
            await refresh();
            push("success", edited ? "Devoir mis à jour." : "Devoir créé.");
          }}
          onRequestDelete={
            edited ? () => setDeleteTarget({ id: edited.id, title: edited.title }) : undefined
          }
        />
      ) : null}

      {submitting ? (
        <SubmissionDialog
          assignment={assignments.find((assignment) => assignment.id === submitting) ?? null}
          notify={push}
          onClose={() => setSubmitting(null)}
          onSubmitted={refresh}
        />
      ) : null}

      {submissionsFor ? (
        <Dialog
          open
          onClose={() => setSubmissionsFor(null)}
          title={`Copies — ${submissionsFor.title}`}
          className="max-w-4xl"
        >
          <SubmissionsDialog assignment={submissionsFor} notify={push} />
        </Dialog>
      ) : null}

      {course ? (
        <MembersDialog
          open={membersOpen}
          onClose={() => setMembersOpen(false)}
          courseId={course.id}
          courseName={course.name}
          members={course.members}
          canManage={teacher}
          ownerId={course.ownerId}
          joinCode={course.joinCode}
          onRemoved={refresh}
          onRegenerated={refresh}
        />
      ) : null}

      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => void onDelete()}
        title="Supprimer le devoir"
        message={
          <>
            Supprimer le devoir et toutes les copies ?
            {deleteTarget ? ` « ${deleteTarget.title} »` : ""}
          </>
        }
        confirmLabel="Supprimer le devoir"
        busy={deleting}
        destructive
      />

      <Toasts toasts={toasts} dismiss={dismiss} />
    </div>
  );
}
