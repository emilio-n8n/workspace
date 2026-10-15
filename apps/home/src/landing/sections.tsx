import { Link } from "@tanstack/react-router";
import {
  Badge,
  BrandMark,
  Button,
  buttonVariants,
  cn,
  IconCheckSquare,
  IconChevronDown,
  IconClose,
  IconMenu,
  IconMoon,
  IconSun,
  SUITE_APPS,
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  type Theme,
} from "@workspace/ui";
import { useEffect, useRef, useState } from "react";
import {
  CAPTURES,
  CAPTURES_INTRO,
  type Capture,
  COMMITMENTS,
  FAQ,
  FEATURES,
  FEATURES_INTRO,
  FINAL_CTA,
  FOOTER,
  type FooterLink,
  HERO,
  NAV_LINKS,
  PLANS,
  PRICING_COMPARISON,
  PRICING_INTRO,
} from "./content.ts";
import { type ShowcaseId, ShowcaseWindow } from "./showcase-windows.tsx";
import { SpaceField } from "./space-field.tsx";

/*
 * Page d'accueil publique — mise en page éditoriale.
 *
 * Règles suivies sur toute la page :
 * - un seul <h1>, puis <h2> par section et <h3> dans les sections ;
 * - chaque section est un repère nommé (`aria-labelledby` vers son titre) ;
 * - chaque élément interactif porte l'anneau de focus du design system ;
 * - aucune couleur écrite à la main : uniquement les jetons sémantiques ;
 * - la mise en scène (halo, fenêtre produit, apparition) est décorative,
 *   masquée aux lecteurs d'écran et sans mouvement si `prefers-reduced-motion`.
 */

/** Anneau de focus unique du design system, réutilisé par tous les interactifs. */
const focusRing =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

const sectionFrame = "mx-auto w-full max-w-7xl px-5 md:px-8";
const headingTwo =
  "font-display text-4xl font-semibold leading-[1.05] tracking-[-0.03em] text-balance md:text-6xl";
const headingThree = "font-display text-lg font-semibold tracking-tight";
const bodyMuted = "text-sm leading-relaxed text-muted-foreground";
const eyebrow = "text-sm font-medium text-primary";

const navLinkClass = cn(
  "rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors",
  "hover:bg-muted hover:text-foreground motion-reduce:transition-none",
  focusRing,
);

/** Lien dans le corps de texte (renvoi vers une autre section de la page). */
const quietLinkClass = cn(
  "rounded-sm font-medium text-primary underline-offset-4 hover:underline",
  focusRing,
);

