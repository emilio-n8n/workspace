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
import { useEffect, useState } from "react";
import {
  APPS_PANEL,
  CAPTURES,
  CAPTURES_INTRO,
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
import { CaptureMockup } from "./mockups.tsx";

/*
 * Page d'accueil publique.
 *
 * Règles suivies sur toute la page :
 * - un seul <h1>, puis <h2> par section et <h3> dans les sections : jamais de
 *   niveau sauté, pour que la lecture au lecteur d'écran suive la page ;
 * - chaque section est un repère nommé (`aria-labelledby` vers son titre) ;
 * - chaque élément interactif porte un anneau de focus visible, au clavier
 *   comme à la souris, avec les jetons `ring`/`ring-offset-background` ;
 * - aucune couleur écrite à la main : uniquement les jetons sémantiques ;
 * - les maquettes d'écran déclarent leurs dimensions (voir `mockups.tsx`).
 */

/** Anneau de focus unique du design system, réutilisé par tous les interactifs. */
const focusRing =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

const headingTwo = "font-display text-3xl font-semibold tracking-tight md:text-4xl";
const headingThree = "font-display text-lg font-semibold tracking-tight";
const bodyMuted = "text-sm leading-relaxed text-muted-foreground";

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

/** Registre unique de la suite : jamais de liste en dur qui finit périmée. */
const suiteApps = SUITE_APPS.map((app) => ({
  label: app.name,
  Icon: app.Icon,
  phase: `Phase ${app.phase}`,
}));

export function LandingHeader({
  theme,
  onToggleTheme,
}: {
  theme: Theme;
  onToggleTheme: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);

  // Fermeture au clavier : Échap rend le focus au bouton qui a ouvert le menu.
  useEffect(() => {
    if (!menuOpen) return;
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") setMenuOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [menuOpen]);

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4 md:px-6">
        <Link to="/" className={cn("flex items-center gap-2 rounded-md", focusRing)}>
          <BrandMark className="size-6 text-[10px]" />
          <span className="font-semibold tracking-tight">Workspace</span>
        </Link>
        <span className="hidden text-xs text-muted-foreground lg:block">
          open source · auto-hébergeable
        </span>

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

        <div className="ml-auto flex items-center gap-2 md:ml-3">
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
        className="border-t border-border bg-background px-4 pb-4 md:hidden"
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
    <section
      aria-labelledby="titre-principal"
      className="mx-auto grid max-w-6xl gap-10 px-4 py-16 md:grid-cols-[1.2fr_1fr] md:py-24"
    >
      <div className="flex flex-col gap-6">
        <Badge variant="accent" className="w-fit">
          {HERO.eyebrow}
        </Badge>
        <h1
          id="titre-principal"
          className="font-display text-4xl font-semibold leading-tight tracking-tight md:text-5xl"
        >
          {/* Les espaces vivent dans les chaînes : aucune dépendance au
          formatage JSX, qui supprime les sauts de ligne. */}
          <span>{HERO.titleLead}</span>
          <span className="text-muted-foreground">{HERO.titleAccent}</span>
          <span>{HERO.titleEnd}</span>
        </h1>
        <p className="max-w-xl text-lg leading-relaxed text-muted-foreground">{HERO.intro}</p>
        <div className="flex flex-wrap items-center gap-3">
          <Link to="/app" className={buttonVariants({ size: "lg" })}>
            Ouvrir l'application
          </Link>
          <Link to="/signup" className={buttonVariants({ variant: "outline", size: "lg" })}>
            Créer un compte
          </Link>
        </div>
        <p className="text-sm text-muted-foreground">{HERO.reassurance}</p>
        <dl className="mt-2 flex flex-wrap gap-x-8 gap-y-3 text-sm">
          {HERO.facts.map((fact) => (
            <div key={fact.label} className="flex flex-col gap-0.5">
              <dt className="text-muted-foreground">{fact.label}</dt>
              <dd className="font-medium">{fact.value}</dd>
            </div>
          ))}
        </dl>
      </div>

      <aside
        aria-labelledby="titre-applications"
        className="rounded-xl border border-border bg-card p-6 shadow-soft"
      >
        <h2
          id="titre-applications"
          className="text-xs font-semibold uppercase tracking-widest text-muted-foreground"
        >
          {APPS_PANEL.title}
        </h2>
        <ul className="mt-4 flex flex-col divide-y divide-border">
          {suiteApps.map((app) => (
            <li key={app.label} className="flex items-center gap-3 py-2.5 text-sm">
              <app.Icon className="size-4 text-muted-foreground" />
              <span className="font-medium">{app.label}</span>
              <Badge variant="outline" className="ml-auto">
                {app.phase}
              </Badge>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-xs leading-relaxed text-muted-foreground">{APPS_PANEL.note}</p>
      </aside>
    </section>
  );
}

export function FeaturesSection() {
  return (
    <section
      id="fonctionnalites"
      aria-labelledby="titre-fonctionnalites"
      className="scroll-mt-20 border-t border-border"
    >
      <div className="mx-auto max-w-6xl px-4 py-16">
        <h2 id="titre-fonctionnalites" className={headingTwo}>
          Tout ce qu'une équipe attend, dans une seule suite
        </h2>
        <p className="mt-3 max-w-2xl text-muted-foreground">{FEATURES_INTRO}</p>

        <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((feature) => (
            <li
              key={feature.title}
              className="flex flex-col gap-2 rounded-xl border border-border bg-card p-6 shadow-soft"
            >
              <feature.Icon className="size-5 text-primary" />
              <h3 className={headingThree}>{feature.title}</h3>
              <p className={bodyMuted}>{feature.body}</p>
            </li>
          ))}
        </ul>

        <div className="mt-4 rounded-xl border border-border bg-muted/40 p-6">
          <h3 className={headingThree}>{COMMITMENTS.title}</h3>
          <dl className="mt-4 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {COMMITMENTS.items.map((item) => (
              <div key={item.title} className="flex flex-col gap-1">
                <dt className="text-sm font-medium">{item.title}</dt>
                <dd className={bodyMuted}>{item.body}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </section>
  );
}

export function CapturesSection() {
  return (
    <section
      id="captures"
      aria-labelledby="titre-captures"
      className="scroll-mt-20 border-t border-border bg-muted/40"
    >
      <div className="mx-auto max-w-6xl px-4 py-16">
        <h2 id="titre-captures" className={headingTwo}>
          Captures de l'interface
        </h2>
        <p className="mt-3 max-w-2xl text-muted-foreground">{CAPTURES_INTRO}</p>

        <ul className="mt-10 flex flex-col gap-10">
          {CAPTURES.map((capture, index) => (
            <li key={capture.id}>
              <figure
                className={cn(
                  "grid gap-6 md:grid-cols-[1.5fr_1fr] md:items-center",
                  // Les captures alternent : l'image à gauche, puis à droite.
                  index % 2 === 1 ? "md:[&>*:first-child]:order-2" : undefined,
                )}
              >
                <CaptureMockup
                  mock={capture.mock}
                  id={capture.id}
                  labelledBy={`${capture.id}-titre`}
                />
                <figcaption className="flex flex-col gap-2">
                  <h3 id={`${capture.id}-titre`} className={headingThree}>
                    {capture.title}
                  </h3>
                  <p className={bodyMuted}>{capture.description}</p>
                </figcaption>
              </figure>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

export function PricingSection() {
  return (
    <section
      id="tarifs"
      aria-labelledby="titre-tarifs"
      className="scroll-mt-20 border-t border-border"
    >
      <div className="mx-auto max-w-6xl px-4 py-16">
        <h2 id="titre-tarifs" className={headingTwo}>
          Tarifs
        </h2>
        <p className="mt-3 max-w-2xl text-muted-foreground">{PRICING_INTRO}</p>

        <ul className="mt-10 grid gap-6 md:grid-cols-2">
          {PLANS.map((plan) => (
            <li key={plan.id}>
              <article
                aria-labelledby={`${plan.id}-nom`}
                className={cn(
                  "flex h-full flex-col gap-5 rounded-xl border bg-card p-6 shadow-soft",
                  plan.featured ? "border-primary" : "border-border",
                )}
              >
                <div className="flex flex-col gap-2">
                  <Badge variant={plan.featured ? "accent" : "outline"} className="w-fit">
                    {plan.badge}
                  </Badge>
                  <h3
                    id={`${plan.id}-nom`}
                    className="font-display text-xl font-semibold tracking-tight"
                  >
                    {plan.name}
                  </h3>
                  <p className="text-sm text-muted-foreground">{plan.description}</p>
                </div>

                <p className="flex flex-wrap items-baseline gap-2">
                  <span className="font-display text-4xl font-semibold tracking-tight">
                    {plan.price}
                  </span>
                  <span className="text-sm text-muted-foreground">{plan.priceNote}</span>
                </p>

                <ul className="flex flex-col gap-2">
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
        <div className="mt-10 overflow-hidden rounded-xl border border-border bg-card shadow-soft">
          <Table>
            <TableCaption className="px-5 py-3 text-left text-sm text-muted-foreground">
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
      className="scroll-mt-20 border-t border-border bg-muted/40"
    >
      <div className="mx-auto max-w-3xl px-4 py-16">
        <h2 id="titre-faq" className={headingTwo}>
          Questions fréquentes
        </h2>
        <p className="mt-3 text-muted-foreground">
          Six réponses claires, sans jargon. Une question manque ? Elle trouvera sa place ici.
        </p>

        <ul className="mt-10 flex flex-col gap-3">
          {FAQ.map((item) => (
            <li key={item.question}>
              {/* details/summary : ouverture au clavier native (Entrée, Espace). */}
              <details className="group rounded-xl border border-border bg-card shadow-soft">
                <summary
                  className={cn(
                    "flex cursor-pointer list-none items-center gap-3 rounded-xl px-5 py-4 text-sm font-medium",
                    "[&::-webkit-details-marker]:hidden",
                    focusRing,
                  )}
                >
                  <span className="flex-1">{item.question}</span>
                  <IconChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180 motion-reduce:transition-none" />
                </summary>
                <p className="px-5 pb-4 text-sm leading-relaxed text-muted-foreground">
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
    <section aria-labelledby="titre-cta" className="border-t border-border">
      <div className="mx-auto max-w-6xl px-4 py-20">
        <div className="flex flex-col items-start gap-6 rounded-2xl border border-border bg-card p-8 shadow-soft md:p-12">
          <h2 id="titre-cta" className={headingTwo}>
            {FINAL_CTA.title}
          </h2>
          <p className="max-w-2xl text-lg text-muted-foreground">{FINAL_CTA.body}</p>
          <div className="flex flex-wrap gap-3">
            <Link to="/signup" className={buttonVariants({ size: "lg" })}>
              Créer un compte
            </Link>
            {/* « Ouvrir l'application » reste réservé au héros : un seul lien
                porte ce libellé sur toute la page. */}
            <Link to="/login" className={buttonVariants({ variant: "outline", size: "lg" })}>
              Se connecter
            </Link>
          </div>
          <p className="text-sm text-muted-foreground">{FINAL_CTA.legal}</p>
        </div>
      </div>
    </section>
  );
}

export function LandingFooter() {
  return (
    <footer className="border-t border-border bg-muted/40">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-12 md:grid-cols-[2fr_1fr_1fr_1fr]">
        <div className="flex flex-col gap-3">
          <span className="flex items-center gap-2">
            <BrandMark className="size-7 text-sm" />
            <span className="font-semibold tracking-tight">Workspace</span>
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
      <div className="mx-auto max-w-6xl px-4 pb-10">
        <div className="flex flex-col gap-4 border-t border-border pt-6 md:flex-row md:items-center md:justify-between">
          <p className="text-xs text-muted-foreground">{FOOTER.legal}</p>
          <dl className="flex flex-col gap-1 text-xs text-muted-foreground">
            <div className="flex items-center gap-2">
              <dt className="font-medium">Raccourci clavier principal</dt>
              <dd aria-label="Ctrl ou Meta K">
                <span className="sr-only">Ctrl ou Commande K</span>
                <kbd className="rounded border border-border bg-background px-1.5 py-0.5 font-sans text-[10px] font-medium">
                  ⌘K
                </kbd>
              </dd>
            </div>
          </dl>
        </div>
      </div>
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
