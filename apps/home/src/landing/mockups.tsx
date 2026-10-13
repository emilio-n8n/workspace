import { cn } from "@workspace/ui";
import type { ReactNode } from "react";

/*
 * Maquettes vectorielles des captures de la page d'accueil.
 *
 * Choix assumé : des SVG en ligne plutôt que des fichiers image.
 * - Dimensions intrinsèques portées par l'élément (`width`/`height` = 640×400),
 *   doublées d'un `h-auto w-full` : le rapport 8/5 est réservé avant même que la
 *   feuille de styles ne soit appliquée, donc aucun décalage de mise en page.
 * - Aucune requête réseau supplémentaire (une image de plus à télécharger, une
 *   connexion de plus à ouvrir).
 * - Couleurs issues des seuls jetons sémantiques (`fill-*`/`stroke-*`) : les
 *   maquettes suivent le thème clair et le thème sombre sans second jeu de
 *   fichiers.
 */

const WIDTH = 640;
const HEIGHT = 400;

type MockupProps = {
  /** Identifiant du titre de légende qui nomme l'image (`aria-labelledby`). */
  labelledBy: string;
  /** Identifiant unique du cadre (clipPath). */
  id: string;
};

/** Cadre commun : fond carte, barre supérieure et coins arrondis. */
function Frame({ id, labelledBy, children }: MockupProps & { children: ReactNode }) {
  const clip = `${id}-cadre`;
  return (
    // Le nom accessible est porté par le titre de la légende (aria-labelledby) :
    // pas de <title> dupliqué, la description reste dans le <figcaption>.
    // biome-ignore lint/a11y/noSvgWithoutTitle: nom accessible fourni par la légende du <figure>.
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      width={WIDTH}
      height={HEIGHT}
      role="img"
      aria-labelledby={labelledBy}
      className="h-auto w-full"
    >
      <defs>
        <clipPath id={clip}>
          <rect x="0" y="0" width={WIDTH} height={HEIGHT} rx="16" />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clip})`}>
        <rect x="0" y="0" width={WIDTH} height={HEIGHT} className="fill-card" />
        {children}
      </g>
      <rect
        x="0.75"
        y="0.75"
        width={WIDTH - 1.5}
        height={HEIGHT - 1.5}
        rx="16"
        className="fill-none stroke-border"
      />
    </svg>
  );
}

/** Barre supérieure d'une fenêtre : pastilles de contrôle et séparateur. */
function TitleBar({ y = 44 }: { y?: number }) {
  return (
    <>
      <rect x="0" y="0" width={WIDTH} height={y} className="fill-surface" />
      <line x1="0" y1={y} x2={WIDTH} y2={y} className="stroke-border" />
      <circle cx="22" cy={y / 2} r="4" className="fill-border" />
      <circle cx="38" cy={y / 2} r="4" className="fill-border" />
      <circle cx="54" cy={y / 2} r="4" className="fill-border" />
    </>
  );
}

/** Maquette Drive : panneau latéral et liste de fichiers. */
function DriveMockup(props: MockupProps) {
  const rows = [0, 1, 2, 3];
  return (
    <Frame {...props}>
      <TitleBar />
      {/* Champ de recherche */}
      <rect x="200" y="13" width="240" height="18" rx="9" className="fill-card stroke-border" />
      {/* Panneau latérieur */}
      <rect x="0" y="44" width="168" height={HEIGHT - 44} className="fill-muted" />
      <rect x="12" y="60" width="144" height="26" rx="8" className="fill-accent" />
      <rect x="24" y="69" width="52" height="8" rx="4" className="fill-primary" />
      {[94, 128, 162, 196].map((y) => (
        <g key={y}>
          <rect x="12" y={y} width="144" height="26" rx="8" className="fill-card" />
          <rect x="24" y={y + 9} width="52" height="8" rx="4" className="fill-border" />
        </g>
      ))}
      {/* Titre de dossier */}
      <rect x="188" y="64" width="150" height="12" rx="6" className="fill-border" />
      {/* Lignes de fichiers */}
      {rows.map((index) => {
        const y = 96 + index * 46;
        return (
          <g key={index}>
            <rect
              x="188"
              y={y}
              width="436"
              height="38"
              rx="10"
              className="fill-card stroke-border"
            />
            <rect x="204" y={y + 11} width="16" height="16" rx="4" className="fill-muted" />
            <rect x="232" y={y + 11} width="150" height="8" rx="4" className="fill-border" />
            <rect x="232" y={y + 24} width="88" height="6" rx="3" className="fill-border" />
            <rect x="520" y={y + 15} width="88" height="8" rx="4" className="fill-border" />
          </g>
        );
      })}
    </Frame>
  );
}

/** Maquette Sheets : barre de formule, grille et graphique. */
function SheetsMockup(props: MockupProps) {
  const columns = Array.from({ length: 9 }, (_, index) => 56 + index * 64);
  const rows = Array.from({ length: 10 }, (_, index) => 104 + index * 30);
  return (
    <Frame {...props}>
      <TitleBar />
      {/* Barre de formule */}
      <rect x="0" y="44" width={WIDTH} height="40" className="fill-surface" />
      <rect x="16" y="52" width="48" height="20" rx="6" className="fill-muted" />
      <rect x="76" y="52" width="400" height="20" rx="6" className="fill-card stroke-border" />
      <rect x="88" y="57" width="180" height="8" rx="4" className="fill-border" />
      {[488, 520, 552].map((x) => (
        <rect
          key={x}
          x={x}
          y="52"
          width="24"
          height="20"
          rx="6"
          className="fill-card stroke-border"
        />
      ))}
      {/* Colonne des numéros de ligne */}
      <rect x="0" y="84" width="56" height={HEIGHT - 84} className="fill-muted" />
      {/* En-têtes de colonnes */}
      {columns.map((x) => (
        <rect key={x} x={x + 8} y="90" width="48" height="10" rx="5" className="fill-border" />
      ))}
      {/* Grille */}
      {columns.map((x) => (
        <line key={`v-${x}`} x1={x} y1="84" x2={x} y2={HEIGHT} className="stroke-border" />
      ))}
      {rows.map((y) => (
        <line key={`h-${y}`} x1="0" y1={y} x2={WIDTH} y2={y} className="stroke-border" />
      ))}
      {/* Plage sélectionnée */}
      <rect
        x="120"
        y="104"
        width="128"
        height="60"
        className="fill-accent stroke-primary"
        strokeWidth="2"
      />
      <rect x="132" y="116" width="40" height="8" rx="4" className="fill-border" />
      <rect x="132" y="132" width="64" height="8" rx="4" className="fill-border" />
      <rect x="196" y="116" width="36" height="8" rx="4" className="fill-border" />
      {/* Carte de graphique */}
      <rect x="436" y="228" width="188" height="132" rx="10" className="fill-card stroke-border" />
      <line x1="452" y1="344" x2="608" y2="344" className="stroke-border" />
      {[
        [452, 300, 60],
        [492, 320, 40],
        [532, 280, 80],
        [572, 330, 30],
      ].map(([x, y, height]) => (
        <rect key={x} x={x} y={y} width="24" height={height} rx="4" className="fill-primary" />
      ))}
    </Frame>
  );
}

/** Maquette Calendar : semaine, événements et ligne de l'heure courante. */
function CalendarMockup(props: MockupProps) {
  const days = Array.from({ length: 7 }, (_, index) => 8 + index * 88);
  const slots = Array.from({ length: 4 }, (_, index) => 108 + index * 70);
  return (
    <Frame {...props}>
      <TitleBar />
      {days.map((x, index) => (
        <g key={x}>
          <rect
            x={x}
            y="56"
            width="80"
            height="44"
            rx="8"
            className={index === 2 ? "fill-accent" : "fill-card stroke-border"}
          />
          <rect x={x + 12} y="64" width="28" height="8" rx="4" className="fill-border" />
          <rect x={x + 12} y="78" width="16" height="10" rx="5" className="fill-border" />
        </g>
      ))}
      {slots.map((y) =>
        days.map((x) => (
          <rect
            key={`${x}-${y}`}
            x={x}
            y={y}
            width="80"
            height="70"
            className="fill-none stroke-border"
          />
        )),
      )}
      {/* Événements */}
      <rect x="12" y="118" width="72" height="22" rx="6" className="fill-primary" />
      <rect x="22" y="126" width="44" height="6" rx="3" className="fill-primary-foreground" />
      <rect x="100" y="118" width="72" height="22" rx="6" className="fill-accent" />
      <rect x="110" y="126" width="44" height="6" rx="3" className="fill-accent-foreground" />
      <rect x="188" y="188" width="152" height="22" rx="6" className="fill-accent" />
      <rect x="198" y="196" width="80" height="6" rx="3" className="fill-accent-foreground" />
      <rect x="452" y="258" width="72" height="22" rx="6" className="fill-primary" />
      <rect x="462" y="266" width="44" height="6" rx="3" className="fill-primary-foreground" />
      {/* Heure courante */}
      <line x1="8" y1="150" x2="632" y2="150" className="stroke-destructive" />
      <circle cx="12" cy="150" r="4" className="fill-destructive" />
    </Frame>
  );
}

const MOCKUPS = {
  drive: DriveMockup,
  sheets: SheetsMockup,
  calendar: CalendarMockup,
} as const;

/**
 * Capture d'écran illustrée. L'image est nommée par le titre de sa légende
 * (`aria-labelledby`) : la description reste dans le `<figcaption>`, jamais
 * dupliquée dans un attribut.
 */
export function CaptureMockup({
  mock,
  id,
  labelledBy,
  className,
}: {
  mock: keyof typeof MOCKUPS;
  id: string;
  labelledBy: string;
  className?: string;
}) {
  const Mockup = MOCKUPS[mock];
  return (
    <div className={cn("overflow-hidden rounded-xl", className)}>
      <Mockup id={id} labelledBy={labelledBy} />
    </div>
  );
}