export function LandingHeader({
  theme,
  onToggleTheme,
}: {
  theme: Theme;
  onToggleTheme: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);

  // Fermeture au clavier : Échap referme le menu mobile.
  useEffect(() => {
    if (!menuOpen) return;
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") setMenuOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [menuOpen]);

  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-background/80 backdrop-blur-md supports-[backdrop-filter]:bg-background/70">
      <div className={cn(sectionFrame, "flex h-16 items-center gap-4")}>
        <Link to="/" className={cn("flex items-center gap-2.5 rounded-md", focusRing)}>
          <BrandMark className="size-7 text-xs" />
          <span className="font-display text-base font-semibold tracking-tight">Workspace</span>
        </Link>

        <nav
          aria-label="Navigation principale"
          className="ml-auto hidden items-center gap-1 md:flex"
        >
          {NAV_LINKS.map((link) => (
            <a key={link.href} href={link.href} className={navLinkClass}>
              {link.label}
            </a>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2 md:ml-6">
          <Button
            variant="ghost"
            size="sm"
            onClick={onToggleTheme}
            aria-label={theme === "dark" ? "Passer en thème clair" : "Passer en thème sombre"}
          >
            {/* Les deux icônes sont dans le DOM : celle affichée suit la classe
                `.dark` posée avant la première peinture, sans attente du JS. */}
            <IconMoon className="dark:hidden" />
            <IconSun className="hidden dark:block" />
          </Button>
          <Link
            to="/login"
            className={cn(
              buttonVariants({ variant: "ghost", size: "sm" }),
              "hidden sm:inline-flex",
            )}
          >
            Connexion
          </Link>
          <Link to="/signup" className={buttonVariants({ size: "sm" })}>
            Créer un compte
          </Link>
          <button
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            aria-expanded={menuOpen}
            aria-controls="menu-principal"
            className={cn(
              "inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground motion-reduce:transition-none md:hidden",
              focusRing,
            )}
          >
            {menuOpen ? <IconClose /> : <IconMenu />}
            <span className="sr-only">{menuOpen ? "Fermer le menu" : "Ouvrir le menu"}</span>
          </button>
        </div>
      </div>

      <div
        id="menu-principal"
        hidden={!menuOpen}
        className="border-t border-border bg-background px-5 pb-4 md:hidden"
      >
        <nav aria-label="Menu" className="flex flex-col gap-1 pt-2">
          {NAV_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              onClick={() => setMenuOpen(false)}
              className={cn(navLinkClass, "px-2 py-3 text-base")}
            >
              {link.label}
            </a>
          ))}
          <Link
            to="/login"
            onClick={() => setMenuOpen(false)}
            className={cn(navLinkClass, "px-2 py-3 text-base sm:hidden")}
          >
            Connexion
          </Link>
        </nav>
      </div>
    </header>
  );
}

export function HeroSection() {
  return (
    <section aria-labelledby="titre-principal" className="relative isolate overflow-hidden">
      {/* Une seule lumière, discrète, derrière le titre. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 -top-48 -z-10 h-[40rem] bg-[radial-gradient(45%_55%_at_50%_0%,var(--color-primary)_0%,transparent_100%)] opacity-15 dark:opacity-25"
      />

      <div className={cn(sectionFrame, "pb-12 pt-20 md:pt-28")}>
        <div className="landing-rise flex max-w-4xl flex-col gap-7">
          <span className="inline-flex w-fit items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground shadow-soft">
            <span aria-hidden className="relative flex size-2">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary opacity-60 motion-reduce:animate-none" />
              <span className="relative inline-flex size-2 rounded-full bg-primary" />
            </span>
            {HERO.eyebrow}
          </span>

          <h1
            id="titre-principal"
            className="font-display text-5xl font-semibold leading-[1.02] tracking-[-0.04em] text-balance md:text-7xl"
          >
            {/* Les espaces vivent dans les chaînes : aucune dépendance au
                formatage JSX, qui supprime les sauts de ligne. */}
            <span>{HERO.titleLead}</span>
            <span className="text-primary">{HERO.titleAccent}</span>
            <span>{HERO.titleEnd}</span>
          </h1>

          <p className="max-w-2xl text-lg leading-relaxed text-muted-foreground md:text-xl">
            {HERO.intro}
          </p>

          <div className="flex flex-wrap items-center gap-3">
            <Link to="/signup" className={buttonVariants({ size: "lg" })}>
              Créer un compte
            </Link>
            <Link to="/app" className={buttonVariants({ variant: "outline", size: "lg" })}>
              Ouvrir l'application
            </Link>
          </div>
          <p className="text-sm text-muted-foreground">{HERO.reassurance}</p>
        </div>

        <ProductWindow />

        <ul className="mt-20 grid gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-3">
          {HERO.facts.map((fact) => (
            <li key={fact.label} className="flex flex-col gap-1 bg-background px-6 py-5">
              <span className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
                {fact.label}
              </span>
              <span className="font-display text-lg font-semibold">{fact.value}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-20 border-y border-border bg-muted/30">
        <ul
          aria-label="Les applications de la suite"
          className={cn(
            sectionFrame,
            "flex flex-wrap items-center justify-center gap-x-8 gap-y-3 py-5 text-sm text-muted-foreground",
          )}
        >
          {SUITE_APPS.map((app) => (
            <li key={app.name} className="flex items-center gap-2">
              <app.Icon aria-hidden className="size-4" />
              {app.name}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/**
 * Fenêtre produit mise en scène avec les jetons du design system : décorative,
 * elle illustre l'ambiance de la suite sans dupliquer une vraie capture.
 */
function ProductWindow() {
  return (
    <div
      aria-hidden
      className="landing-rise relative mt-16 md:mt-24"
      style={{ animationDelay: "120ms" }}
    >
      <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-lift">
        <div className="flex h-11 items-center gap-2 border-b border-border bg-muted/50 px-4">
          <span className="size-2.5 rounded-full bg-border" />
          <span className="size-2.5 rounded-full bg-border" />
          <span className="size-2.5 rounded-full bg-border" />
          <span className="mx-auto hidden h-6 w-80 max-w-[55%] rounded-md border border-border bg-background sm:block" />
        </div>

        <div className="grid grid-cols-[3.5rem_1fr] md:grid-cols-[3.5rem_16rem_1fr]">
          <div className="flex flex-col items-center gap-3 border-r border-border bg-muted/30 py-5">
            {SUITE_APPS.slice(0, 8).map((app, index) => (
              <span
                key={app.name}
                className={cn(
                  "grid size-9 place-items-center rounded-lg",
                  index === 1 ? "bg-primary text-primary-foreground" : "text-muted-foreground",
                )}
              >
                <app.Icon className="size-4" />
              </span>
            ))}
          </div>

          <div className="hidden flex-col gap-2 border-r border-border p-5 md:flex">
            <span className="mb-2 h-3 w-24 rounded bg-muted" />
            {[0, 1, 2, 3, 4, 5].map((row) => (
              <span
                key={row}
                className={cn("h-9 rounded-md", row === 1 ? "bg-primary/15" : "bg-muted/60")}
              />
            ))}
          </div>

          <div className="flex flex-col gap-6 p-6 md:p-10">
            <span className="h-9 w-2/5 rounded-md bg-foreground/85" />
            <div className="flex flex-col gap-3">
              <span className="h-3 w-full rounded bg-muted" />
              <span className="h-3 w-11/12 rounded bg-muted" />
              <span className="h-3 w-4/5 rounded bg-muted" />
            </div>
            <div className="grid flex-1 grid-cols-3 gap-3">
              {[0, 1, 2].map((card) => (
                <span
                  key={card}
                  className={cn(
                    "min-h-24 rounded-xl border border-border",
                    card === 0 ? "bg-primary/10" : "bg-muted/40",
                  )}
                />
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="absolute -bottom-6 right-4 flex items-center gap-3 rounded-xl border border-border bg-popover px-4 py-3 text-popover-foreground shadow-lift md:right-10">
        <span className="grid size-9 place-items-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
          LM
        </span>
        <span className="flex flex-col">
          <span className="text-sm font-medium">Lucie met à jour le plan</span>
          <span className="text-xs text-muted-foreground">
            À l'instant · enregistré sur votre serveur
          </span>
        </span>
      </div>
    </div>
  );
}

export function FeaturesSection() {
  return (
    <section
      id="fonctionnalites"
      aria-labelledby="titre-fonctionnalites"
      className="scroll-mt-20 py-24 md:py-32"
    >
      <div className={sectionFrame}>
        <div className="flex max-w-3xl flex-col gap-5">
          <p className={eyebrow}>Fonctionnalités</p>
          <h2 id="titre-fonctionnalites" className={headingTwo}>
            Tout ce qu'une équipe attend, dans une seule suite
          </h2>
          <p className="max-w-2xl text-lg leading-relaxed text-muted-foreground">
            {FEATURES_INTRO}
          </p>
        </div>

        <ul className="mt-16 grid gap-4 lg:grid-cols-6">
          {FEATURES.map((feature, index) => (
            <li
              key={feature.title}
              className={cn(
                "flex flex-col justify-between gap-10 rounded-2xl border border-border bg-card p-7 shadow-soft transition-colors hover:border-primary/40 motion-reduce:transition-none",
                index < 2 ? "lg:col-span-3" : "lg:col-span-2",
              )}
            >
              <span className="grid size-11 place-items-center rounded-xl bg-muted text-primary">
                <feature.Icon className="size-5" />
              </span>
              <div className="flex flex-col gap-2">
                <h3 className={headingThree}>{feature.title}</h3>
                <p className={bodyMuted}>{feature.body}</p>
              </div>
            </li>
          ))}
        </ul>

        <div className="mt-24">
          <h3 className="font-display text-2xl font-semibold tracking-tight md:text-3xl">
            {COMMITMENTS.title}
          </h3>
          <dl className="mt-10 grid gap-px overflow-hidden rounded-2xl border border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
            {COMMITMENTS.items.map((item, index) => (
              <div key={item.title} className="flex flex-col gap-3 bg-background p-7">
                <span className="font-mono text-xs text-muted-foreground">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <dt className="font-display text-lg font-semibold tracking-tight">{item.title}</dt>
                <dd className={bodyMuted}>{item.body}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </section>
  );
}

/** Bornes et courbes d'accélération de la progression au défilement. */
const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const easeOut = (t: number) => 1 - (1 - t) ** 3;
const easeIn = (t: number) => t ** 3;

/** Opacité d'une scène : pleine à plat, nulle une fois sortie par le haut. */
const sceneFade = "calc(var(--enter, 1) * (1 - var(--exit, 0)))";

/**
 * La fenêtre arrive du fond de la scène (`translateZ` négatif), se pose face au
 * lecteur, puis passe devant la caméra et s'efface — on « entre » dans le
 * produit. `--enter` et `--exit` sont posées par le script de défilement ; sans
 * elles (ou sans mouvement), la fenêtre est simplement face au lecteur.
 */
function sceneTransform(tilt: 1 | -1): string {
  return [
    "translateZ(calc((1 - var(--enter, 1)) * -820px + var(--exit, 0) * 520px))",
    "translateY(calc((1 - var(--enter, 1)) * 6vh - var(--exit, 0) * 8vh))",
    "rotateX(calc((1 - var(--enter, 1)) * 14deg - var(--exit, 0) * 10deg))",
    `rotateY(calc(${tilt} * (1 - var(--enter, 1)) * 20deg))`,
  ].join(" ");
}

export function CapturesSection() {
  const section = useRef<HTMLElement>(null);
  const scenes = useRef<(HTMLLIElement | null)[]>([]);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let frame = 0;
    const update = () => {
      frame = 0;
      const half = window.innerHeight / 2;
      for (const scene of scenes.current) {
        if (!scene) continue;
        const rect = scene.getBoundingClientRect();
        // d vaut -1 quand la scène entre par le bas, 0 au centre, +1 quand elle sort par le haut.
        const d = (half - (rect.top + rect.height / 2)) / (half + rect.height / 2);
        scene.style.setProperty("--enter", easeOut(clamp01((d + 1) / 0.7)).toFixed(3));
        scene.style.setProperty("--exit", easeIn(clamp01((d - 0.3) / 0.7)).toFixed(3));
      }
      // Barre de progression de la section (fine ligne en haut, décorative).
      const stage = section.current;
      if (stage) {
        const rect = stage.getBoundingClientRect();
        const range = Math.max(1, rect.height - window.innerHeight);
        const progress = Math.min(1, Math.max(0, -rect.top / range));
        stage.style.setProperty("--sections", progress.toFixed(3));
      }
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };

    update();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <section
      ref={section}
      id="captures"
      aria-labelledby="titre-captures"
      className="scroll-mt-20 overflow-hidden border-t border-border bg-muted/30 py-24 md:py-32"
    >
      {/* Progression dans la section — repère discret en haut de la scène. */}
      <div aria-hidden className={cn(sectionFrame, "mb-12 h-px bg-border")}>
        <div
          className="h-px origin-left bg-primary"
          style={{ transform: "scaleX(var(--sections, 0))" }}
        />
      </div>

      <div className={sectionFrame}>
        <div className="flex max-w-3xl flex-col gap-5">
          <p className={eyebrow}>Captures</p>
          <h2 id="titre-captures" className={headingTwo}>
            Captures de l'interface
          </h2>
          <p className="max-w-2xl text-lg leading-relaxed text-muted-foreground">
            {CAPTURES_INTRO}
          </p>
        </div>
      </div>

      <ul className="mt-12">
        {CAPTURES.map((capture, index) => (
          <li
            key={capture.id}
            ref={(node) => {
              scenes.current[index] = node;
            }}
            className="flex min-h-[92vh] items-center justify-center px-5 py-16 md:px-8"
          >
            <CaptureScene capture={capture} tilt={index % 2 === 0 ? 1 : -1} />
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Chiffres du panneau flottant selon l'application présentée. */
const HINTS: Record<ShowcaseId, { title: string; rows: { label: string; value: string }[] }> = {
  drive: {
    title: "Stockage de l'organisation",
    rows: [
      { label: "Utilisé", value: "48 Go / 200 Go" },
      { label: "Partagé avec l'équipe", value: "12 éléments" },
      { label: "Sauvegardes", value: "Quotidiennes" },
    ],
  },
  sheets: {
    title: "Revenu trimestriel",
    rows: [
      { label: "T1", value: "6,7 k€" },
      { label: "T2", value: "9,0 k€" },
      { label: "T3", value: "+58 %" },
    ],
  },
  calendar: {
    title: "Charge de l'équipe",
    rows: [
      { label: "Cette semaine", value: "23 h" },
      { label: "Temps partagé", value: "-8 h" },
      { label: "Salles libres", value: "4 / 6" },
    ],
  },
};

function FloatingHint({ id, delay }: { id: ShowcaseId; delay?: string }) {
  const hint = HINTS[id];
  return (
    <div
      aria-hidden
      className="showcase-float hidden flex-col gap-3 rounded-xl border border-border bg-card/95 p-4 shadow-lift backdrop-blur md:flex"
      style={delay ? { animationDelay: delay } : undefined}
    >
      <p className="text-[11px] font-semibold">{hint.title}</p>
      {id === "sheets" ? (
        <span className="flex h-16 items-end gap-2">
          <span className="w-4 rounded-t bg-app-sheets/40" style={{ height: "45%" }} />
          <span className="w-4 rounded-t bg-app-sheets/60" style={{ height: "62%" }} />
          <span className="w-4 rounded-t bg-app-sheets" style={{ height: "88%" }} />
          <span className="w-4 rounded-t bg-app-sheets/70" style={{ height: "70%" }} />
        </span>
      ) : (
        <span className="flex flex-col gap-1.5">
          {hint.rows.map((row) => (
            <span key={row.label} className="flex items-baseline justify-between gap-4">
              <span className="text-[10px] text-muted-foreground">{row.label}</span>
              <span className="text-[10px] font-semibold">{row.value}</span>
            </span>
          ))}
        </span>
      )}
    </div>
  );
}

/** Messages d'équipe du panneau flottant haut (la collaboration en un coup d'œil). */
const COMMENTS: Record<ShowcaseId, { name: string; tone: string; text: string }> = {
  drive: { name: "Sofia", tone: "bg-muted", text: "Je t'ai partagé le dossier « Budget »." },
  sheets: { name: "Élodie", tone: "bg-muted", text: "On valide les chiffres du T3 ?" },
  calendar: { name: "Sofia", tone: "bg-muted", text: "La salle B est libre à 14 h." },
};

function CommentHint({ id }: { id: ShowcaseId }) {
  const comment = COMMENTS[id];
  return (
    <div
      aria-hidden
      className="showcase-float hidden flex-col gap-2 rounded-xl border border-border bg-card/95 p-4 shadow-lift backdrop-blur md:flex"
    >
      <span className="flex items-center gap-2">
        <span
          className={cn(
            "grid size-6 place-items-center rounded-full text-[9px] font-semibold text-foreground",
            comment.tone,
          )}
        >
          {comment.name.slice(0, 2).toUpperCase()}
        </span>
        <span className="text-[11px] font-semibold">{comment.name}</span>
        <span className="text-[10px] text-muted-foreground">· maintenant</span>
      </span>
      <p className="text-[11px] leading-snug text-muted-foreground">{comment.text}</p>
    </div>
  );
}

function CaptureScene({ capture, tilt }: { capture: Capture; tilt: 1 | -1 }) {
  return (
    <figure className="flex w-full max-w-5xl flex-col items-center gap-12">
      <figcaption
        className="flex max-w-2xl flex-col items-center gap-3 text-center"
        style={{
          opacity: sceneFade,
          transform: "translateY(calc((1 - var(--enter, 1)) * 5rem))",
        }}
      >
        <h3
          id={`${capture.id}-titre`}
          className="font-display text-3xl font-semibold tracking-tight text-balance md:text-4xl"
        >
          {capture.title}
        </h3>
        <p className="text-sm leading-relaxed text-muted-foreground md:text-base">
          {capture.description}
        </p>
      </figcaption>

      <div className="dark relative w-full overflow-hidden rounded-[2rem] border border-border bg-background text-foreground shadow-lift">
        {/* Fond ambiant : lueurs, faisceau, vagues et trame — tout est décoratif. */}
        <div
          aria-hidden
          className="showcase-drift absolute -inset-x-1/3 -top-1/2 h-[160%] rounded-full bg-[radial-gradient(closest-side,var(--color-primary)_0%,transparent_100%)] opacity-35 blur-3xl"
        />
        <div
          aria-hidden
          className="showcase-beam absolute -left-1/3 -top-2/3 h-[240%] w-2/3 bg-[conic-gradient(from_140deg_at_50%_50%,transparent_0deg,var(--color-primary)_70deg,transparent_140deg)] opacity-25 blur-2xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.05] [background-image:repeating-linear-gradient(90deg,white_0,white_1px,transparent_1px,transparent_6px)]"
        />
        <SpaceField className="absolute inset-0 [mask-image:linear-gradient(to_right,black_0%,black_24%,transparent_40%,transparent_60%,black_76%,black_100%)]" />
        <div
          aria-hidden
          className="showcase-grid absolute inset-0 opacity-40 [background-image:linear-gradient(color-mix(in_oklab,var(--color-primary)_16%,transparent)_1px,transparent_1px),linear-gradient(90deg,color-mix(in_oklab,var(--color-primary)_16%,transparent)_1px,transparent_1px)] [background-size:64px_64px] [mask-image:linear-gradient(to_bottom,transparent,black_35%,transparent)]"
        />

        <div className="relative px-5 py-10 [perspective:1000px] md:px-16 md:py-14">
          <div
            className="relative will-change-transform [transform-style:preserve-3d]"
            style={{ transform: sceneTransform(tilt) }}
          >
            <div className="relative z-10">
              <ShowcaseWindow id={capture.mock} title={capture.window} />
            </div>
            <div className="absolute -left-6 -bottom-14 z-20 w-48 [transform:translateZ(150px)] lg:-left-16">
              <FloatingHint id={capture.mock} delay="-3.5s" />
            </div>
            <div className="absolute -right-6 -top-12 z-20 w-56 [transform:translateZ(280px)] lg:-right-16">
              <CommentHint id={capture.mock} />
            </div>
          </div>
        </div>
      </div>
    </figure>
  );
}

export function PricingSection() {
  return (
    <section id="tarifs" aria-labelledby="titre-tarifs" className="scroll-mt-20 py-24 md:py-32">
      <div className={sectionFrame}>
        <div className="flex max-w-3xl flex-col gap-5">
          <h2 id="titre-tarifs" className={headingTwo}>
            Tarifs
          </h2>
          <p className="max-w-2xl text-lg leading-relaxed text-muted-foreground">{PRICING_INTRO}</p>
        </div>

        <ul className="mt-16 grid gap-6 md:grid-cols-2">
          {PLANS.map((plan) => (
            <li key={plan.id}>
              <article
                aria-labelledby={`${plan.id}-nom`}
                className={cn(
                  "flex h-full flex-col gap-6 rounded-2xl border bg-card p-8 shadow-soft",
                  plan.featured ? "border-primary ring-1 ring-primary/40" : "border-border",
                )}
              >
                <div className="flex flex-col gap-3">
                  <Badge variant={plan.featured ? "accent" : "outline"} className="w-fit">
                    {plan.badge}
                  </Badge>
                  <h3
                    id={`${plan.id}-nom`}
                    className="font-display text-2xl font-semibold tracking-tight"
                  >
                    {plan.name}
                  </h3>
                  <p className="text-sm text-muted-foreground">{plan.description}</p>
                </div>

                <p className="flex flex-wrap items-baseline gap-2">
                  <span className="font-display text-5xl font-semibold tracking-tight">
                    {plan.price}
                  </span>
                  <span className="text-sm text-muted-foreground">{plan.priceNote}</span>
                </p>

                <ul className="flex flex-col gap-2.5">
                  {plan.highlights.map((highlight) => (
                    <li key={highlight} className="flex items-start gap-2 text-sm">
                      <IconCheckSquare className="mt-0.5 size-4 shrink-0 text-primary" />
                      <span>{highlight}</span>
                    </li>
                  ))}
                </ul>

                <div className="mt-auto flex flex-col gap-3">
                  {plan.action && plan.to ? (
                    <Link
                      to={plan.to}
                      className={buttonVariants({ variant: plan.featured ? "primary" : "outline" })}
                    >
                      {plan.action}
                    </Link>
                  ) : (
                    // Offre pas encore ouverte : le bouton reste annoncé, avec
                    // l'explication juste en dessous.
                    <Button type="button" disabled>
                      Offre en préparation
                    </Button>
                  )}
                  <p className="text-xs leading-relaxed text-muted-foreground">{plan.note}</p>
                </div>
              </article>
            </li>
          ))}
        </ul>

        {/* Comparatif — tableau sémantique : légende, en-têtes de colonnes et
            en-têtes de ligne, donc lisible sans voir l'écran. */}
        <div className="mt-12 overflow-hidden rounded-2xl border border-border bg-card shadow-soft">
          <Table>
            <TableCaption className="px-6 py-4 text-left text-sm text-muted-foreground">
              {PRICING_COMPARISON.caption}
            </TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[36%]">Ce qui est inclus</TableHead>
                {PLANS.map((plan) => (
                  <TableHead key={plan.id}>{plan.name}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {PRICING_COMPARISON.rows.map((row) => (
                <TableRow key={row.label}>
                  <TableHead scope="row" className="font-medium text-foreground">
                    {row.label}
                  </TableHead>
                  {row.values.map((value, index) => (
                    <TableCell key={PLANS[index]?.id ?? index} className="text-muted-foreground">
                      {value}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <p className="mt-6 text-sm text-muted-foreground">
          {PRICING_COMPARISON.faqPrompt}{" "}
          <a href="#faq" className={quietLinkClass}>
            {PRICING_COMPARISON.faqLinkLabel}
          </a>
        </p>
      </div>
    </section>
  );
}

export function FaqSection() {
  return (
    <section
      id="faq"
      aria-labelledby="titre-faq"
      className="scroll-mt-20 border-t border-border bg-muted/30 py-24 md:py-32"
    >
      <div className={cn(sectionFrame, "grid gap-12 md:grid-cols-[1fr_1.3fr] md:gap-20")}>
        <div className="flex flex-col gap-5 md:sticky md:top-28 md:self-start">
          <h2 id="titre-faq" className={headingTwo}>
            Questions fréquentes
          </h2>
          <p className="max-w-sm text-muted-foreground">
            Six réponses claires, sans jargon. Une question manque ? Elle trouvera sa place ici.
          </p>
        </div>

        <ul className="flex flex-col gap-3">
          {FAQ.map((item) => (
            <li key={item.question}>
              {/* details/summary : ouverture au clavier native (Entrée, Espace). */}
              <details className="group rounded-2xl border border-border bg-card shadow-soft">
                <summary
                  className={cn(
                    "flex cursor-pointer list-none items-center gap-3 rounded-2xl px-6 py-5 text-sm font-medium",
                    "[&::-webkit-details-marker]:hidden",
                    focusRing,
                  )}
                >
                  <span className="flex-1">{item.question}</span>
                  <IconChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180 motion-reduce:transition-none" />
                </summary>
                <p className="px-6 pb-5 text-sm leading-relaxed text-muted-foreground">
                  {item.answer}
                </p>
              </details>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

export function FinalCtaSection() {
  return (
    <section aria-labelledby="titre-cta" className="px-5 py-24 md:px-8 md:py-32">
      <div className="relative mx-auto max-w-7xl overflow-hidden rounded-3xl bg-foreground px-8 py-16 text-background md:px-16 md:py-24">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(50%_80%_at_85%_0%,var(--color-primary)_0%,transparent_100%)] opacity-40"
        />
        <div className="relative flex max-w-3xl flex-col items-start gap-7">
          <h2
            id="titre-cta"
            className="font-display text-4xl font-semibold leading-[1.05] tracking-[-0.03em] text-balance md:text-6xl"
          >
            {FINAL_CTA.title}
          </h2>
          <p className="max-w-xl text-lg leading-relaxed opacity-80">{FINAL_CTA.body}</p>
          <div className="flex flex-wrap gap-3">
            <Link
              to="/signup"
              className={cn(
                buttonVariants({ size: "lg" }),
                "bg-background text-foreground hover:bg-background/90",
              )}
            >
              Créer un compte
            </Link>
            {/* « Ouvrir l'application » reste réservé au héros : un seul lien
                porte ce libellé sur toute la page. */}
            <Link
              to="/login"
              className={cn(
                buttonVariants({ variant: "outline", size: "lg" }),
                "border-background/30 bg-transparent text-background hover:bg-background/10",
              )}
            >
              Se connecter
            </Link>
          </div>
          <p className="text-sm opacity-70">{FINAL_CTA.legal}</p>
        </div>
      </div>
    </section>
  );
}

export function LandingFooter() {
  return (
    <footer className="border-t border-border">
      <div className={cn(sectionFrame, "grid gap-10 py-14 md:grid-cols-[2fr_1fr_1fr_1fr]")}>
        <div className="flex flex-col gap-3">
          <span className="flex items-center gap-2.5">
            <BrandMark className="size-7 text-xs" />
            <span className="font-display text-base font-semibold tracking-tight">Workspace</span>
          </span>
          <p className="max-w-sm text-sm leading-relaxed text-muted-foreground">{FOOTER.tagline}</p>
        </div>

        {FOOTER.columns.map((column) => (
          <nav key={column.label} aria-label={column.label} className="flex flex-col gap-3">
            <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              {column.label}
            </h2>
            <ul className="flex flex-col gap-2">
              {column.links.map((link) => (
                <li key={link.label}>
                  <FooterLinkItem link={link} />
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>

      <div className={sectionFrame}>
        <div className="flex flex-col gap-4 border-t border-border py-6 md:flex-row md:items-center md:justify-between">
          <p className="text-xs text-muted-foreground">{FOOTER.legal}</p>
          <dl className="flex flex-col gap-1 text-xs text-muted-foreground">
            <div className="flex items-center gap-2">
              <dt className="font-medium">Raccourci clavier principal</dt>
              <dd>
                <span className="sr-only">Ctrl ou Commande K</span>
                <kbd className="rounded border border-border bg-background px-1.5 py-0.5 font-sans text-[10px] font-medium">
                  ⌘K
                </kbd>
              </dd>
            </div>
          </dl>
        </div>
      </div>

      <p
        aria-hidden
        className="select-none overflow-hidden whitespace-nowrap pb-6 text-center font-display text-[clamp(4rem,19vw,16rem)] font-semibold leading-none tracking-[-0.06em] text-muted/60"
      >
        Workspace
      </p>
    </footer>
  );
}

function FooterLinkItem({ link }: { link: FooterLink }) {
  const className = cn(
    "rounded-md text-sm text-muted-foreground transition-colors hover:text-foreground",
    "motion-reduce:transition-none",
    focusRing,
  );
  if (link.kind === "anchor") {
    return (
      <a href={link.href} className={className}>
        {link.label}
      </a>
    );
  }
  return (
    <Link to={link.to} className={className}>
      {link.label}
    </Link>
  );
}
