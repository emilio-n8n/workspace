// biome-ignore-all lint/a11y/noSvgWithoutTitle: SVG décoratifs (curseurs distants), déjà masqués par aria-hidden.
import { cn, IconCalendar, IconFileText, IconFolder, IconGrid } from "@workspace/ui";
import type { ReactNode } from "react";

/*
 * Fenêtres produit de la section « Captures » : des reconstitutions riches
 * (barre de fenêtre, barre d'outils, contenu réel) plutôt que des captures
 * d'écran — aucune requête réseau, aucun fichier binaire à maintenir, et le
 * rendu suit les jetons sémantiques comme le reste de la page.
 *
 * Le vocabulaire visuel est emprunté aux vrais écrans de la suite : pastilles
 * de fenêtre, indicateur « enregistré », présence avec initiales, curseurs
 * distants, cartes de statistiques flottantes.
 */

/** Pastille d'application de la barre d'outils. */
function AppMark({ tone, children }: { tone: string; children: ReactNode }) {
  return (
    <span className={cn("grid size-6 shrink-0 place-items-center rounded-md text-white", tone)}>
      {children}
    </span>
  );
}

/** Avatars de présence — initiales plutôt que photos. */
function Presence() {
  const people = [
    { initials: "JD", tone: "bg-app-sheets" },
    { initials: "NE", tone: "bg-app-calendar" },
    { initials: "SL", tone: "bg-app-mail" },
    { initials: "BL", tone: "bg-app-drive" },
  ];
  return (
    <span className="flex items-center gap-1.5">
      <span className="flex items-center gap-1 rounded-full border border-destructive/40 px-2 py-0.5 text-[10px] font-medium text-destructive">
        <span className="size-1.5 rounded-full bg-destructive" />
        EN DIRECT
      </span>
      <span className="flex -space-x-1.5">
        {people.map((person) => (
          <span
            key={person.initials}
            className={cn(
              "grid size-6 place-items-center rounded-full text-[10px] font-semibold text-white ring-2 ring-card",
              person.tone,
            )}
          >
            {person.initials}
          </span>
        ))}
      </span>
      <span className="rounded-full bg-foreground px-2.5 py-1 text-[10px] font-medium text-background">
        Partager
      </span>
    </span>
  );
}

/** Barre supérieure de fenêtre : pastilles, nom du fichier, contrôle de mise en page. */
function WindowChrome({ title }: { title: string }) {
  return (
    <div className="flex h-11 items-center gap-2 border-b border-border bg-muted/40 px-4">
      <span className="size-2.5 rounded-full bg-border" />
      <span className="size-2.5 rounded-full bg-border" />
      <span className="size-2.5 rounded-full bg-border" />
      <span className="mx-3 hidden items-center gap-1 text-muted-foreground sm:flex">
        <span className="text-xs">‹</span>
        <span className="text-xs">›</span>
      </span>
      <span className="mx-auto flex h-6 min-w-0 items-center gap-1.5 rounded-md border border-border bg-background px-3 text-xs text-muted-foreground">
        <span className="truncate">{title}</span>
        <span aria-hidden className="text-[10px]">
          ✦
        </span>
      </span>
    </div>
  );
}

/** Curseur distant étiqueté (comme dans une vraie session collaborative). */
function RemoteCursor({
  name,
  tone,
  className,
  cursorClassName,
}: {
  name: string;
  tone: string;
  className?: string;
  cursorClassName?: string;
}) {
  return (
    <span aria-hidden className={cn("pointer-events-none absolute select-none", className)}>
      <svg
        viewBox="0 0 16 18"
        className={cn("size-4 drop-shadow", cursorClassName)}
        fill="currentColor"
      >
        <path d="M1 1l5.2 14 2-5.2 5.2-2L1 1z" />
      </svg>
      <span
        className={cn(
          "ml-2 inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold text-white",
          tone,
        )}
      >
        {name}
      </span>
    </span>
  );
}

