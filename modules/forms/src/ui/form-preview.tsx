import { useEffect, useRef, useState } from "react";
import { type QuestionCondition, visibleQuestions } from "../conditions.ts";
import type { FormKind } from "../questions.ts";
import { applyFormTheme } from "../theme.ts";
import { QuestionField } from "./question-field.tsx";

/** Brouillon de question tel que l'aperçu le consomme (sous-ensemble de l'éditeur). */
export type PreviewQuestion = {
  key: string;
  id?: string;
  kind: FormKind;
  label: string;
  required: boolean;
  options: string[];
  condition?: QuestionCondition | null;
};

function answerKey(question: PreviewQuestion): string {
  return question.id ?? question.key;
}

/**
 * Aperçu en direct : rend le formulaire tel que la page publique l'affiche,
 * à partir des brouillons de l'éditeur (intitulés, types, options, conditions,
 * accent). Il est interactif — répondre dans l'aperçu montre l'affichage
 * conditionnel se déclencher, comme chez le répondant.
 */
export function FormPreview({
  title,
  description,
  questions,
  accent,
  onClose,
}: {
  title: string;
  description: string;
  questions: PreviewQuestion[];
  accent: string;
  /** Fermeture du panneau d'aperçu (croix visible en en-tête). */
  onClose?: () => void;
}) {
  const [answers, setAnswers] = useState<Record<string, string | string[]>>({});
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (rootRef.current) applyFormTheme(accent, rootRef.current);
  }, [accent]);

  const visible = visibleQuestions(questions, answers);

  return (
    <section
      aria-label="Aperçu du formulaire"
      className="flex flex-col gap-2 rounded-xl border border-border bg-card shadow-soft"
    >
      <p className="flex items-center gap-2 border-b border-border px-4 py-2 text-xs font-medium uppercase tracking-widest text-muted-foreground">
        <span className="min-w-0 flex-1">Aperçu en direct</span>
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer l'aperçu"
            className="grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            ✕
          </button>
        ) : null}
      </p>
      <div ref={rootRef} className="flex flex-col gap-4 px-4 py-4">
        <header
          className="flex flex-col gap-1 border-b-2 pb-3"
          style={{ borderColor: "var(--forms-accent, var(--primary))" }}
        >
          <p className="font-display text-lg font-semibold tracking-tight">
            {title.trim().length > 0 ? title : "Formulaire sans titre"}
          </p>
          {description.trim().length > 0 ? (
            <p className="whitespace-pre-wrap text-xs text-muted-foreground">{description}</p>
          ) : null}
        </header>

        {visible.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Ajoutez une question : elle apparaîtra ici, telle qu'elle sera posée.
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            {visible.map((question) => {
              const key = answerKey(question);
              return (
                <QuestionField
                  key={question.key}
                  question={{
                    ...question,
                    options: question.options.filter((option) => option.trim().length > 0),
                  }}
                  name={key}
                  value={answers[key]}
                  onChange={(value) => setAnswers((current) => ({ ...current, [key]: value }))}
                />
              );
            })}
          </div>
        )}

        <span
          aria-hidden
          className="pointer-events-none self-start rounded-md px-3 py-1.5 text-sm font-medium"
          style={{
            backgroundColor: "var(--forms-accent, var(--primary))",
            color: "var(--forms-accent-foreground, var(--primary-foreground))",
          }}
        >
          Envoyer
        </span>
      </div>
    </section>
  );
}
