/**
 * Affichage conditionnel simple — logique pure, sans base ni React.
 *
 * Une question peut être liée à une autre : elle ne s'affiche que si la
 * réponse à la question de contrôle vaut exactement une valeur donnée
 * (« afficher si réponse = … »). Une seule condition par question, une seule
 * valeur comparée : assez pour les enchaînements courants (demander la raison
 * seulement si la note est basse, le détail seulement si « Oui »…).
 */
import { type FormKind, SCALE_VALUES, YES_NO_OPTIONS } from "./questions.ts";

/** Condition d'affichage : la question s'affiche si la réponse vaut `equals`. */
export type QuestionCondition = {
  /** Identifiant (serveur) de la question de contrôle, forcément antérieure. */
  questionId: string;
  /** Valeur attendue, comparée telle quelle à la réponse enregistrée. */
  equals: string;
};

/** Ce qu'une question doit exposer pour participer à l'affichage conditionnel. */
export type ConditionalQuestion = {
  /** Identifiant serveur ; absent tant que la question n'est pas enregistrée. */
  id?: string;
  kind: FormKind;
  condition?: QuestionCondition | null;
};

/** Longueur maximale de la valeur comparée (aligne les options à 200 caractères). */
export const MAX_CONDITION_VALUE_CHARS = 200;

/**
 * Vrai si la condition est remplie pour la réponse fournie. Une case à cocher
 * se satisfait dès que la valeur attendue fait partie des cases cochées ; les
 * autres types se comparent à l'identique (chaîne vide ou absence = non rempli).
 */
export function isConditionSatisfied(
  condition: QuestionCondition,
  answer: string | string[] | undefined,
): boolean {
  if (answer === undefined) return false;
  if (Array.isArray(answer)) return answer.includes(condition.equals);
  return answer === condition.equals;
}

/**
 * Questions visibles, dans l'ordre, pour un jeu de réponses. Une condition se
 * résout uniquement contre une question antérieure elle-même visible : si la
 * question de contrôle est masquée, la question dépendante l'est aussi.
 *
 * Une condition irrésoluble (question de contrôle retirée ou déplacée après)
 * laisse la question visible : on ne fait jamais disparaître une question par
 * accident, un formulaire doit rester remplissable.
 */
export function visibleQuestions<T extends ConditionalQuestion>(
  questions: readonly T[],
  answers: Record<string, string | string[]>,
): T[] {
  const visible: T[] = [];
  const visibleById = new Set<string>();

  questions.forEach((question, index) => {
    const condition = question.condition;
    if (!condition) {
      visible.push(question);
      if (question.id) visibleById.add(question.id);
      return;
    }

    const controller = questions.slice(0, index).find((other) => other.id === condition.questionId);
    if (!controller?.id) {
      // Contrôleur introuvable en amont : la condition ne s'applique pas.
      visible.push(question);
      if (question.id) visibleById.add(question.id);
      return;
    }

    if (visibleById.has(controller.id) && isConditionSatisfied(condition, answers[controller.id])) {
      visible.push(question);
      if (question.id) visibleById.add(question.id);
    }
  });

  return visible;
}

/**
 * Questions pouvant servir de contrôle pour la question à `index` : les
 * questions antérieures déjà enregistrées (elles seules ont un identifiant
 * stable auquel une condition peut se rattacher).
 */
export function conditionTargets<T extends ConditionalQuestion>(
  questions: readonly T[],
  index: number,
): (T & { id: string })[] {
  // Sans question courante persistée, aucune condition ne peut être réglée :
  // la condition vit sur la question elle-même, qui n'a pas encore d'identifiant.
  const current = questions[index];
  if (index <= 0 || !current) return [];
  if (typeof current.id !== "string" || current.id.length === 0) return [];
  return questions
    .slice(0, index)
    .filter(
      (question): question is T & { id: string } =>
        typeof question.id === "string" && question.id.length > 0,
    );
}

/**
 * Valeurs proposées pour comparer une réponse, selon le type de la question de
 * contrôle. `null` pour les types à saisie libre (texte court/long, date), où
 * l'éditeur laisse l'utilisateur écrire la valeur attendue.
 */
export function conditionValueOptions(kind: FormKind, options: readonly string[]): string[] | null {
  if (kind === "choice" || kind === "checkbox") {
    return options.map((option) => option.trim()).filter((option) => option.length > 0);
  }
  if (kind === "scale") return [...SCALE_VALUES];
  if (kind === "yes_no") return [...YES_NO_OPTIONS];
  return null;
}

/**
 * Normalise une condition reçue de l'extérieur : forme valide exigée, sinon
 * `null`. Ne vérifie pas l'existence du contrôleur (le service s'en charge,
 * car lui seul connaît les questions conservées).
 */
export function normalizeCondition(value: unknown): QuestionCondition | null {
  if (typeof value !== "object" || value === null) return null;
  const { questionId, equals } = value as { questionId?: unknown; equals?: unknown };
  if (typeof questionId !== "string" || questionId.trim().length === 0) return null;
  if (typeof equals !== "string") return null;
  const clean = equals.trim();
  if (clean.length === 0 || clean.length > MAX_CONDITION_VALUE_CHARS) return null;
  return { questionId, equals: clean };
}
