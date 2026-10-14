import { cn } from "@workspace/ui";
import type { FormKind } from "../questions.ts";
import { SCALE_VALUES, YES_NO_OPTIONS } from "../questions.ts";

/**
 * Rendu d'un champ de réponse, partagé par la page publique et l'aperçu de
 * l'éditeur : l'aperçu montre exactement ce que le répondant verra, sans
 * dupliquer la mise en forme des types.
 */
export type QuestionFieldQuestion = {
  kind: FormKind;
  label: string;
  required: boolean;
  options: string[];
};

export type QuestionFieldProps = {
  question: QuestionFieldQuestion;
  /**
   * Préfixe stable des `name` de boutons radio : identifiant serveur de la
   * question, ou clé de brouillon dans l'éditeur avant enregistrement.
   */
  name: string;
  value: string | string[] | undefined;
  onChange: (value: string | string[]) => void;
  disabled?: boolean;
};

export function QuestionField({
  question,
  name,
  value,
  onChange,
  disabled = false,
}: QuestionFieldProps) {
  return (
    <fieldset className="flex flex-col gap-2" disabled={disabled}>
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
          value={(value as string) ?? ""}
          onChange={(event) => onChange(event.target.value)}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
        />
      ) : null}

      {question.kind === "long_text" ? (
        <textarea
          aria-label={question.label}
          required={question.required}
          maxLength={5000}
          rows={4}
          value={(value as string) ?? ""}
          onChange={(event) => onChange(event.target.value)}
          className="rounded-md border border-input bg-background px-3 py-2 text-sm"
        />
      ) : null}

      {question.kind === "choice"
        ? question.options.map((option) => (
            <label key={option} className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name={name}
                required={question.required}
                checked={value === option}
                onChange={() => onChange(option)}
              />
              {option}
            </label>
          ))
        : null}

      {question.kind === "checkbox"
        ? question.options.map((option) => {
            const values = Array.isArray(value) ? value : [];
            return (
              <label key={option} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={values.includes(option)}
                  onChange={(event) => {
                    const next = event.target.checked
                      ? [...values, option]
                      : values.filter((entry) => entry !== option);
                    onChange(next);
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
            {SCALE_VALUES.map((entry) => (
              <label
                key={entry}
                style={
                  value === entry
                    ? {
                        backgroundColor: "var(--forms-accent, var(--primary))",
                        color: "var(--forms-accent-foreground, var(--primary-foreground))",
                      }
                    : undefined
                }
                className={cn(
                  "grid size-9 cursor-pointer place-items-center rounded-full text-sm",
                  "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-offset-1 has-[:focus-visible]:ring-offset-background",
                  value === entry ? undefined : "border border-input hover:bg-muted",
                )}
              >
                <input
                  type="radio"
                  name={name}
                  required={question.required}
                  className="sr-only"
                  checked={value === entry}
                  onChange={() => onChange(entry)}
                />
                {entry}
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
            value={(value as string) ?? ""}
            onChange={(event) => onChange(event.target.value)}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          />
          <span className="text-xs text-muted-foreground">Format : JJ/MM/AAAA.</span>
        </div>
      ) : null}

      {question.kind === "yes_no" ? (
        <div className="flex flex-wrap items-center gap-4">
          {YES_NO_OPTIONS.map((entry) => (
            <label key={entry} className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name={name}
                required={question.required}
                checked={value === entry}
                onChange={() => onChange(entry)}
              />
              {entry}
            </label>
          ))}
        </div>
      ) : null}
    </fieldset>
  );
}
