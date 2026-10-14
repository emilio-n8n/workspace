import { Alert, Button, LoadingState } from "@workspace/ui";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { visibleQuestions } from "../conditions.ts";
import { getPublicFormFn, type PublicForm as PublicFormData, submitResponseFn } from "../server.ts";
import { applyFormTheme } from "../theme.ts";
import { QuestionField } from "./question-field.tsx";

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
  const rootRef = useRef<HTMLElement>(null);

  useEffect(() => {
    void (async () => {
      try {
        setForm(await getPublicFormFn({ data: { slug } }));
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Formulaire introuvable.");
      }
    })();
  }, [slug]);

  // Pose les variables d'accent (tokens) sur le conteneur : elles se propagent
  // au contenu du formulaire, sans effet en dehors.
  useEffect(() => {
    if (rootRef.current && form) applyFormTheme(form.accent, rootRef.current);
  }, [form]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form) return;

    const visible = visibleQuestions(form.questions, answers);

    // Les groupes de cases à cocher n'ont pas de `required` natif : on
    // vérifie côté client (le service revalide de toute façon, sur les seules
    // questions visibles).
    for (const question of visible) {
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
      // Seules les réponses aux questions visibles sont envoyées : une question
      // masquée ne laisse pas de réponse fantôme.
      const payload: Record<string, string | string[]> = {};
      for (const question of visible) {
        const value = answers[question.id];
        if (value !== undefined) payload[question.id] = value;
      }
      await submitResponseFn({ data: { slug, answers: payload } });
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
        <LoadingState label="Chargement du formulaire…" />
      </main>
    );
  }

  const closed = form.status !== "open";
  const visible = visibleQuestions(form.questions, answers);

  return (
    <main ref={rootRef} className="mx-auto flex max-w-xl flex-col gap-5 px-4 py-10">
      <header
        className="flex flex-col gap-1 border-b-2 pb-4"
        style={{ borderColor: "var(--forms-accent, var(--primary))" }}
      >
        <h1 className="font-display text-2xl font-semibold tracking-tight">{form.title}</h1>
        {form.description ? (
          <p className="whitespace-pre-wrap text-sm text-muted-foreground">{form.description}</p>
        ) : null}
      </header>

      {closed ? (
        <Alert tone="warning">Ce formulaire est fermé — les réponses ne sont plus acceptées.</Alert>
      ) : null}

      <form onSubmit={onSubmit} method="post" className="flex flex-col gap-5">
        {visible.map((question) => (
          <QuestionField
            key={question.id}
            question={question}
            name={question.id}
            value={answers[question.id]}
            onChange={(value) => setAnswers((current) => ({ ...current, [question.id]: value }))}
            disabled={closed}
          />
        ))}

        {error ? <Alert tone="danger">{error}</Alert> : null}

        <Button
          type="submit"
          loading={busy}
          disabled={closed}
          className="self-start"
          style={{
            backgroundColor: "var(--forms-accent, var(--primary))",
            color: "var(--forms-accent-foreground, var(--primary-foreground))",
          }}
        >
          Envoyer
        </Button>
      </form>
    </main>
  );
}
