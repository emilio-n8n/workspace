import {
  IconCalendar,
  IconFileText,
  IconFolder,
  IconKey,
  IconMail,
  IconSettings,
} from "@workspace/ui";
import type { ComponentType, SVGProps } from "react";

/** Icône du design system (géométrie 16 px, trait 1,6). */
export type LandingIcon = ComponentType<SVGProps<SVGSVGElement>>;

/** Navigation principale — ancres internes, dans l'ordre de la page. */
export const NAV_LINKS: { href: string; label: string }[] = [
  { href: "#fonctionnalites", label: "Fonctionnalités" },
  { href: "#captures", label: "Captures" },
  { href: "#tarifs", label: "Tarifs" },
  { href: "#faq", label: "Questions fréquentes" },
];

export const HERO = {
  eyebrow: "Open source · auto-hébergeable · en développement actif",
  /** Le titre garde « La suite bureautique libre » en tête (repère de marque). */
  titleLead: "La suite bureautique libre, ",
  titleAccent: "auto-hébergeable",
  titleEnd: " et prête pour l'IA.",
  intro:
    "Drive, Docs, Sheets, Slides, Mail, Calendar, Meet et le reste vivent au même endroit : vos fichiers, " +
    "vos échanges et vos échéances ne se dispersent plus. Un serveur MCP officiel permet de piloter la " +
    "suite avec des agents IA qui respectent exactement vos permissions.",
  reassurance: "Aucun abonnement, aucune carte bancaire : vous hébergez, vous possédez.",
  facts: [
    { label: "Licence", value: "AGPL-3.0-only" },
    { label: "Déploiement", value: "Docker, chez vous" },
    { label: "Données", value: "PostgreSQL + S3 ou disque local" },
  ],
} as const;

export const APPS_PANEL = {
  title: "La suite, application par application",
  note:
    "L'avancement affiché est l'avancement réel : nous n'annonçons pas une fonctionnalité avant qu'elle " +
    "ne fonctionne.",
} as const;

export const FEATURES_INTRO =
  "Quatorze applications, un seul compte, un seul endroit pour vos données. Chaque brique est autonome, " +
  "et toutes partagent la même autorisation, revérifiée côté serveur à chaque requête.";

export type Feature = { Icon: LandingIcon; title: string; body: string };

export const FEATURES: Feature[] = [
  {
    Icon: IconFolder,
    title: "Fichiers et dossiers",
    body:
      "Drive range vos documents, feuilles et présentations dans une arborescence lisible, avec partage et " +
      "permissions par organisation.",
  },
  {
    Icon: IconFileText,
    title: "Documents collaboratifs",
    body:
      "Docs, Sheets et Slides s'ouvrent à plusieurs sur le même fichier. Les modifications arrivent au fil " +
      "de la frappe, sans pièce jointe qui circule.",
  },
  {
    Icon: IconCalendar,
    title: "Agenda et tâches",
    body:
      "Calendar et Tasks gardent vos échéances à côté des documents auxquels elles se rapportent, et " +
      "rappellent au bon moment.",
  },
  {
    Icon: IconMail,
    title: "Messagerie et visioconférence",
    body:
      "Mail et Meet restent dans la suite : vos échanges et vos réunions ne quittent jamais votre " +
      "instance.",
  },
  {
    Icon: IconKey,
    title: "Agents IA autorisés",
    body:
      "Un serveur MCP officiel accepte des jetons scopés et révocables. Un agent ne peut jamais faire plus " +
      "que ce que vous lui accordez.",
  },
  {
    Icon: IconSettings,
    title: "Administration",
    body:
      "Organisations, membres, rôles, sessions révocables et journal d'audit — la sécurité se voit, elle ne " +
      "se suppose pas.",
  },
];

