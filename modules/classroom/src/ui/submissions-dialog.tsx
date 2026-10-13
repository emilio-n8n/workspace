import { Alert, Button, EmptyState, Input, Label } from "@workspace/ui";
import { type KeyboardEvent, useCallback, useEffect, useRef, useState } from "react";
import type { TeacherSubmissionView } from "../server.ts";
import { gradeSubmissionFn, listSubmissionsFn } from "../server.ts";
import { AttachmentLinks } from "./attachment-links.tsx";
import type { Notify } from "./attachment-picker.tsx";
import { daysLate, formatDateTime, formatDueDate } from "./format.ts";
import { StatusBadge } from "./status-badge.tsx";

/** Devoir dont l'enseignant consulte les copies. */
export type SubmissionTarget = { id: string; title: string; points: number; dueAt: string | null };

/**
 * Copies d'un devoir, côté enseignant : la liste à gauche se parcourt au clavier
 * comme à la souris (rôle `listbox`, `aria-activedescendant`, flèches,
 * Début/Fin), la copie sélectionnée se lit et se note à droite. Le statut de
 * chaque copie — rendue, en retard, notée — est affiché des deux côtés.
 */
export function SubmissionsDialog({
  assignment,
  notify,
}: {
  assignment: SubmissionTarget | null;
  notify: Notify;
}) {
  const [submissions, setSubmissions] = useState<TeacherSubmissionView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [grades, setGrades] = useState<Record<string, string>>({});
  const [feedbacks, setFeedbacks] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  /** Boutons de la liste, pour déplacer le focus en même temps que la sélection. */
  const optionRefs = useRef(new Map<string, HTMLButtonElement>());

  const load = useCallback(async (assignmentId: string, keepSelection: string | null) => {
    try {
      const list = await listSubmissionsFn({ data: { assignmentId } });
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
      // La sélection survit au rechargement : noter une copie ne doit jamais
      // ramener l'enseignant en haut de la liste.
      setSelectedId(keepSelection ?? list[0]?.id ?? null);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Chargement des copies impossible.");
    }
  }, []);

  useEffect(() => {
    if (!assignment) {
      setSubmissions(null);
      return;
    }
    setSubmissions(null);
    setSelectedId(null);
    void load(assignment.id, null);
  }, [assignment, load]);

  const selected = submissions?.find((row) => row.id === selectedId) ?? null;
  const pendingCount = submissions?.filter((row) => row.status !== "graded").length ?? 0;

  function select(id: string) {
    setSelectedId(id);
  }

  /**
   * Parcours de la liste au clavier : flèches, Début et Fin déplacent la
   * sélection, le focus suit (l'enseignant corrige une pile de copies sans
   * jamais toucher la souris).
   */
  function onOptionKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (!submissions || submissions.length === 0) return;
    const last = submissions.length - 1;
    let next: number | null = null;
    switch (event.key) {
      case "ArrowDown":
        next = Math.min(last, index + 1);
        break;
      case "ArrowUp":
        next = Math.max(0, index - 1);
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = last;
        break;
      default:
        return;
    }
    event.preventDefault();
    const target = submissions[next];
    if (!target) return;
    select(target.id);
    optionRefs.current.get(target.id)?.focus();
    optionRefs.current.get(target.id)?.scrollIntoView({ block: "nearest" });
  }

  async function save(row: TeacherSubmissionView) {
    const raw = (grades[row.id] ?? "").trim();
    const grade = Number(raw);
    if (raw.length === 0 || !Number.isFinite(grade) || !Number.isInteger(grade)) {
      setError("Saisissez une note valide.");
      return;
    }
    setSavingId(row.id);
    try {
      await gradeSubmissionFn({
        data: { submissionId: row.id, grade, feedback: feedbacks[row.id] ?? null },
      });
      setError(null);
      if (assignment) await load(assignment.id, row.id);
      notify("success", `Note de ${row.studentName} enregistrée.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Notation impossible.");
    } finally {
      setSavingId(null);
    }
  }

  if (!assignment) return null;

  return (
    <div className="grid gap-3 md:grid-cols-[minmax(0,15rem)_minmax(0,1fr)]">
      {submissions === null ? (
        <p className="text-sm text-muted-foreground md:col-span-2">Chargement des copies…</p>
      ) : submissions.length === 0 ? (
        <div className="md:col-span-2">
          <EmptyState
            title="Aucune copie rendue"
            hint="Les copies apparaîtront ici dès qu'un élève aura rendu son travail."
          />
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-2">
            <p className="text-xs text-muted-foreground">
              {submissions.length} copie{submissions.length > 1 ? "s" : ""} · {pendingCount} à
              corriger
            </p>
            <ul
              aria-label="Copies des élèves"
              className="flex max-h-96 flex-col gap-1 overflow-y-auto rounded-md border border-border p-1"
            >
              {submissions.map((row, index) => {
                const isSelected = row.id === selectedId;
                return (
                  <li key={row.id}>
                    <button
                      type="button"
                      ref={(node) => {
                        if (node) optionRefs.current.set(row.id, node);
                        else optionRefs.current.delete(row.id);
                      }}
                      aria-current={isSelected ? "true" : undefined}
                      onClick={() => select(row.id)}
                      onKeyDown={(event) => onOptionKeyDown(event, index)}
                      className={
                        isSelected
                          ? "flex w-full cursor-pointer flex-col gap-1 rounded-md bg-muted px-2 py-1.5 text-left"
                          : "flex w-full cursor-pointer flex-col gap-1 rounded-md px-2 py-1.5 text-left hover:bg-muted/60"
                      }
                    >
                      <span className="flex items-center gap-2">
                        <span className="min-w-0 flex-1 truncate text-sm font-medium">
                          {row.studentName}
                        </span>
                        {row.grade !== null ? (
                          <span className="shrink-0 text-xs text-muted-foreground">
                            {row.grade}/{row.points}
                          </span>
                        ) : null}
                      </span>
                      <span className="flex items-center gap-2">
                        <StatusBadge code={row.status} />
                        <span className="text-xs text-muted-foreground">
                          {formatDateTime(row.submittedAt) ?? "date inconnue"}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="flex flex-col gap-3 rounded-md border border-border p-3">
            {selected ? (
              <>
                <div className="flex flex-col gap-1">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    {selected.studentName}
                    <StatusBadge code={selected.status} />
                  </p>
                  <p className="text-xs text-muted-foreground">{selected.studentEmail}</p>
                  <p aria-live="polite" className="text-xs text-muted-foreground">
                    {`Copie de ${selected.studentName} sélectionnée — ${
                      selected.grade !== null
                        ? `notée ${selected.grade} sur ${selected.points}`
                        : selected.status === "late"
                          ? `rendue en retard${lateLabel(selected)}`
                          : "rendue dans les temps"
                    }.`}
                  </p>
                </div>

                <dl className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                  <div>
                    <dt>Remise</dt>
                    <dd>{formatDateTime(selected.submittedAt) ?? "date inconnue"}</dd>
                  </div>
                  <div>
                    <dt>Échéance</dt>
                    <dd>{formatDueDate(selected.dueAt)}</dd>
                  </div>
                </dl>

                <p className="whitespace-pre-wrap rounded-md bg-muted px-3 py-2 text-sm">
                  {selected.content}
                </p>

                <AttachmentLinks attachments={selected.attachments} />

                <div className="flex flex-wrap items-end gap-2">
                  <div className="flex flex-col gap-1">
                    <Label htmlFor={`grade-${selected.id}`}>Note sur {assignment.points}</Label>
                    <Input
                      id={`grade-${selected.id}`}
                      type="number"
                      min={0}
                      max={assignment.points}
                      value={grades[selected.id] ?? ""}
                      onChange={(event) =>
                        setGrades((current) => ({ ...current, [selected.id]: event.target.value }))
                      }
                      className="h-8 w-24"
                    />
                  </div>
                  <div className="flex min-w-40 flex-1 flex-col gap-1">
                    <Label htmlFor={`feedback-${selected.id}`}>Commentaire (facultatif)</Label>
                    <Input
                      id={`feedback-${selected.id}`}
                      value={feedbacks[selected.id] ?? ""}
                      onChange={(event) =>
                        setFeedbacks((current) => ({
                          ...current,
                          [selected.id]: event.target.value,
                        }))
                      }
                      placeholder="Ce qui est bien, ce qui doit être revu"
                      className="h-8"
                    />
                  </div>
                  <Button
                    size="sm"
                    loading={savingId === selected.id}
                    disabled={savingId !== null}
                    onClick={() => void save(selected)}
                  >
                    Noter
                  </Button>
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                Sélectionnez une copie dans la liste pour la lire et la noter.
              </p>
            )}
            {error ? <Alert tone="danger">{error}</Alert> : null}
          </div>
        </>
      )}
    </div>
  );
}

/** Mention de retard lisible : « 2 jours après l'échéance ». */
function lateLabel(row: TeacherSubmissionView): string {
  const late = daysLate(row.submittedAt, row.dueAt);
  return late === null ? "" : ` ${late} jour${late > 1 ? "s" : ""} après l'échéance`;
}
