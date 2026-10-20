// biome-ignore-all lint/correctness/useExhaustiveDependencies: effets volontairement liés aux seules valeurs stables (handlers recréés à chaque rendu) — arbitrage documenté dans la refonte parité.
import {
  Alert,
  Button,
  buttonVariants,
  cn,
  Dialog,
  EmptyState,
  IconClipboard,
  IconClose,
  IconMore,
  IconPlus,
  IconRedo,
  IconUndo,
  Input,
  Kbd,
  Label,
  LoadingState,
  Menu,
  SegmentedTabs,
} from "@workspace/ui";
import { useCallback, useEffect, useRef, useState } from "react";
import { conditionTargets, conditionValueOptions, type QuestionCondition } from "../conditions.ts";
import {
  duplicateQuestion,
  FORM_KINDS,
  type FormKind,
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
import type { FormAccentId } from "../theme.ts";
import { AccentPicker } from "./accent-picker.tsx";
import { FormPreview } from "./form-preview.tsx";
import { FormsToasts, useFormsToasts } from "./toasts.tsx";

const STATUS_OPTIONS = [
  { value: "draft", label: "Brouillon (non publié)" },
  { value: "open", label: "Ouvert (réponses acceptées)" },
  { value: "closed", label: "Fermé" },
];

/** Classe commune des sélecteurs de la barre d'outils. */
const TOOLBAR_SELECT_CLASS =
  "h-8 rounded-md border border-input bg-background px-1.5 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** Limite de la pile d'historique (annuler / rétablir). */
const HISTORY_LIMIT = 50;

/** Fenêtre de fusion des actions répétées (frappe) dans l'historique. */
const COALESCE_MS = 600;

type QuestionDraft = {
  key: string;
  /** Identifiant serveur conservé pour ne pas orpheliner les réponses. */
  id?: string;
  kind: FormKind;
  label: string;
  required: boolean;
  options: string[];
  /** Affichage conditionnel simple, ou `null`/absent (toujours visible). */
  condition?: QuestionCondition | null;
};

/** Instantané complet pour l'historique : questions et réglages du formulaire. */
type BuilderSnapshot = {
  questions: QuestionDraft[];
  title: string;
  description: string;
  status: FormDetail["status"];
  accent: FormAccentId;
};

function toDraft(question: QuestionView): QuestionDraft {
  return {
    key: crypto.randomUUID(),
    id: question.id,
    kind: question.kind,
    label: question.label,
    required: question.required,
    options: question.options,
    condition: question.condition,
  };
}

function newDraft(kind: FormKind): QuestionDraft {
  return {
    key: crypto.randomUUID(),
    kind,
    label: "",
    required: false,
    options: kindHasOptions(kind) ? ["", ""] : [],
    condition: null,
  };
}

/** Libellé d'une question de contrôle, indexé sur sa position dans la liste. */
function questionLabel(questions: readonly QuestionDraft[], id: string): string {
  const index = questions.findIndex((question) => question.id === id);
  if (index === -1) return "Question supprimée";
  return questions[index]?.label.trim() || `Question ${index + 1}`;
}

/** Cibles clavier qui gardent leur comportement : champs de saisie et dialogues. */
const TYPING_OR_MODAL_SELECTOR =
  "input, textarea, select, [contenteditable='true'], dialog, [role='dialog']";

/** Vrai quand la cible clavier est un champ de saisie ou vit dans un dialogue. */
function isTypingOrModal(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return target.closest(TYPING_OR_MODAL_SELECTOR) !== null;
}

/**
 * Réglage « afficher si réponse = … » d'une question. Les questions de
 * contrôle sont forcément antérieures et déjà enregistrées (elles seules ont
 * un identifiant stable) ; la valeur attendue suit le type du contrôleur
 * (liste pour un choix, l'échelle, oui/non ; saisie libre pour le texte).
 */
function ConditionEditor({
  index,
  question,
  questions,
  onChange,
}: {
  index: number;
  question: QuestionDraft;
  questions: QuestionDraft[];
  onChange: (condition: QuestionCondition | null) => void;
}) {
  const targets = conditionTargets(questions, index);
  const condition = question.condition ?? null;
  const controller = condition
    ? targets.find((target) => target.id === condition.questionId)
    : undefined;

  function changeController(id: string) {
    if (id.length === 0) {
      onChange(null);
      return;
    }
    const target = targets.find((candidate) => candidate.id === id);
    if (!target) {
      onChange(null);
      return;
    }
    const allowed = conditionValueOptions(target.kind, target.options);
    onChange({ questionId: id, equals: allowed?.[0] ?? "" });
  }

  function changeValue(equals: string) {
    if (!controller) return;
    onChange({ questionId: controller.id, equals });
  }

  const allowed = controller ? conditionValueOptions(controller.kind, controller.options) : null;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-muted-foreground">Afficher si</span>
        <select
          aria-label={`Condition d'affichage de la question ${index + 1}`}
          value={controller?.id ?? ""}
          onChange={(event) => changeController(event.target.value)}
          className="h-8 rounded-md border border-input bg-background px-2 text-xs"
        >
          <option value="">Toujours afficher</option>
          {targets.map((target) => (
            <option key={target.id} value={target.id}>
              {questionLabel(questions, target.id)}
            </option>
          ))}
        </select>
        {controller ? (
          <>
            <span className="text-xs text-muted-foreground">réponse =</span>
            {allowed ? (
              <select
                aria-label={`Valeur attendue pour la question ${index + 1}`}
                value={condition?.equals ?? ""}
                onChange={(event) => changeValue(event.target.value)}
                className="h-8 rounded-md border border-input bg-background px-2 text-xs"
              >
                {allowed.map((entry) => (
                  <option key={entry} value={entry}>
                    {entry}
                  </option>
                ))}
              </select>
            ) : (
              <Input
                aria-label={`Valeur attendue pour la question ${index + 1}`}
                value={condition?.equals ?? ""}
                onChange={(event) => changeValue(event.target.value)}
                placeholder="Valeur attendue"
                maxLength={200}
                className="h-8 w-44"
              />
            )}
          </>
        ) : null}
      </div>
      {targets.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {typeof question.id === "string" && question.id.length > 0
            ? "Enregistrez d'abord une question précédente pour y rattacher une condition."
            : "Enregistrez cette question pour pouvoir régler sa condition d'affichage."}
        </p>
      ) : null}
    </div>
  );
}