export const COMMITMENTS = {
  title: "Nos engagements",
  items: [
    {
      title: "Une seule suite",
      body:
        "Une identité visuelle, des comptes, des fichiers et des permissions partagés entre toutes les " +
        "applications.",
    },
    {
      title: "Autonome",
      body: "Chaque organisation héberge sa propre instance. Aucune dépendance à un service propriétaire.",
    },
    {
      title: "Sécurisée par construction",
      body: "Autorisation côté serveur, isolation des organisations, sessions révocables, journal d'audit.",
    },
    {
      title: "Prête pour l'IA",
      body: "Un serveur MCP officiel, avec jetons scopés et révocables, respecte exactement vos permissions.",
    },
  ],
} as const;

export const CAPTURES_INTRO =
  "Trois écrans types de la suite, présentés dans le design system Workspace : ranger, calculer, planifier. " +
  "Le rendu suit votre thème, clair ou sombre.";

export type Capture = {
  /** Identifiant d'ancre et de libellé accessible. */
  id: string;
  /** Clé de la maquette vectorielle (voir `mockups.tsx`). */
  mock: "drive" | "sheets" | "calendar";
  title: string;
  description: string;
};

export const CAPTURES: Capture[] = [
  {
    id: "capture-drive",
    mock: "drive",
    title: "Drive — l'arborescence des fichiers",
    description:
      "Dossiers, fichiers récents et panneau latéral : toutes les applications de la suite restent à " +
      "portée de clic.",
  },
  {
    id: "capture-sheets",
    mock: "sheets",
    title: "Sheets — une feuille de calcul partagée",
    description:
      "Grille, formules et barre de saisie. Plusieurs personnes travaillent sur la même feuille, sans " +
      "export ni copie envoyée par courriel.",
  },
  {
    id: "capture-calendar",
    mock: "calendar",
    title: "Calendar — la semaine de l'équipe",
    description:
      "Créneaux, événements et ligne de l'heure courante sur un agenda partagé, lisible d'un coup d'œil.",
  },
];

export const PRICING_INTRO =
  "Un seul tarif à connaître : zéro euro. La suite est libre, et elle vit chez vous — vrai pour les quatorze applications.";

export type Plan = {
  id: string;
  badge: string;
  name: string;
  price: string;
  priceNote: string;
  description: string;
  highlights: string[];
  /** Libellé de l'action principale ; absent = offre indisponible. */
  action?: string;
  /** Lien interne de l'action principale. */
  to?: "/signup";
  note: string;
  featured: boolean;
};

export const PLANS: Plan[] = [
  {
    id: "plan-auto-heberge",
    badge: "Gratuit pour toujours",
    name: "Auto-hébergé",
    price: "0 €",
    priceNote: "par utilisateur, sans limite de durée",
    description: "La suite complète, sur votre infrastructure.",
    highlights: [
      "Les quatorze applications, sans limite d'utilisation",
      "Mises à jour et correctifs de sécurité",
      "PostgreSQL et stockage de votre choix (S3 ou disque local)",
      "Documentation et communauté",
    ],
    action: "Créer un compte",
    to: "/signup",
    note: "Vos seuls coûts : le serveur, la base et le stockage que vous choisissez.",
    featured: true,
  },
  {
    id: "plan-assistance",
    badge: "Bientôt disponible",
    name: "Assistance et cloud managé",
    price: "Sur devis",
    priceNote: "offre en préparation",
    description: "Pour les équipes qui veulent la suite sans avoir à l'exploiter.",
    highlights: [
      "Déploiement accompagné et migration des données",
      "Sauvegardes, supervision et mises à jour suivies",
      "Support prioritaire et interlocuteur dédié",
    ],
    note: "Cette offre n'est pas encore ouverte. D'ici là, la suite complète se déploie chez vous.",
    featured: false,
  },
];

/**
 * Comparatif des offres — même ordre de colonnes que `PLANS`.
 *
 * Chaque cellule porte son sens en texte (jamais une couleur ou une icône
 * seule) : le tableau reste lisible au lecteur d'écran comme en impression.
 */
