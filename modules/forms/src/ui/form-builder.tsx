import {
  Alert,
  Badge,
  Button,
  buttonVariants,
  EmptyState,
  IconClipboard,
  Input,
  Kbd,
  Label,
  SegmentedTabs,
} from "@workspace/ui";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  duplicateQuestion,
  FORM_KINDS,
  type FormKind,
  insertQuestion,
  KIND_HINTS,
  KIND_LABELS,
  kindHasOptions,
  moveQuestion,
  removeQuestion,
} from "../questions.ts";
import {
  type FormDetail,
  getFormFn,
  listResponsesFn,
  type QuestionView,
  type ResponseView,
  saveFormFn,
} from "../server.ts";
import { FormsToasts, useFormsToasts } from "./toasts.tsx";

const STATUS_OPTIONS = [
  { value: "draft", label: "Brouillon (non publié)" },
  { value: "open", label: "Ouvert (réponses acceptées)" },
  { value: "closed", label: "Fermé" },
];

type QuestionDraft = {
  key: string;
  /** Identifiant serveur conservé pour ne pas orpheliner les réponses. */
  id?: string;
  kind: FormKind;
  label: string;
  required: boolean;
  options: string[];
};

function toDraft(question: QuestionView): QuestionDraft {
  return {
    key: crypto.randomUUID(),
    id: question.id,
    kind: question.kind,
    label: question.label,
    required: question.required,
    options: question.options,
  };
}

function newDraft(kind: FormKind): QuestionDraft {
  return {
    key: crypto.randomUUID(),
    kind,
    label: "",
    required: false,
    options: kindHasOptions(kind) ? ["", ""] : [],
  };
}