/** Fenêtre Sheets : grille de données, barres de formule et graphique flottant. */
function SheetsWindow() {
  const rows: { cells: { text: string; tone?: string }[] }[] = [
    {
      cells: [
        { text: "1" },
        { text: "Produit", tone: "font-medium" },
        { text: "Région" },
        { text: "T1" },
        { text: "T2" },
        { text: "T3" },
        { text: "T4" },
      ],
    },
    {
      cells: [
        { text: "2" },
        { text: "Abonnement", tone: "font-medium" },
        { text: "Lyon" },
        { text: "4 000 €" },
        { text: "5 200 €" },
        { text: "6 700 €" },
        { text: "8 200 €" },
      ],
    },
    {
      cells: [
        { text: "3" },
        { text: "Assistance", tone: "font-medium" },
        { text: "Paris" },
        { text: "1 900 €" },
        { text: "2 600 €" },
        { text: "3 100 €" },
        { text: "3 900 €" },
      ],
    },
    {
      cells: [
        { text: "4" },
        { text: "Formation", tone: "font-medium" },
        { text: "Nantes" },
        { text: "800 €" },
        { text: "1 200 €" },
        { text: "1 600 €" },
        { text: "2 100 €" },
      ],
    },
    {
      cells: [
        { text: "5" },
        { text: "Total", tone: "font-semibold" },
        { text: "—" },
        { text: "6 700 €", tone: "font-semibold" },
        { text: "9 000 €", tone: "font-semibold" },
        { text: "11 400 €", tone: "font-semibold" },
        { text: "14 200 €", tone: "font-semibold" },
      ],
    },
  ];

  return (
    <div className="relative">
      <p className="mb-2 font-display text-sm font-semibold tracking-tight">
        Ventes Q3 — tableau de bord
      </p>

      <div className="overflow-hidden rounded-lg border border-border">
        <div className="grid grid-cols-7 border-b border-border bg-muted/40 text-[11px] font-medium text-muted-foreground">
          {["", "A", "B", "C", "D", "E", "F"].map((letter) => (
            <span key={letter} className="border-r border-border px-3 py-1.5 last:border-r-0">
              {letter}
            </span>
          ))}
        </div>

        {rows.map((row) => (
          <div
            key={row.cells[0]?.text}
            className="grid grid-cols-7 border-b border-border last:border-b-0"
          >
            {row.cells.map((cell, index) => (
              <span
                key={`${row.cells[0]?.text}-${cell.text}`}
                className={cn(
                  "truncate border-r border-border px-3 py-1.5 text-[11px] last:border-r-0",
                  index === 0 && "text-center text-muted-foreground",
                  // La cellule B2 est « sélectionnée » : le repère du curseur d'Élodie.
                  index === 1 &&
                    row.cells[0]?.text === "2" &&
                    "bg-primary/10 ring-1 ring-inset ring-primary/60",
                  cell.tone,
                )}
              >
                {cell.text}
              </span>
            ))}
          </div>
        ))}
      </div>

      <RemoteCursor name="Élodie" tone="bg-app-calendar" className="left-[30%] top-[46%]" />

      <div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card p-3 shadow-soft">
        <span className="flex items-center gap-1.5 text-[11px] font-semibold text-app-sheets">
          <IconGrid className="size-3.5" /> Fonctions utiles
        </span>
        <span className="flex gap-2 overflow-hidden">
          <span className="rounded bg-muted px-2 py-1 font-mono text-[10px]">=SOMME(D2:F2)</span>
          <span className="rounded bg-muted px-2 py-1 font-mono text-[10px]">=MOYENNE(D3:F3)</span>
          <span className="hidden rounded bg-muted px-2 py-1 font-mono text-[10px] sm:block">
            =SI(D4&gt;1000;«&nbsp;Objectif&nbsp;»;«&nbsp;En cours&nbsp;»)
          </span>
        </span>
      </div>
    </div>
  );
}