/** Constructeur de formulaire : questions, statut, lien public et réponses. */
export function FormBuilder({ fileId }: { fileId: string }) {
  const [detail, setDetail] = useState<FormDetail | null>(null);
  const [questions, setQuestions] = useState<QuestionDraft[]>([]);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<FormDetail["status"]>("open");
  const [accent, setAccent] = useState<FormAccentId>("forms");
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
  /** Question dont l'intitulé s'édite en place dans sa carte. */
  const [editingLabelKey, setEditingLabelKey] = useState<string | null>(null);
  /** Question dont la condition d'affichage est ouverte à l'édition. */
  const [conditionKey, setConditionKey] = useState<string | null>(null);
  /** Panneau d'aperçu : fermable, réouvert depuis la barre d'outils. */
  const [previewVisible, setPreviewVisible] = useState(true);
  /** Réglages rares (description, accent, lien public) : dialogue centré. */
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const { toasts, push, dismiss } = useFormsToasts();
  const listRef = useRef<HTMLUListElement>(null);
  /** Historique annuler/rétablir : instantanés empilés, bornés. */
  const pastRef = useRef<BuilderSnapshot[]>([]);
  const futureRef = useRef<BuilderSnapshot[]>([]);
  /** Dernière action poussée : fusionne les répétitions (frappe). */
  const lastPushRef = useRef<{ kind: string; at: number } | null>(null);
  /** Re-rend les boutons Annuler/Rétablir quand les piles changent. */
  const [historyVersion, setHistoryVersion] = useState(0);

  const load = useCallback(async () => {
    try {
      const loaded = await getFormFn({ data: { fileId } });
      setDetail(loaded);
      setTitle(loaded.title);
      setDescription(loaded.description ?? "");
      setStatus(loaded.status);
      setAccent(loaded.accent);
      setQuestions(loaded.questions.map(toDraft));
      // Un rechargement repart d'un historique vierge : rien à annuler avant.
      pastRef.current = [];
      futureRef.current = [];
      lastPushRef.current = null;
      setHistoryVersion((version) => version + 1);
      setEditingLabelKey(null);
      setConditionKey(null);
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

  // -------------------------------------------------------------------------
  // Historique annuler / rétablir
  // -------------------------------------------------------------------------

  /** Instantané de l'état courant, capturé avant chaque action. */
  function capture(): BuilderSnapshot {
    return { questions, title, description, status, accent };
  }

  /** Empile l'état courant avant une action ; les répétitions se fusionnent. */
  function pushHistory(kind: string) {
    const now = Date.now();
    const last = lastPushRef.current;
    if (last && last.kind === kind && now - last.at < COALESCE_MS) {
      last.at = now;
      return;
    }
    pastRef.current = [...pastRef.current, capture()].slice(-HISTORY_LIMIT);
    futureRef.current = [];
    lastPushRef.current = { kind, at: now };
    setHistoryVersion((version) => version + 1);
  }

  /** Remet un instantané en place ; le formulaire redevient « à enregistrer ». */
  function restore(snapshot: BuilderSnapshot) {
    setQuestions(snapshot.questions);
    setTitle(snapshot.title);
    setDescription(snapshot.description);
    setStatus(snapshot.status);
    setAccent(snapshot.accent);
    setEditingLabelKey(null);
    setDirty(true);
    setSaved(false);
  }

  function doUndo() {
    const previous = pastRef.current[pastRef.current.length - 1];
    if (!previous) return;
    pastRef.current = pastRef.current.slice(0, -1);
    futureRef.current = [capture(), ...futureRef.current].slice(0, HISTORY_LIMIT);
    lastPushRef.current = null;
    restore(previous);
    setHistoryVersion((version) => version + 1);
    setAnnouncement("Modification annulée.");
  }

  function doRedo() {
    const [next, ...rest] = futureRef.current;
    if (!next) return;
    futureRef.current = rest;
    pastRef.current = [...pastRef.current, capture()].slice(-HISTORY_LIMIT);
    lastPushRef.current = null;
    restore(next);
    setHistoryVersion((version) => version + 1);
    setAnnouncement("Modification rétablie.");
  }

  const canUndo = historyVersion >= 0 && pastRef.current.length > 0;
  const canRedo = historyVersion >= 0 && futureRef.current.length > 0;

  // Ctrl+Z / Ctrl+Maj+Z / Ctrl+Y hors saisie : les champs de saisie gardent
  // leur annulation native, les dialogues la leur.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!(event.ctrlKey || event.metaKey)) return;
      if (isTypingOrModal(event.target)) return;
      const key = event.key.toLowerCase();
      if (key === "z") {
        event.preventDefault();
        if (event.shiftKey) doRedo();
        else doUndo();
      } else if (key === "y") {
        event.preventDefault();
        doRedo();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [doUndo, doRedo]);

  // -------------------------------------------------------------------------
  // Mutations
  // -------------------------------------------------------------------------

  function update(kind: string, change: () => void) {
    pushHistory(kind);
    change();
    setDirty(true);
    setSaved(false);
  }

  /** Ajoute une question vide et ouvre l'édition en place de son intitulé. */
  function addQuestion(kind: FormKind) {
    const draft = newDraft(kind);
    update("add-question", () => setQuestions((current) => [...current, draft]));
    setEditingLabelKey(draft.key);
    setFocusKey(draft.key);
  }

  /** Déplace une question d'un cran, menu ou clavier (Alt + flèche). */
  function move(index: number, direction: -1 | 1) {
    const next = moveQuestion(questions, index, direction);
    if (!next) return;
    update("move-question", () => setQuestions(next));
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
    update("duplicate-question", () => setQuestions(next));
    const copy = next[index + 1];
    if (copy) setFocusKey(copy.key);
    push("success", "Question dupliquée.");
  }

  /**
   * Supprime une question. L'opération est annulable par l'historique
   * (Ctrl+Z ou le bouton Annuler de la barre) : la question revient à sa
   * position d'origine.
   */
  function remove(index: number) {
    const draft = questions[index];
    const removal = removeQuestion(questions, index);
    if (!draft || !removal) return;
    update("remove-question", () => setQuestions(removal.questions));
    setEditingLabelKey((key) => (key === draft.key ? null : key));
    setConditionKey((key) => (key === draft.key ? null : key));
    setAnnouncement(`Question ${removal.index + 1} supprimée — Ctrl+Z pour annuler.`);
  }

  function patch(index: number, changes: Partial<QuestionDraft>, kind: string) {
    update(kind, () => {
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
          accent,
          questions: questions.map((question) => ({
            ...(question.id !== undefined ? { id: question.id } : {}),
            kind: question.kind,
            label: question.label,
            required: question.required,
            options: question.options,
            condition:
              question.condition && question.condition.equals.trim().length > 0
                ? question.condition
                : null,
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

  /** Met le focus sur l'intitulé d'une question (ajout, duplication). */
  useEffect(() => {
    if (!focusKey) return;
    const field = listRef.current?.querySelector<HTMLElement>(`[data-question-key="${focusKey}"]`);
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
    const target = event.target as Element | null;
    if (target?.closest("[role='menu']")) return;
    event.preventDefault();
    move(index, event.key === "ArrowUp" ? -1 : 1);
  }

  const publicUrl = detail ? `${window.location.origin}/f/${detail.slug}` : "";

  return (
    <div className="forms-builder flex h-full min-h-0 flex-1 flex-col">
      <header className="flex flex-wrap items-center gap-2 border-b border-border bg-card px-3 py-2">
        <a
          href="/"
          className="rounded-md px-1.5 py-1 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          ← Formulaires
        </a>
        <input
          aria-label="Titre du formulaire"
          value={title}
          onChange={(event) => update("title", () => setTitle(event.target.value))}
          placeholder="Formulaire sans titre"
          maxLength={255}
          className="min-w-40 flex-1 border-none bg-transparent px-1 font-display text-base font-medium tracking-tight outline-none"
        />
        {dirty ? (
          <span className="text-xs text-attention-foreground">Modifications non enregistrées</span>
        ) : saved ? (
          <span className="text-xs text-muted-foreground" role="status">
            Enregistré
          </span>
        ) : null}
        <SegmentedTabs
          ariaLabel="Sections du formulaire"
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
        <Button size="sm" loading={busy} onClick={() => void onSave()} disabled={!dirty}>
          Enregistrer
        </Button>
      </header>

      {error ? (
        <div className="px-3 pt-3">
          <Alert tone="danger">{error}</Alert>
        </div>
      ) : null}

      {!detail ? (
        !error ? (
          <LoadingState className="py-12" label="Chargement du formulaire…" size={20} />
        ) : null
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <div
            role="toolbar"
            aria-label="Outils du formulaire"
            className="flex flex-nowrap items-center gap-0.5 border-b border-border bg-card px-2 py-1"
          >
            <div className="flex min-w-0 flex-1 flex-nowrap items-center gap-0.5 overflow-x-auto [&>*]:shrink-0">
              <Button
                size="sm"
                variant="ghost"
                aria-label="Annuler"
                title="Annuler (Ctrl+Z)"
                disabled={!canUndo}
                onClick={doUndo}
              >
                <IconUndo />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                aria-label="Rétablir"
                title="Rétablir (Ctrl+Maj+Z)"
                disabled={!canRedo}
                onClick={doRedo}
              >
                <IconRedo />
              </Button>
              <span aria-hidden className="mx-1 h-4 w-px shrink-0 bg-border" />

              <select
                aria-label="Statut"
                value={status}
                onChange={(event) =>
                  update("status", () => setStatus(event.target.value as FormDetail["status"]))
                }
                className={TOOLBAR_SELECT_CLASS}
              >
                {STATUS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <span aria-hidden className="mx-1 h-4 w-px shrink-0 bg-border" />

              {FORM_KINDS.map((kind) => (
                <Button
                  key={kind}
                  size="sm"
                  variant="ghost"
                  className="font-medium"
                  onClick={() => addQuestion(kind)}
                >
                  <IconPlus />
                  {KIND_LABELS[kind]}
                </Button>
              ))}
            </div>

            <span aria-hidden className="mx-1 h-4 w-px shrink-0 bg-border" />
            <Button
              size="sm"
              variant="ghost"
              className="shrink-0"
              aria-pressed={previewVisible}
              onClick={() => setPreviewVisible((visible) => !visible)}
            >
              Aperçu
            </Button>
            <a
              href={`/f/${detail.slug}`}
              target="_blank"
              rel="noreferrer"
              className={cn("shrink-0", buttonVariants({ variant: "ghost", size: "sm" }))}
            >
              Ouvrir
            </a>
            <Menu
              label="Autres actions du formulaire"
              align="end"
              className="shrink-0"
              triggerClassName="h-8 w-8 border-transparent bg-transparent px-0 hover:bg-muted focus-visible:ring-offset-0"
              triggerIcon={<IconMore />}
              items={[
                { id: "copy-link", label: "Copier le lien", onSelect: copyLink },
                {
                  id: "settings",
                  label: "Description et couleur…",
                  separated: true,
                  onSelect: () => setSettingsOpen(true),
                },
              ]}
            />
          </div>

          {tab === "questions" ? (
            <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
              <div className="min-h-0 flex-1 overflow-y-auto p-3 md:p-4">
                <div className="mx-auto flex w-full max-w-3xl flex-col gap-3">
                  {questions.length === 0 ? (
                    <EmptyState
                      icon={<IconClipboard />}
                      title="Aucune question"
                      hint="Ajoutez une question depuis la barre d'outils : texte, choix, échelle, date ou oui / non."
                    />
                  ) : (
                    <ul ref={listRef} className="flex flex-col gap-3">
                      {questions.map((question, index) => (
                        <li
                          key={question.key}
                          onKeyDown={(event) => onQuestionKeyDown(event, index)}
                          className="flex flex-col gap-2.5 rounded-xl border border-border bg-card p-3"
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-medium text-muted-foreground">
                              Question {index + 1} sur {questions.length}
                            </span>
                            <div className="ml-auto flex items-center gap-1">
                              <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                <input
                                  type="checkbox"
                                  checked={question.required}
                                  onChange={(event) =>
                                    patch(
                                      index,
                                      { required: event.target.checked },
                                      `required-${question.key}`,
                                    )
                                  }
                                />
                                Obligatoire
                              </label>
                              <Menu
                                label={`Actions de la question ${index + 1}`}
                                align="end"
                                triggerClassName="h-7 w-7 border-transparent bg-transparent px-0 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-offset-0"
                                triggerIcon={<IconMore />}
                                items={[
                                  {
                                    id: "up",
                                    label: "Monter",
                                    disabled: index === 0,
                                    onSelect: () => move(index, -1),
                                  },
                                  {
                                    id: "down",
                                    label: "Descendre",
                                    disabled: index === questions.length - 1,
                                    onSelect: () => move(index, 1),
                                  },
                                  {
                                    id: "duplicate",
                                    label: "Dupliquer",
                                    onSelect: () => duplicate(index),
                                  },
                                  {
                                    id: "condition",
                                    label: "Condition d'affichage…",
                                    separated: true,
                                    onSelect: () =>
                                      setConditionKey(
                                        conditionKey === question.key ? null : question.key,
                                      ),
                                  },
                                  {
                                    id: "delete",
                                    label: "Supprimer",
                                    separated: true,
                                    destructive: true,
                                    onSelect: () => remove(index),
                                  },
                                ]}
                              />
                            </div>
                          </div>

                          {editingLabelKey === question.key ? (
                            <Input
                              data-question-key={question.key}
                              aria-label="Intitulé de la question"
                              value={question.label}
                              onChange={(event) =>
                                patch(index, { label: event.target.value }, `label-${question.key}`)
                              }
                              onBlur={() => setEditingLabelKey(null)}
                              onKeyDown={(event) => {
                                if (event.key === "Enter" || event.key === "Escape") {
                                  event.preventDefault();
                                  setEditingLabelKey(null);
                                }
                              }}
                              placeholder="Votre question…"
                              maxLength={500}
                            />
                          ) : (
                            <button
                              type="button"
                              data-question-key={question.key}
                              onClick={() => {
                                setEditingLabelKey(question.key);
                                setFocusKey(question.key);
                              }}
                              className="w-full rounded-md px-2 py-1.5 text-left text-sm font-medium transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            >
                              {question.label.trim().length > 0 ? (
                                question.label
                              ) : (
                                <span className="text-muted-foreground">Votre question…</span>
                              )}
                            </button>
                          )}

                          <div className="flex flex-wrap items-center gap-2">
                            <select
                              aria-label="Type de question"
                              value={question.kind}
                              onChange={(event) => {
                                const kind = event.target.value as FormKind;
                                patch(
                                  index,
                                  {
                                    kind,
                                    options: kindHasOptions(kind)
                                      ? question.options.length >= 2
                                        ? question.options
                                        : ["", ""]
                                      : [],
                                  },
                                  `kind-${question.key}`,
                                );
                              }}
                              className={TOOLBAR_SELECT_CLASS}
                            >
                              {FORM_KINDS.map((kind) => (
                                <option key={kind} value={kind}>
                                  {KIND_LABELS[kind]}
                                </option>
                              ))}
                            </select>
                            <p className="text-xs text-muted-foreground">
                              {KIND_HINTS[question.kind]}
                            </p>
                          </div>

                          {kindHasOptions(question.kind) ? (
                            <div className="flex flex-col gap-1.5">
                              <span className="text-xs font-medium text-muted-foreground">
                                Options
                              </span>
                              {question.options.map((option, optionIndex) => (
                                <div
                                  // biome-ignore lint/suspicious/noArrayIndexKey: liste éditable par position, l'index est l'identité de travail (valeurs vides ou dupliquées en cours de saisie).
                                  key={`${question.key}-${optionIndex}`}
                                  className="flex items-center gap-1.5"
                                >
                                  <Input
                                    aria-label={`Option ${optionIndex + 1}`}
                                    value={option}
                                    className="h-8"
                                    onChange={(event) =>
                                      patch(
                                        index,
                                        {
                                          options: question.options.map((value, position) =>
                                            position === optionIndex ? event.target.value : value,
                                          ),
                                        },
                                        `option-${question.key}-${optionIndex}`,
                                      )
                                    }
                                    maxLength={200}
                                  />
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    aria-label={`Supprimer l'option ${optionIndex + 1}`}
                                    className="text-muted-foreground hover:text-destructive"
                                    onClick={() =>
                                      patch(
                                        index,
                                        {
                                          options: question.options.filter(
                                            (_, position) => position !== optionIndex,
                                          ),
                                        },
                                        `options-${question.key}`,
                                      )
                                    }
                                  >
                                    <IconClose />
                                  </Button>
                                </div>
                              ))}
                              <Button
                                size="sm"
                                variant="ghost"
                                className="self-start text-xs text-muted-foreground"
                                onClick={() =>
                                  patch(
                                    index,
                                    { options: [...question.options, ""] },
                                    `options-${question.key}`,
                                  )
                                }
                              >
                                <IconPlus className="size-3.5" />
                                Ajouter une option
                              </Button>
                            </div>
                          ) : null}

                          {question.condition || conditionKey === question.key ? (
                            <div className="rounded-lg border border-dashed border-border p-3">
                              <ConditionEditor
                                index={index}
                                question={question}
                                questions={questions}
                                onChange={(condition) => {
                                  patch(index, { condition }, `condition-${question.key}`);
                                  if (!condition) setConditionKey(null);
                                }}
                              />
                            </div>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  )}

                  <p className="text-xs text-muted-foreground">
                    Au clavier : <Kbd>Alt</Kbd> + <Kbd>↑</Kbd> ou <Kbd>↓</Kbd> dans une question
                    pour la déplacer, <Kbd>Ctrl</Kbd> + <Kbd>Z</Kbd> pour annuler.
                  </p>
                </div>
              </div>

              {previewVisible ? (
                <aside className="max-h-72 shrink-0 overflow-y-auto border-t border-border bg-muted/40 p-3 md:p-4 lg:max-h-none lg:w-[22rem] lg:border-l lg:border-t-0">
                  <FormPreview
                    title={title}
                    description={description}
                    questions={questions}
                    accent={accent}
                    onClose={() => setPreviewVisible(false)}
                  />
                </aside>
              ) : null}
            </div>
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto p-3 md:p-4">
              <div className="mx-auto flex w-full max-w-4xl flex-col gap-3">
                <div className="flex items-center gap-2">
                  <p className="text-sm text-muted-foreground">
                    {responsesError
                      ? "Réponses indisponibles."
                      : responses
                        ? `${responses.responses.length} réponse(s)`
                        : "Chargement…"}
                  </p>
                  <a
                    href={`/api/forms/export/${fileId}`}
                    className={cn("ml-auto", buttonVariants({ variant: "outline", size: "sm" }))}
                  >
                    Exporter CSV
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
            </div>
          )}
        </div>
      )}

      {/* Réglages rares : description, couleur d'accent, lien public. */}
      <Dialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        title="Réglages du formulaire"
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="form-description">Description</Label>
            <textarea
              id="form-description"
              aria-label="Description"
              value={description}
              onChange={(event) => update("description", () => setDescription(event.target.value))}
              placeholder="Description (facultative)"
              rows={3}
              className="w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
          </div>

          <AccentPicker value={accent} onChange={(id) => update("accent", () => setAccent(id))} />

          <div className="flex flex-col gap-2">
            <Label htmlFor="form-public-link">Lien public</Label>
            <div className="flex items-center gap-2">
              <Input
                id="form-public-link"
                readOnly
                aria-label="Lien public"
                value={publicUrl}
                className="h-8 min-w-0 flex-1 text-xs"
                onFocus={(event) => event.target.select()}
              />
              <Button size="sm" variant="outline" onClick={copyLink}>
                Copier
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Partagez ce lien : le formulaire public ne demande pas de compte.
            </p>
          </div>
        </div>
      </Dialog>

      {announcement ? (
        <p role="status" className="sr-only">
          {announcement}
        </p>
      ) : null}

      <FormsToasts toasts={toasts} dismiss={dismiss} />
    </div>
  );
}