/** Constructeur de formulaire : questions, statut, lien public et réponses. */
export function FormBuilder({ fileId }: { fileId: string }) {
  const [detail, setDetail] = useState<FormDetail | null>(null);
  const [questions, setQuestions] = useState<QuestionDraft[]>([]);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<FormDetail["status"]>("open");
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [tab, setTab] = useState<"questions" | "responses">("questions");
  const [responses, setResponses] = useState<{
    questions: QuestionView[];
    responses: ResponseView[];
  } | null>(null);
  const [responsesError, setResponsesError] = useState<string | null>(null);
  const [responsesBusy, setResponsesBusy] = useState(false);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const { toasts, push, pushUndo, dismiss } = useFormsToasts();
  const listRef = useRef<HTMLUListElement>(null);

  const load = useCallback(async () => {
    try {
      const loaded = await getFormFn({ data: { fileId } });
      setDetail(loaded);
      setTitle(loaded.title);
      setDescription(loaded.description ?? "");
      setStatus(loaded.status);
      setQuestions(loaded.questions.map(toDraft));
      setDirty(false);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Chargement impossible.");
    }
  }, [fileId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function loadResponses() {
    setResponsesBusy(true);
    setResponsesError(null);
    try {
      setResponses(await listResponsesFn({ data: { fileId } }));
    } catch (caught) {
      setResponsesError(
        caught instanceof Error ? caught.message : "Chargement des réponses impossible.",
      );
    } finally {
      setResponsesBusy(false);
    }
  }

  function copyLink() {
    void navigator.clipboard?.writeText(publicUrl);
    push("success", "Lien copié.");
  }

  function update(change: () => void) {
    change();
    setDirty(true);
    setSaved(false);
  }

  /** Déplace une question d'un cran, boutons ou clavier (Alt + flèche). */
  function move(index: number, direction: -1 | 1) {
    const next = moveQuestion(questions, index, direction);
    if (!next) return;
    update(() => setQuestions(next));
    const target = next[index + direction];
    // Le nouvel ordre se voit à l'écran ; un lecteur d'écran doit l'entendre.
    // Message court, rendu dans une zone `role="status"`.
    setAnnouncement(
      target
        ? `Question ${index + 1} déplacée en position ${index + direction + 1}.`
        : "Ordre des questions inchangé.",
    );
  }

  /** Duplique une question : nouvelle question, les réponses restent à l'originale. */
  function duplicate(index: number) {
    const next = duplicateQuestion(questions, index, (source) => ({
      ...source,
      id: undefined,
      // La copie n'est pas encore enregistrée : elle n'a pas d'identifiant.
      label: source.label.trim().length > 0 ? `${source.label.trim()} (copie)` : "",
      key: crypto.randomUUID(),
    }));
    if (!next) return;
    update(() => setQuestions(next));
    const copy = next[index + 1];
    if (copy) setFocusKey(copy.key);
    push("success", "Question dupliquée.");
  }

  /**
   * Supprime une question, avec annulation possible pendant 8 s. La question
   * est retirée de la liste (donc de l'enregistrement) mais conservée en
   * mémoire à sa position : « Annuler » la remet exactement où elle était.
   */
  function remove(index: number) {
    const removal = removeQuestion(questions, index);
    if (!removal) return;
    update(() => setQuestions(removal.questions));
    pushUndo("Question supprimée.", () => {
      update(() =>
        setQuestions((current) => insertQuestion(current, removal.index, removal.removed)),
      );
      setFocusKey(removal.removed.key);
      setAnnouncement(`Question ${removal.index + 1} restaurée.`);
    });
  }

  function patch(index: number, changes: Partial<QuestionDraft>) {
    update(() => {
      setQuestions((current) =>
        current.map((question, position) =>
          position === index ? { ...question, ...changes } : question,
        ),
      );
    });
  }

  async function onSave() {
    setBusy(true);
    setError(null);
    try {
      const updated = await saveFormFn({
        data: {
          fileId,
          title: title.trim(),
          description,
          status,
          questions: questions.map((question) => ({
            ...(question.id !== undefined ? { id: question.id } : {}),
            kind: question.kind,
            label: question.label,
            required: question.required,
            options: question.options,
          })),
        },
      });
      setDetail(updated);
      setQuestions(updated.questions.map(toDraft));
      setDirty(false);
      setSaved(true);
      if (tab === "responses") await loadResponses();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Enregistrement impossible.");
    } finally {
      setBusy(false);
    }
  }

  /** Met le focus sur l'intitulé d'une question (après duplication ou annulation). */
  useEffect(() => {
    if (!focusKey) return;
    const field = listRef.current?.querySelector<HTMLInputElement>(
      `input[data-question-key="${focusKey}"]`,
    );
    field?.focus();
    setFocusKey(null);
  }, [focusKey]);

  /**
   * Déplacement au clavier depuis n'importe quel champ de la question :
   * Alt + flèche haut/bas. Les flèches nues gardent leur usage naturel
   * (déplacement du curseur, changement de valeur d'une liste).
   */
  function onQuestionKeyDown(event: React.KeyboardEvent<HTMLLIElement>, index: number) {
    if (!event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    move(index, event.key === "ArrowUp" ? -1 : 1);
  }

  const publicUrl = detail ? `${window.location.origin}/f/${detail.slug}` : "";

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <header className="flex flex-wrap items-center gap-2">
        <a href="/" className="text-sm text-muted-foreground hover:text-foreground">
          ← Formulaires
        </a>
        <div className="ml-auto flex items-center gap-2">
          {dirty ? (
            <span className="text-xs text-attention-foreground">
              Modifications non enregistrées
            </span>
          ) : saved ? (
            <span className="text-xs text-muted-foreground" role="status">
              Enregistré
            </span>
          ) : null}
          <Button size="sm" loading={busy} onClick={() => void onSave()} disabled={!dirty}>
            Enregistrer
          </Button>
        </div>
      </header>

      {error ? <Alert tone="danger">{error}</Alert> : null}

      {detail ? (
        <>
          <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
            <input
              aria-label="Titre du formulaire"
              value={title}
              onChange={(event) => update(() => setTitle(event.target.value))}
              maxLength={255}
              className="w-full border-none bg-transparent font-display text-xl font-semibold tracking-tight outline-none"
            />
            <textarea
              aria-label="Description"
              value={description}
              onChange={(event) => update(() => setDescription(event.target.value))}
              placeholder="Description (facultative)"
              rows={2}
              className="w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
            <div className="flex flex-wrap items-center gap-2">
              <select
                aria-label="Statut"
                value={status}
                onChange={(event) =>
                  update(() => setStatus(event.target.value as FormDetail["status"]))
                }
                className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              >
                {STATUS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <Badge variant={status === "open" ? "accent" : "outline"}>
                {STATUS_OPTIONS.find((option) => option.value === status)?.label ?? status}
              </Badge>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                readOnly
                aria-label="Lien public"
                value={publicUrl}
                className="h-8 max-w-md flex-1 text-xs"
                onFocus={(event) => event.target.select()}
              />
              <Button size="sm" variant="outline" onClick={copyLink}>
                Copier
              </Button>
              <a
                href={`/f/${detail.slug}`}
                target="_blank"
                rel="noreferrer"
                className={buttonVariants({ variant: "outline", size: "sm" })}
              >
                Ouvrir
              </a>
            </div>
          </div>

          <SegmentedTabs
            ariaLabel="Sections du formulaire"
            className="self-start"
            items={[
              { id: "questions", label: "Questions" },
              { id: "responses", label: "Réponses" },
            ]}
            value={tab}
            onChange={(next) => {
              setTab(next);
              if (next === "responses") void loadResponses();
            }}
          />

          {tab === "questions" ? (
            <>
              {questions.length === 0 ? (
                <EmptyState
                  icon={<IconClipboard />}
                  title="Aucune question"
                  hint="Ajoutez une question ci-dessous : texte, choix, échelle, date ou oui / non."
                />
              ) : (
                <ul ref={listRef} className="flex flex-col gap-3">
                  {questions.map((question, index) => (
                    <li
                      key={question.key}
                      onKeyDown={(event) => onQuestionKeyDown(event, index)}
                      className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4"
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium text-muted-foreground">
                          Question {index + 1} sur {questions.length}
                        </span>
                        <div className="ml-auto flex items-center gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label={`Monter la question ${index + 1}`}
                            disabled={index === 0}
                            onClick={() => move(index, -1)}
                          >
                            ↑
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label={`Descendre la question ${index + 1}`}
                            disabled={index === questions.length - 1}
                            onClick={() => move(index, 1)}
                          >
                            ↓
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label={`Dupliquer la question ${index + 1}`}
                            onClick={() => duplicate(index)}
                          >
                            Dupliquer
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-destructive"
                            aria-label={`Supprimer la question ${index + 1}`}
                            onClick={() => remove(index)}
                          >
                            Supprimer
                          </Button>
                        </div>
                      </div>
                      <Input
                        data-question-key={question.key}
                        aria-label="Intitulé de la question"
                        value={question.label}
                        onChange={(event) => patch(index, { label: event.target.value })}
                        placeholder="Votre question…"
                        maxLength={500}
                      />
                      <div className="flex flex-wrap items-center gap-3">
                        <select
                          aria-label="Type de question"
                          value={question.kind}
                          onChange={(event) => {
                            const kind = event.target.value as FormKind;
                            patch(index, {
                              kind,
                              options: kindHasOptions(kind)
                                ? question.options.length >= 2
                                  ? question.options
                                  : ["", ""]
                                : [],
                            });
                          }}
                          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                        >
                          {FORM_KINDS.map((kind) => (
                            <option key={kind} value={kind}>
                              {KIND_LABELS[kind]}
                            </option>
                          ))}
                        </select>
                        <label className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={question.required}
                            onChange={(event) => patch(index, { required: event.target.checked })}
                          />
                          Obligatoire
                        </label>
                      </div>
                      <p className="text-xs text-muted-foreground">{KIND_HINTS[question.kind]}</p>
                      {kindHasOptions(question.kind) && (
                        <div className="flex flex-col gap-2">
                          <Label>Options</Label>
                          {question.options.map((option, optionIndex) => (
                            <div
                              // biome-ignore lint/suspicious/noArrayIndexKey: liste éditable par position, l'index est l'identité de travail (valeurs vides ou dupliquées en cours de saisie).
                              key={`${question.key}-${optionIndex}`}
                              className="flex items-center gap-2"
                            >
                              <Input
                                aria-label={`Option ${optionIndex + 1}`}
                                value={option}
                                onChange={(event) =>
                                  patch(index, {
                                    options: question.options.map((value, position) =>
                                      position === optionIndex ? event.target.value : value,
                                    ),
                                  })
                                }
                                maxLength={200}
                              />
                              <Button
                                size="sm"
                                variant="ghost"
                                aria-label={`Supprimer l'option ${optionIndex + 1}`}
                                onClick={() =>
                                  patch(index, {
                                    options: question.options.filter(
                                      (_, position) => position !== optionIndex,
                                    ),
                                  })
                                }
                              >
                                ✕
                              </Button>
                            </div>
                          ))}
                          <Button
                            size="sm"
                            variant="outline"
                            className="self-start"
                            onClick={() => patch(index, { options: [...question.options, ""] })}
                          >
                            Ajouter une option
                          </Button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}

              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
                  Ajouter :
                </span>
                {FORM_KINDS.map((kind) => (
                  <Button
                    key={kind}
                    size="sm"
                    variant="outline"
                    onClick={() => update(() => setQuestions([...questions, newDraft(kind)]))}
                  >
                    {KIND_LABELS[kind]}
                  </Button>
                ))}
              </div>

              <p className="text-xs text-muted-foreground">
                Au clavier, dans une question : <Kbd>Alt</Kbd> + <Kbd>↑</Kbd> ou <Kbd>↓</Kbd> pour
                la déplacer.
              </p>
            </>
          ) : (
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <p className="text-sm text-muted-foreground">
                  {responsesError
                    ? "Réponses indisponibles."
                    : responses
                      ? `${responses.responses.length} réponse(s)`
                      : "Chargement…"}
                </p>
                <a href={`/api/forms/export/${fileId}`} className="ml-auto">
                  <Button size="sm" variant="outline">
                    Exporter CSV
                  </Button>
                </a>
              </div>
              {responsesError ? (
                <>
                  <Alert tone="danger">{responsesError}</Alert>
                  <Button
                    size="sm"
                    variant="outline"
                    className="self-start"
                    loading={responsesBusy}
                    onClick={() => void loadResponses()}
                  >
                    Réessayer
                  </Button>
                </>
              ) : null}
              {!responsesError && responses && responses.responses.length === 0 ? (
                <p className="rounded-xl border border-border bg-card p-6 text-center text-sm text-muted-foreground">
                  Aucune réponse pour le moment.
                </p>
              ) : null}
              {!responsesError && responses && responses.responses.length > 0 ? (
                <div className="overflow-x-auto rounded-xl border border-border">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-muted/50 text-xs uppercase tracking-widest text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2 font-medium">Date</th>
                        {responses.questions.map((question) => (
                          <th key={question.id} className="px-3 py-2 font-medium">
                            {question.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {responses.responses.map((response) => (
                        <tr key={response.id}>
                          <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                            {new Date(response.submittedAt).toLocaleString("fr-FR")}
                          </td>
                          {responses.questions.map((question) => {
                            const value = response.answers[question.id];
                            return (
                              <td key={question.id} className="px-3 py-2">
                                {Array.isArray(value) ? value.join(", ") : (value ?? "—")}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </div>
          )}
        </>
      ) : !error ? (
        <p className="text-sm text-muted-foreground">Chargement…</p>
      ) : null}

      {announcement ? (
        <p role="status" className="sr-only">
          {announcement}
        </p>
      ) : null}

      <FormsToasts toasts={toasts} dismiss={dismiss} />
    </div>
  );
}