/** Fenêtre Drive : arborescence et liste de fichiers. */
function DriveWindow() {
  const files = [
    { name: "Plan produit 2027", meta: "Vous avez modifié · il y a 2 min", tone: "bg-app-docs" },
    { name: "Budget prévisionnel", meta: "Sofia a modifié · il y a 1 h", tone: "bg-app-sheets" },
    { name: "Assemblée générale", meta: "Sofia a modifié · hier", tone: "bg-app-slides" },
    { name: "Notes de réunion", meta: "Vous avez modifié · lundi", tone: "bg-app-docs" },
  ];

  return (
    <div className="relative">
      <div className="flex items-center gap-2 pb-3">
        <span className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-[11px] font-medium">
          <IconFileText className="size-3.5" /> Créer
        </span>
        <span className="rounded-md bg-muted px-2.5 py-1 text-[11px] text-muted-foreground">
          Récents
        </span>
        <span className="ml-auto text-[11px] text-muted-foreground">4 éléments</span>
      </div>

      <div className="grid gap-4 sm:grid-cols-[9rem_1fr]">
        <div className="hidden flex-col gap-1.5 rounded-lg border border-border bg-muted/30 p-3 text-[11px] text-muted-foreground sm:flex">
          {[
            { label: "Mes fichiers", Icon: IconFolder, active: true },
            { label: "Récents", Icon: IconFileText },
            { label: "Partagés", Icon: IconFolder },
            { label: "Agenda", Icon: IconCalendar },
          ].map((entry) => (
            <span
              key={entry.label}
              className={cn(
                "flex items-center gap-2 rounded px-2 py-1.5",
                entry.active && "bg-card font-medium text-foreground shadow-soft",
              )}
            >
              <entry.Icon className="size-3.5" />
              {entry.label}
            </span>
          ))}
        </div>

        <div className="flex flex-col gap-2">
          {files.map((file) => (
            <span
              key={file.name}
              className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2 text-[11px] shadow-soft"
            >
              <span
                className={cn("grid size-7 place-items-center rounded-md text-white", file.tone)}
              >
                <IconFileText className="size-3.5" />
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="truncate font-medium">{file.name}</span>
                <span className="truncate text-muted-foreground">{file.meta}</span>
              </span>
              <span className="ml-auto hidden text-muted-foreground sm:block">⋮</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Fenêtre Calendar : semaine d'équipe. */
function CalendarWindow() {
  const days = ["Lun.", "Mar.", "Mer.", "Jeu.", "Ven."];
  const events = [
    { day: 0, top: "8%", height: "42%", label: "Point produit", tone: "bg-app-calendar" },
    { day: 1, top: "30%", height: "26%", label: "Revue de design", tone: "bg-app-meet" },
    { day: 2, top: "12%", height: "52%", label: "Assemblée générale", tone: "bg-app-drive" },
    { day: 3, top: "46%", height: "30%", label: "Démo client", tone: "bg-app-mail" },
    { day: 4, top: "18%", height: "24%", label: "Rétrospective", tone: "bg-app-tasks" },
  ];

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <p className="font-display text-sm font-semibold tracking-tight">Semaine du 12 octobre</p>
        <span className="rounded-md bg-muted px-2 py-1 text-[11px] text-muted-foreground">
          Aujourd'hui
        </span>
      </div>

      <div className="grid grid-cols-5 gap-2">
        {days.map((day, index) => (
          <div key={day} className="flex flex-col gap-2">
            <span className="text-center text-[11px] font-medium text-muted-foreground">{day}</span>
            <div className="relative h-40 rounded-lg border border-border bg-muted/30">
              {index === 2 ? (
                <span className="absolute inset-x-0 top-1/2 border-t border-dashed border-destructive/60" />
              ) : null}
              {events
                .filter((event) => event.day === index)
                .map((event) => (
                  <span
                    key={event.label}
                    className={cn(
                      "absolute inset-x-1 rounded-md px-1.5 py-1 text-[9px] font-medium leading-tight text-white shadow-soft",
                      event.tone,
                    )}
                    style={{ top: event.top, height: event.height }}
                  >
                    {event.label}
                  </span>
                ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export type ShowcaseId = "drive" | "sheets" | "calendar";

const WINDOWS: Record<ShowcaseId, () => ReactNode> = {
  drive: () => (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex items-center gap-2">
        <AppMark tone="bg-app-drive">
          <IconFolder className="size-3.5" />
        </AppMark>
        <span className="hidden gap-3 text-[11px] text-muted-foreground sm:flex">
          {["Fichier", "Édition", "Affichage", "Insertion", "Outils", "Aide"].map((menu) => (
            <span key={menu}>{menu}</span>
          ))}
        </span>
        <span className="ml-auto">
          <Presence />
        </span>
      </div>
      <DriveWindow />
    </div>
  ),
  sheets: () => (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex items-center gap-2">
        <AppMark tone="bg-app-sheets">
          <IconGrid className="size-3.5" />
        </AppMark>
        <span className="hidden gap-3 text-[11px] text-muted-foreground sm:flex">
          {["Fichier", "Édition", "Affichage", "Insertion", "Format", "Données", "Outils"].map(
            (menu) => (
              <span key={menu}>{menu}</span>
            ),
          )}
        </span>
        <span className="ml-auto">
          <Presence />
        </span>
      </div>
      <SheetsWindow />
    </div>
  ),
  calendar: () => (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex items-center gap-2">
        <AppMark tone="bg-app-calendar">
          <IconCalendar className="size-3.5" />
        </AppMark>
        <span className="hidden gap-3 text-[11px] text-muted-foreground sm:flex">
          {["Aujourd'hui", "Semaine", "Mois", "Agenda", "Invités"].map((menu) => (
            <span key={menu}>{menu}</span>
          ))}
        </span>
        <span className="ml-auto">
          <Presence />
        </span>
      </div>
      <CalendarWindow />
    </div>
  ),
};

/**
 * Fenêtre produit complète : barre de fenêtre, barre d'outils de l'app et
 * contenu réel reconstitué avec les jetons du design system.
 */
export function ShowcaseWindow({ id, title }: { id: ShowcaseId; title: string }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card text-foreground shadow-lift">
      <WindowChrome title={title} />
      <div className="bg-card">{WINDOWS[id]()}</div>
    </div>
  );
}
