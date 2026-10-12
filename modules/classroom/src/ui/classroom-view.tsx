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
  PageHeader,
} from "@workspace/ui";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import {
  type CourseDetail,
  type CourseSummary,
  createAssignmentFn,
  createCourseFn,
  deleteAssignmentFn,
  getCourseFn,
  gradeSubmissionFn,
  joinCourseFn,
  listCoursesFn,
  listSubmissionsFn,
  submitAssignmentFn,
  type TeacherSubmissionView,
} from "../server.ts";

function formatDate(iso: string | null): string {
  if (!iso) return "sans échéance";
  return new Date(iso).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

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
        <p className="text-sm text-muted-foreground">Chargement…</p>
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

      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} title="Créer un cours">
        <form onSubmit={onCreate} method="post" className="flex flex-col gap-4">
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

      <Dialog open={joinOpen} onClose={() => setJoinOpen(false)} title="Rejoindre un cours">
        <form onSubmit={onJoin} method="post" className="flex flex-col gap-4">
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
    </div>
  );
}

/** Page d'un cours : devoirs, copies et notes selon le rôle. */
export function CoursePage({ courseId }: { courseId: string }) {
  const [course, setCourse] = useState<CourseDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [gradingId, setGradingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; title: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [assignmentOpen, setAssignmentOpen] = useState(false);
  const [assignmentTitle, setAssignmentTitle] = useState("");
  const [assignmentInstructions, setAssignmentInstructions] = useState("");
  const [assignmentDue, setAssignmentDue] = useState("");
  const [assignmentPoints, setAssignmentPoints] = useState(100);
  const [submitTarget, setSubmitTarget] = useState<{ id: string; title: string } | null>(null);
  const [submitContent, setSubmitContent] = useState("");
  const [submissionsFor, setSubmissionsFor] = useState<{ id: string; title: string } | null>(null);
  const [submissions, setSubmissions] = useState<TeacherSubmissionView[] | null>(null);
  const [grades, setGrades] = useState<Record<string, string>>({});
  const [feedbacks, setFeedbacks] = useState<Record<string, string>>({});

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

  async function onCreateAssignment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (assignmentTitle.trim().length === 0) return;
    setBusy(true);
    try {
      await createAssignmentFn({
        data: {
          courseId,
          title: assignmentTitle.trim(),
          instructions: assignmentInstructions,
          dueAt: assignmentDue ? new Date(`${assignmentDue}T23:59:00`).toISOString() : null,
          points: assignmentPoints,
        },
      });
      setAssignmentTitle("");
      setAssignmentInstructions("");
      setAssignmentDue("");
      setAssignmentOpen(false);
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Création impossible.");
    } finally {
      setBusy(false);
    }
  }

  async function onSubmitAssignment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!submitTarget) return;
    setBusy(true);
    try {
      await submitAssignmentFn({
        data: { assignmentId: submitTarget.id, content: submitContent },
      });
      setSubmitTarget(null);
      setSubmitContent("");
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Envoi impossible.");
    } finally {
      setBusy(false);
    }
  }

  async function openSubmissions(assignment: { id: string; title: string }) {
    setSubmissionsFor(assignment);
    setSubmissions(null);
    setGrades({});
    setFeedbacks({});
    try {
      const list = await listSubmissionsFn({ data: { assignmentId: assignment.id } });
      setSubmissions(list);
      setGrades(
        Object.fromEntries(
          list.filter((row) => row.grade !== null).map((row) => [row.id, String(row.grade)]),
        ),
      );
      setFeedbacks(
        Object.fromEntries(
          list.filter((row) => row.feedback).map((row) => [row.id, row.feedback ?? ""]),
        ),
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Chargement impossible.");
    }
  }

  async function saveGrade(submissionId: string) {
    const raw = (grades[submissionId] ?? "").trim();
    const grade = Number(raw);
    if (raw.length === 0 || !Number.isFinite(grade) || !Number.isInteger(grade)) {
      setError("Saisissez une note valide.");
      return;
    }
    setGradingId(submissionId);
    try {
      await gradeSubmissionFn({
        data: { submissionId, grade, feedback: feedbacks[submissionId] ?? null },
      });
      setError(null);
      if (submissionsFor) await openSubmissions(submissionsFor);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Notation impossible.");
    } finally {
      setGradingId(null);
    }
  }

  async function confirmDeleteAssignment() {
    if (!deleteTarget) return;
    const assignmentId = deleteTarget.id;
    setDeleteTarget(null);
    await onDeleteAssignment(assignmentId);
  }

  async function onDeleteAssignment(assignmentId: string) {
    setBusy(true);
    try {
      await deleteAssignmentFn({ data: { assignmentId } });
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Suppression impossible.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4">
      <header className="flex flex-wrap items-center gap-2">
        <a href="/" className="text-sm text-muted-foreground hover:text-foreground">
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
        <div className="ml-auto flex items-center gap-2">
          {course?.role === "teacher" && course.joinCode ? (
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard?.writeText(course.joinCode ?? "");
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
              className="rounded-full border border-border px-3 py-1 text-xs font-medium hover:bg-muted"
            >
              Code : {course.joinCode} {copied ? "· copié !" : "· copier"}
            </button>
          ) : null}
          {course?.role === "teacher" ? (
            <Button size="sm" onClick={() => setAssignmentOpen(true)}>
              Nouveau devoir
            </Button>
          ) : null}
        </div>
      </header>

      {error ? <Alert tone="danger">{error}</Alert> : null}

      {course ? (
        course.assignments.length === 0 ? (
          <EmptyState
            icon={<IconClipboard />}
            title="Aucun devoir pour le moment"
            hint={course.role === "teacher" ? "Créez-en un pour vos élèves." : undefined}
            action={
              course.role === "teacher" ? (
                <Button size="sm" onClick={() => setAssignmentOpen(true)}>
                  Nouveau devoir
                </Button>
              ) : undefined
            }
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {course.assignments.map((assignment) => (
              <li
                key={assignment.id}
                className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-display text-sm font-semibold">{assignment.title}</p>
                  <Badge variant="outline">sur {assignment.points}</Badge>
                  <span className="text-xs text-muted-foreground">
                    {formatDate(assignment.dueAt)}
                  </span>
                  {assignment.mySubmission?.grade !== null &&
                  assignment.mySubmission?.grade !== undefined ? (
                    <Badge variant="accent">
                      Note : {assignment.mySubmission.grade}/{assignment.points}
                    </Badge>
                  ) : null}
                  <div className="ml-auto flex items-center gap-2">
                    {course.role === "teacher" ? (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => void openSubmissions(assignment)}
                        >
                          Copies ({assignment.submissionCount})
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-destructive"
                          loading={busy}
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
                        onClick={() => {
                          setSubmitTarget({ id: assignment.id, title: assignment.title });
                          setSubmitContent(assignment.mySubmission?.content ?? "");
                        }}
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
                {course.role === "student" && assignment.mySubmission ? (
                  <p className="text-xs text-muted-foreground">
                    Rendue le{" "}
                    {new Date(assignment.mySubmission.submittedAt).toLocaleString("fr-FR")}
                    {assignment.mySubmission.feedback
                      ? ` · Commentaire : ${assignment.mySubmission.feedback}`
                      : ""}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )
      ) : !error ? (
        <p className="text-sm text-muted-foreground">Chargement…</p>
      ) : null}

      <Dialog open={assignmentOpen} onClose={() => setAssignmentOpen(false)} title="Nouveau devoir">
        <form onSubmit={onCreateAssignment} method="post" className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="assignment-title">Titre</Label>
            <Input
              id="assignment-title"
              value={assignmentTitle}
              onChange={(event) => setAssignmentTitle(event.target.value)}
              maxLength={150}
              autoFocus
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="assignment-instructions">Consignes</Label>
            <textarea
              id="assignment-instructions"
              value={assignmentInstructions}
              onChange={(event) => setAssignmentInstructions(event.target.value)}
              rows={4}
              className="rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor="assignment-due">Échéance</Label>
              <Input
                id="assignment-due"
                type="date"
                value={assignmentDue}
                onChange={(event) => setAssignmentDue(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="assignment-points">Points</Label>
              <Input
                id="assignment-points"
                type="number"
                min={0}
                max={1000}
                value={assignmentPoints}
                onChange={(event) => setAssignmentPoints(Number(event.target.value) || 0)}
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setAssignmentOpen(false)}>
              Annuler
            </Button>
            <Button type="submit" loading={busy} disabled={assignmentTitle.trim().length === 0}>
              Créer le devoir
            </Button>
          </div>
        </form>
      </Dialog>

      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => void confirmDeleteAssignment()}
        title="Supprimer le devoir"
        message={
          <>
            Supprimer le devoir et toutes les copies ?
            {deleteTarget ? ` « ${deleteTarget.title} »` : ""}
          </>
        }
        confirmLabel="Supprimer le devoir"
        busy={busy}
        destructive
      />

      <Dialog
        open={submitTarget !== null}
        onClose={() => setSubmitTarget(null)}
        title={submitTarget ? `Copie — ${submitTarget.title}` : "Copie"}
        className="max-w-2xl"
      >
        <form onSubmit={onSubmitAssignment} method="post" className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="submission-content">Votre réponse</Label>
            <textarea
              id="submission-content"
              value={submitContent}
              onChange={(event) => setSubmitContent(event.target.value)}
              rows={10}
              maxLength={50_000}
              className="rounded-md border border-input bg-background px-3 py-2 text-sm"
              autoFocus
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setSubmitTarget(null)}>
              Annuler
            </Button>
            <Button type="submit" loading={busy} disabled={submitContent.trim().length === 0}>
              Rendre la copie
            </Button>
          </div>
        </form>
      </Dialog>

      <Dialog
        open={submissionsFor !== null}
        onClose={() => setSubmissionsFor(null)}
        title={submissionsFor ? `Copies — ${submissionsFor.title}` : "Copies"}
        className="max-w-2xl"
      >
        {submissions === null ? (
          <p className="text-sm text-muted-foreground">Chargement…</p>
        ) : submissions.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aucune copie rendue pour le moment.</p>
        ) : (
          <ul className="flex max-h-96 flex-col gap-3 overflow-y-auto">
            {submissions.map((submission) => (
              <li
                key={submission.id}
                className="flex flex-col gap-2 rounded-lg border border-border p-3"
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{submission.studentName}</span>
                  <span className="text-xs text-muted-foreground">{submission.studentEmail}</span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {new Date(submission.submittedAt).toLocaleString("fr-FR")}
                  </span>
                </div>
                <p className="whitespace-pre-wrap rounded-md bg-muted px-3 py-2 text-sm">
                  {submission.content}
                </p>
                <div className="flex items-center gap-2">
                  <Label htmlFor={`grade-${submission.id}`} className="shrink-0">
                    Note
                  </Label>
                  <Input
                    id={`grade-${submission.id}`}
                    type="number"
                    min={0}
                    max={submission.points}
                    value={grades[submission.id] ?? ""}
                    onChange={(event) =>
                      setGrades((current) => ({ ...current, [submission.id]: event.target.value }))
                    }
                    className="h-8 w-20"
                  />
                  <Input
                    aria-label={`Commentaire de ${submission.studentName}`}
                    value={feedbacks[submission.id] ?? ""}
                    onChange={(event) =>
                      setFeedbacks((current) => ({
                        ...current,
                        [submission.id]: event.target.value,
                      }))
                    }
                    placeholder="Commentaire (facultatif)"
                    className="h-8 flex-1"
                  />
                  <Button
                    size="sm"
                    loading={gradingId === submission.id}
                    disabled={gradingId !== null && gradingId !== submission.id}
                    onClick={() => void saveGrade(submission.id)}
                  >
                    Noter
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Dialog>
    </div>
  );
}
