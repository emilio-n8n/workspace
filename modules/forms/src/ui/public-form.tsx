import { Alert, Button, cn } from "@workspace/ui";
import { type FormEvent, useEffect, useState } from "react";
import { SCALE_VALUES, YES_NO_OPTIONS } from "../questions.ts";
import { getPublicFormFn, type PublicForm as PublicFormData, submitResponseFn } from "../server.ts";

/**
 * Page publique de collecte (aucune session) : autorisée par le statut `open`
 * du formulaire. Voir docs/modules/forms.md (limites et garde-fous).
 */
export function PublicForm({ slug }: { slug: string }) {
  const [form, setForm] = useState<PublicFormData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, string | string[]>>({});
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        setForm(await getPublicFormFn({ data: { slug } }));
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Formulaire introuvable.");
      }
    })();
  }, [slug]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form) return;

    // Les groupes de cases à cocher n'ont pas de `required` natif : on
    // vérifie côté client (le service revalide de toute façon).
    for (const question of form.questions) {
      if (question.kind !== "checkbox" || !question.required) continue;
      const value = answers[question.id];
      if (!Array.isArray(value) || value.length === 0) {
        setError(`« ${question.label} » est obligatoire.`);
        return;
      }
    }

    setBusy(true);
    setError(null);
    try {
      await submitResponseFn({ data: { slug, answers } });
      setSubmitted(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Envoi impossible.");
    } finally {
      setBusy(false);
    }
  }

  if (submitted) {
    return (
      <main className="mx-auto flex max-w-xl flex-col items-center gap-3 px-4 py-16 text-center">
        <h1 className="font-display text-2xl font-semibold tracking-tight">Merci !</h1>
        <p className="text-sm text-muted-foreground">Votre réponse a été enregistrée.</p>
      </main>
    );
  }

  if (error && !form) {
    return (
      <main className="mx-auto flex max-w-xl flex-col gap-3 px-4 py-16">
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      </main>
    );
  }

  if (!form) {
    return (
      <main className="mx-auto max-w-xl px-4 py-16">
        <p className="text-sm text-muted-foreground">Chargement…</p>
      </main>
    );
  }

  const closed = form.status !== "open";

  return (
    <main className="mx-auto flex max-w-xl flex-col gap-5 px-4 py-10">
      <header className="flex flex-col gap-1 border-b border-border pb-4">
        <h1 className="font-display text-2xl font-semibold tracking-tight">{form.title}</h1>
        {form.description ? (
          <p className="whitespace-pre-wrap text-sm text-muted-foreground">{form.description}</p>
        ) : null}
      </header>

      {closed ? (
        <Alert tone="warning">Ce formulaire est fermé — les réponses ne sont plus acceptées.</Alert>
      ) : null}

      <form onSubmit={onSubmit} method="post" className="flex flex-col gap-5">
        {form.questions.map((question) => (
          <fieldset key={question.id} className="flex flex-col gap-2" disabled={closed}>
            <legend className="text-sm font-medium">
              {question.label}
              {question.required ? (
                <span className="text-destructive">
                  {" *"}
                  <span className="sr-only">(obligatoire)</span>
                </span>
              ) : null}
            </legend>

            {question.kind === "short_text" ? (
              <input
                type="text"
                aria-label={question.label}
                required={question.required}
                maxLength={5000}
                value={(answers[question.id] as string) ?? ""}
                onChange={(event) =>
                  setAnswers((current) => ({ ...current, [question.id]: event.target.value }))
                }
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              />
            ) : null}

            {question.kind === "long_text" ? (
              <textarea
                aria-label={question.label}
                required={question.required}
                maxLength={5000}
                rows={4}
                value={(answers[question.id] as string) ?? ""}
                onChange={(event) =>
                  setAnswers((current) => ({ ...current, [question.id]: event.target.value }))
                }
                className="rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            ) : null}

            {question.kind === "choice"
              ? question.options.map((option) => (
                  <label key={option} className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name={question.id}
                      required={question.required}
                      checked={answers[question.id] === option}
                      onChange={() =>
                        setAnswers((current) => ({ ...current, [question.id]: option }))
                      }
                    />
                    {option}
                  </label>
                ))
              : null}

            {question.kind === "checkbox"
              ? question.options.map((option) => {
                  const values = Array.isArray(answers[question.id])
                    ? (answers[question.id] as string[])
                    : [];
                  return (
                    <label key={option} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={values.includes(option)}
                        onChange={(event) => {
                          const next = event.target.checked
                            ? [...values, option]
                            : values.filter((value) => value !== option);
                          setAnswers((current) => ({ ...current, [question.id]: next }));
                        }}
                      />
                      {option}
                    </label>
                  );
                })
              : null}

            {question.kind === "scale" ? (
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  {SCALE_VALUES.map((value) => (
                    <label
                      key={value}
                      className={cn(
                        "grid size-9 cursor-pointer place-items-center rounded-full text-sm",
                        "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-offset-1 has-[:focus-visible]:ring-offset-background",
                        answers[question.id] === value
                          ? "bg-primary text-primary-foreground"
                          : "border border-input hover:bg-muted",
                      )}
                    >
                      <input
                        type="radio"
                        name={question.id}
                        required={question.required}
                        className="sr-only"
                        checked={answers[question.id] === value}
                        onChange={() =>
                          setAnswers((current) => ({ ...current, [question.id]: value }))
                        }
                      />
                      {value}
                    </label>
                  ))}
                </div>
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>1 = pas satisfait</span>
                  <span>5 = très satisfait</span>
                </div>
              </div>
            ) : null}

            {question.kind === "date" ? (
              <div className="flex flex-col gap-1">
                <input
                  type="date"
                  aria-label={question.label}
                  required={question.required}
                  value={(answers[question.id] as string) ?? ""}
                  onChange={(event) =>
                    setAnswers((current) => ({ ...current, [question.id]: event.target.value }))
                  }
                  className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                />
                <span className="text-xs text-muted-foreground">Format : JJ/MM/AAAA.</span>
              </div>
            ) : null}

            {question.kind === "yes_no" ? (
              <div className="flex flex-wrap items-center gap-4">
                {YES_NO_OPTIONS.map((value) => (
                  <label key={value} className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name={question.id}
                      required={question.required}
                      checked={answers[question.id] === value}
                      onChange={() =>
                        setAnswers((current) => ({ ...current, [question.id]: value }))
                      }
                    />
                    {value}
                  </label>
                ))}
              </div>
            ) : null}
          </fieldset>
        ))}

        {error ? <Alert tone="danger">{error}</Alert> : null}

        <Button type="submit" loading={busy} disabled={closed} className="self-start">
          Envoyer
        </Button>
      </form>
    </main>
  );
}
