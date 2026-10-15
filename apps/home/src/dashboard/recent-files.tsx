import type { SuiteAppKey } from "@workspace/config";
import type { DriveEntryView } from "@workspace/drive/server";
import {
  Alert,
  Badge,
  Button,
  cn,
  DOCS_MIME,
  EmptyState,
  FileIcon,
  FORMS_MIME,
  IconFolder,
  Select,
  SHEETS_MIME,
  SLIDES_MIME,
} from "@workspace/ui";
import { useState } from "react";
import { formatRelativeDate, groupRecent } from "./dates.ts";
import { SkeletonGroup, SkeletonRow } from "./skeleton.tsx";

/**
 * Section « Reprendre » — les fichiers récents du tableau de bord.
 *
 * - regroupement par fraîcheur (Aujourd'hui / Cette semaine / Plus tôt) et dates
 *   relatives en français ;
 * - filtre par type, calqué sur les types MIME de la suite ;
 * - chaque ligne ouvre directement le fichier dans son application ;
 * - tous les états sont traités : chargement (squelettes), erreur (avec
 *   nouvelle tentative), vide (illustration + action).
 */

const FILTERS: { value: string; label: string }[] = [
  { value: "all", label: "Tous les types" },
  { value: "document", label: "Documents" },
  { value: "sheet", label: "Feuilles de calcul" },
  { value: "slide", label: "Présentations" },
];

/** Nom lisible d'un filtre, pour les états vides. */
const FILTER_NOUN: Record<string, string> = {
  document: "document",
  sheet: "feuille de calcul",
  slide: "présentation",
};

/** Anneau de focus du design system, répété sur chaque élément interactif. */
const focusRing =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

/** Lien discret réutilisé dans les états et le pied de la section. */
const quietLinkClass = cn(
  "rounded-sm font-medium text-primary underline-offset-4 hover:underline",
  focusRing,
);

/** Lien profond d'un fichier : son application, pas le Drive par défaut. */
export function entryHref(entry: DriveEntryView, urls: Record<SuiteAppKey, string>): string {
  if (entry.kind === "folder") return `${urls.drive}/`;
  if (entry.mimeType === DOCS_MIME) return `${urls.docs}/doc/${entry.id}`;
  if (entry.mimeType === SHEETS_MIME) return `${urls.sheets}/sheet/${entry.id}`;
  if (entry.mimeType === SLIDES_MIME) return `${urls.slides}/slide/${entry.id}`;
  if (entry.mimeType === FORMS_MIME) return `${urls.forms}/form/${entry.id}`;
  return `${urls.drive}/`;
}

function matchesFilter(entry: DriveEntryView, filter: string): boolean {
  if (filter === "document") return entry.mimeType === DOCS_MIME;
  if (filter === "sheet") return entry.mimeType === SHEETS_MIME;
  if (filter === "slide") return entry.mimeType === SLIDES_MIME;
  return true;
}

export function RecentFilesSection({
  entries,
  loading,
  failed,
  onRetry,
  urls,
}: {
  /** `null` tant que la liste n'est pas arrivée. */
  entries: DriveEntryView[] | null;
  loading: boolean;
  failed: boolean;
  onRetry: () => void;
  urls: Record<SuiteAppKey, string>;
}) {
  const [filter, setFilter] = useState("all");

  const visible = (entries ?? []).filter((entry) => matchesFilter(entry, filter));
  const groups = groupRecent(visible);

  return (
    <section aria-labelledby="titre-recents" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2
            id="titre-recents"
            className="text-xs font-medium uppercase tracking-widest text-muted-foreground"
          >
            Reprendre
          </h2>
          <p className="text-sm text-muted-foreground">
            Vos derniers fichiers modifiés, du plus récent au plus ancien.
          </p>
        </div>
        <Select
          label="Filtrer par type"
          options={FILTERS}
          value={filter}
          onChange={setFilter}
          className="w-full sm:w-60"
        />
      </div>

      {failed ? (
        <Alert tone="danger" title="Liste indisponible">
          <div className="flex flex-wrap items-center gap-3">
            <span>Vos fichiers récents n'ont pas pu être chargés.</span>
            <Button variant="outline" size="sm" onClick={onRetry}>
              Réessayer
            </Button>
          </div>
        </Alert>
      ) : loading ? (
        // Squelettes : la place est réservée, la liste ne saute pas à l'arrivée.
        <SkeletonGroup label="Chargement de vos fichiers récents…" className="flex flex-col gap-2">
          {[0, 1, 2].map((index) => (
            <SkeletonRow key={index} />
          ))}
        </SkeletonGroup>
      ) : groups.length === 0 ? (
        <EmptyState
          icon={<IconFolder />}
          title={
            filter === "all"
              ? "Aucun fichier pour l'instant"
              : `Aucun ${FILTER_NOUN[filter] ?? "fichier"} dans vos fichiers récents`
          }
          hint={
            filter === "all"
              ? "Créez une feuille de calcul ou déposez un fichier dans Drive : il apparaîtra ici."
              : "Essayez un autre type pour voir le reste de vos fichiers."
          }
          action={
            filter === "all" ? (
              <a href={`${urls.drive}/`} className={quietLinkClass}>
                Ouvrir Drive
              </a>
            ) : (
              <Button variant="outline" size="sm" onClick={() => setFilter("all")}>
                Voir tous les types
              </Button>
            )
          }
        />
      ) : (
        <div className="flex flex-col gap-5">
          {groups.map((group) => (
            <div key={group.id} className="flex flex-col gap-2">
              <h3 className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
                {group.label}
                <span className="ml-2 font-normal normal-case tracking-normal tabular-nums">
                  {group.entries.length} fichier{group.entries.length > 1 ? "s" : ""}
                </span>
              </h3>
              <ul className="flex flex-col gap-2">
                {group.entries.map((entry) => (
                  <li key={entry.id}>
                    <a
                      href={entryHref(entry, urls)}
                      className={cn(
                        "flex h-11 items-center gap-3 rounded-md border border-border bg-card px-3 text-sm transition-colors hover:bg-muted motion-reduce:transition-none",
                        focusRing,
                      )}
                    >
                      <FileIcon kind={entry.kind} mimeType={entry.mimeType} name={entry.name} />
                      <span className="truncate font-medium">{entry.name}</span>
                      {entry.kind === "folder" ? (
                        <Badge variant="outline" className="shrink-0">
                          Dossier
                        </Badge>
                      ) : null}
                      <span className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground">
                        {formatRelativeDate(entry.updatedAt)}
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <p className="text-xs text-muted-foreground">
            <a href={`${urls.drive}/recent`} className={quietLinkClass}>
              Voir tous mes fichiers récents dans Drive
            </a>
          </p>
        </div>
      )}
    </section>
  );
}
