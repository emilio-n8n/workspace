import type { SuiteAppKey } from "@workspace/config";
import { createSpreadsheetFn } from "@workspace/sheets/server";
import { createPresentationFn } from "@workspace/slides/server";
import {
  Alert,
  IconCalendar,
  IconCheckSquare,
  IconClipboard,
  IconFileText,
  IconGrid,
  IconPresentation,
  Tooltip,
} from "@workspace/ui";
import { type ReactNode, useState } from "react";

/**
 * Actions rapides du tableau de bord.
 *
 * Deux familles, annoncées sans ambiguïté :
 * - **création réelle** : feuille de calcul et présentation sont créées par un
 *   appel serveur, puis l'application concernée s'ouvre dessus. Le clic crée,
 *   sans écran intermédiaire — comme le menu « Nouveau » de Drive ;
 * - **navigation** : document, formulaire, évènement et tâche se créent dans
 *   l'application qui les porte (Docs, Forms, Calendar, Tasks). La carte y mène
 *   directement et le dit : aucune action qui promet une création qu'elle ne
 *   fait pas.
 *
 * Le clic crée sans écran intermédiaire (contrat déjà en place côté Drive et
 * côté parcours e2e) ; le titre par défaut porte la date et l'heure du jour
 * (« Feuille du 13 octobre 2026 à 14 h 32 »), donc le fichier est identifiable
 * immédiatement et deux créations le même jour ne se marchent pas dessus. Le
 * titre se corrige en un clic dans l'en-tête de l'application qui s'ouvre.
 */

export type CreateKind = "sheet" | "slides";

/** Libellés et messages, alignés sur ceux de Drive. */
const CREATION: Record<
  CreateKind,
  { label: string; description: string; noun: string; app: string; error: string }
> = {
  sheet: {
    label: "Nouvelle feuille de calcul",
    description: "Tableur collaboratif",
    noun: "Feuille",
    app: "Sheets",
    error: "Création de la feuille impossible.",
  },
  slides: {
    label: "Nouvelle présentation",
    description: "Diaporama collaboratif",
    noun: "Présentation",
    app: "Slides",
    error: "Création de la présentation impossible.",
  },
};

/**
 * Titre par défaut — « Feuille du 13 octobre 2026 à 14 h 32 ».
 *
 * La date et l'heure distinguent deux créations le même jour : deux fichiers
 * homonymes dans un même dossier sont refusés par le service. Le titre se
 * corrige ensuite en un clic dans l'en-tête de l'application ouverte.
 */
function defaultTitle(noun: string): string {
  const now = new Date();
  const date = new Intl.DateTimeFormat("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(now);
  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");
  return `${noun} du ${date} à ${hours} h ${minutes}`;
}

const cardClass =
  "flex h-full flex-col gap-2 rounded-xl border border-border bg-card p-4 text-left shadow-soft transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none";

/** Carte d'action menant à une autre application de la suite. */
function QuickActionLink({
  icon,
  label,
  description,
  href,
  tooltip,
}: {
  icon: ReactNode;
  label: string;
  description: string;
  href: string;
  tooltip: string;
}) {
  return (
    <Tooltip content={tooltip}>
      <a href={href} className={cardClass}>
        {icon}
        <span className="font-display text-sm font-semibold">{label}</span>
        <span className="text-xs text-muted-foreground">{description}</span>
      </a>
    </Tooltip>
  );
}

/** Carte de création : état d'attente visible, création puis navigation. */
function QuickActionCreate({
  kind,
  icon,
  busy,
  onSelect,
}: {
  kind: CreateKind;
  icon: ReactNode;
  busy: boolean;
  onSelect: () => void;
}) {
  const config = CREATION[kind];
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-busy={busy || undefined}
      disabled={busy}
      className={`${cardClass} disabled:cursor-wait disabled:opacity-60`}
    >
      {icon}
      <span className="font-display text-sm font-semibold">{config.label}</span>
      <span className="text-xs text-muted-foreground">
        {busy ? "Création…" : config.description}
      </span>
      {busy ? <span className="sr-only">Création en cours dans {config.app}.</span> : null}
    </button>
  );
}

export function ShortcutsSection({ urls }: { urls: Record<SuiteAppKey, string> }) {
  const [busyKind, setBusyKind] = useState<CreateKind | null>(null);
  /** Annonce polie de l'avancement (région `role="status"`). */
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function create(kind: CreateKind): Promise<void> {
    if (busyKind !== null) return;
    const config = CREATION[kind];

    setBusyKind(kind);
    setError(null);
    setStatus(`Création : ${config.label.toLowerCase()}.`);
    try {
      const title = defaultTitle(config.noun);
      const created =
        kind === "sheet"
          ? await createSpreadsheetFn({ data: { parentFolderId: null, title } })
          : await createPresentationFn({ data: { parentFolderId: null, title } });
      setStatus(`${config.noun} créée — ouverture de ${config.app}.`);
      window.location.assign(
        kind === "sheet"
          ? `${urls.sheets}/sheet/${created.fileId}`
          : `${urls.slides}/slide/${created.fileId}`,
      );
    } catch (caught) {
      setStatus("");
      setError(caught instanceof Error ? caught.message : config.error);
    } finally {
      setBusyKind(null);
    }
  }

  return (
    <section aria-labelledby="titre-raccourcis" className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2
          id="titre-raccourcis"
          className="text-xs font-medium uppercase tracking-widest text-muted-foreground"
        >
          Raccourcis
        </h2>
        <p className="text-sm text-muted-foreground">
          Feuilles et présentations se créent ici ; les autres fichiers s'ouvrent dans leur
          application.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <QuickActionLink
          icon={<IconFileText className="size-5 text-app-docs" />}
          label="Nouveau document"
          description="Traitement de texte"
          href={`${urls.docs}/`}
          tooltip="Ouvre Documents : vous y saisissez le titre"
        />
        <QuickActionCreate
          kind="sheet"
          icon={<IconGrid className="size-5 text-app-sheets" />}
          busy={busyKind === "sheet"}
          onSelect={() => void create("sheet")}
        />
        <QuickActionCreate
          kind="slides"
          icon={<IconPresentation className="size-5 text-app-slides" />}
          busy={busyKind === "slides"}
          onSelect={() => void create("slides")}
        />
        <QuickActionLink
          icon={<IconClipboard className="size-5 text-app-forms" />}
          label="Nouveau formulaire"
          description="Formulaires et réponses"
          href={`${urls.forms}/`}
          tooltip="Ouvre Forms pour composer le formulaire"
        />
        <QuickActionLink
          icon={<IconCalendar className="size-5 text-app-calendar" />}
          label="Nouvel évènement"
          description="Ouvrir l'agenda"
          href={`${urls.calendar}/`}
          tooltip="Ouvre Calendar : l'événement se crée dans l'agenda"
        />
        <QuickActionLink
          icon={<IconCheckSquare className="size-5 text-app-tasks" />}
          label="Nouvelle tâche"
          description="Ouvrir les tâches"
          href={`${urls.tasks}/`}
          tooltip="Ouvre Tasks : la tâche y est ajoutée"
        />
      </div>

      {/* Région annonce : progression puis erreur actionnable. */}
      <p role="status" className="sr-only">
        {status}
      </p>
      {error ? (
        <Alert tone="danger" title="Création impossible">
          {error}
        </Alert>
      ) : null}
    </section>
  );
}