export const PRICING_COMPARISON = {
  caption: "Comparaison des deux offres, ligne par ligne.",
  rows: [
    { label: "Applications", values: ["Les quatorze", "Les quatorze"] },
    { label: "Licence", values: ["AGPL-3.0-only", "AGPL-3.0-only"] },
    { label: "Où vivent vos données", values: ["Votre serveur", "Votre serveur"] },
    { label: "Nombre d'utilisateurs", values: ["Illimité", "Illimité"] },
    { label: "Mises à jour", values: ["Vous décidez du rythme", "Suivies pour vous"] },
    { label: "Sauvegardes", values: ["À votre charge", "Incluses"] },
    { label: "Support", values: ["Documentation et communauté", "Prioritaire et dédié"] },
    { label: "Tarif", values: ["0 €", "Sur devis"] },
  ],
  /** Question de renvoi vers la FAQ de la même page. */
  faqPrompt: "Une question sur les offres ?",
  faqLinkLabel: "Lire les questions fréquentes",
} as const;

export const FAQ: { question: string; answer: string }[] = [
  {
    question: "Puis-je héberger Workspace moi-même ?",
    answer:
      "Oui, c'est même le mode d'emploi principal. L'application se déploie avec Docker sur votre serveur : " +
      "vous gardez la main sur les données, les sauvegardes et le rythme des mises à jour.",
  },
  {
    question: "Mes données restent-elles chez moi ?",
    answer:
      "Oui. Fichiers, documents et messages vivent dans votre base PostgreSQL et votre stockage. Rien n'est " +
      "envoyé à un service tiers, et rien n'est revendu.",
  },
  {
    question: "Comment un agent IA accède-t-il à la suite ?",
    answer:
      "Par le serveur MCP officiel. Vous générez un jeton depuis les réglages, vous lui donnez le minimum " +
      "de permissions nécessaire, et vous pouvez le révoquer à tout moment. L'agent ne peut jamais faire " +
      "plus que ce que vous lui accordez.",
  },
  {
    question: "Quelles applications sont déjà utilisables ?",
    answer:
      "Les quatorze applications de la suite existent et le lanceur affiche leur avancement réel. Nous " +
      "n'annonçons pas une fonctionnalité avant qu'elle ne fonctionne.",
  },
  {
    question: "La suite est-elle vraiment libre ?",
    answer:
      "Oui : licence AGPL-3.0-only. Vous pouvez l'utiliser, la modifier et la redistribuer, y compris dans " +
      "votre organisation, sans demander d'autorisation.",
  },
  {
    question: "Puis-je contribuer ?",
    answer:
      "Oui. Signalez un problème, proposez une correction, améliorez la documentation : le projet avance " +
      "grâce aux personnes qui l'utilisent.",
  },
];

export const FINAL_CTA = {
  title: "Vos données, votre suite, votre serveur",
  body: "Créez votre espace en une minute, ou connectez-vous si vous avez déjà un compte.",
  legal: "Auto-hébergement gratuit · licence AGPL-3.0-only · aucune carte bancaire",
} as const;

export const FOOTER = {
  tagline:
    "Suite bureautique libre et auto-hébergeable, pensée pour les équipes qui gardent la main.",
  columns: [
    {
      label: "La suite",
      links: [
        { kind: "anchor", href: "#fonctionnalites", label: "Fonctionnalités" },
        { kind: "anchor", href: "#captures", label: "Captures" },
        { kind: "anchor", href: "#tarifs", label: "Tarifs" },
        { kind: "anchor", href: "#faq", label: "Questions fréquentes" },
      ],
    },
    {
      label: "Compte",
      links: [
        { kind: "route", to: "/signup", label: "Créer un compte" },
        { kind: "route", to: "/login", label: "Se connecter" },
        { kind: "route", to: "/app", label: "Tableau de bord" },
      ],
    },
  ],
  legal: "Licence AGPL-3.0-only · Interface en français · Polices auto-hébergées",
} as const;

/** Lien de pied de page : ancre interne ou route de l'application. */
export type FooterLink =
  | { kind: "anchor"; href: string; label: string }
  | { kind: "route"; to: "/signup" | "/login" | "/app"; label: string };
