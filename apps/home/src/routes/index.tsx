import { createFileRoute } from "@tanstack/react-router";
import { currentTheme, type Theme, toggleTheme } from "@workspace/ui";
import { useEffect, useState } from "react";
import {
  CapturesSection,
  FaqSection,
  FeaturesSection,
  FinalCtaSection,
  HeroSection,
  LandingFooter,
  LandingHeader,
  PricingSection,
} from "../landing/sections.tsx";

export const Route = createFileRoute("/")({
  component: LandingPage,
  head: () => ({
    links: externalOrigins.map((origin) => ({ rel: "preconnect", href: origin })),
  }),
});

/*
 * Page d'accueil — composition des six sections, dans l'ordre annoncé :
 * héros, fonctionnalités, captures, tarifs, questions fréquentes, appel à
 * l'action.
 *
 * Performance — ce que la page fait et pourquoi :
 * - aucune ressource tierce : les polices sont auto-hébergées
 *   (`@workspace/design-tokens`, `font-display: swap`), les captures sont des
 *   SVG en ligne. Le premier écran est donc peint sans requête supplémentaire ;
 * - chaque média déclare ses dimensions (`width`/`height` sur les SVG des
 *   captures) et `h-auto w-full` : le rapport 8/5 est réservé avant l'application
 *   de la feuille de styles, donc aucun décalage de mise en page ;
 * - par conséquent, aucune balise `preconnect` : préconnecter une origine que la
 *   page ne contacte pas ouvrirait une connexion DNS/TCP/TLS pour rien. Le jour
 *   où une ressource externe apparaît (CDN d'images, API distante), la liste
 *   `externalOrigins` ci-dessous la déclare et l'indice est émis
 *   automatiquement dans le `<head>` de la route.
 */

/** Origines réellement contactées par la page (vides : page auto-suffisante). */
const externalOrigins: string[] = [];

function LandingPage() {
  // Le thème est appliqué avant la première peinture par `themeInitScript` :
  // l'état local part du thème clair pour rester identique au rendu serveur.
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    setTheme(currentTheme());
  }, []);

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      {/* Premier élément focusable de la page : évite l'en-tête au clavier. */}
      <a
        href="#contenu"
        className={[
          "fixed left-4 top-4 z-50 -translate-y-24 rounded-md bg-primary px-3 py-2",
          "text-sm font-medium text-primary-foreground shadow-lift transition-transform",
          "focus-visible:translate-y-0 focus-visible:outline-none focus-visible:ring-2",
          "focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          "motion-reduce:transition-none",
        ].join(" ")}
      >
        Aller au contenu
      </a>

      <LandingHeader theme={theme} onToggleTheme={() => setTheme(toggleTheme())} />

      <main id="contenu" tabIndex={-1} className="flex-1 focus-visible:outline-none">
        <HeroSection />
        <FeaturesSection />
        <CapturesSection />
        <PricingSection />
        <FaqSection />
        <FinalCtaSection />
      </main>

      <LandingFooter />
    </div>
  );
}
