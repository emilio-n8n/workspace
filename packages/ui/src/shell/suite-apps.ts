import type { ComponentType, SVGProps } from "react";
import {
  IconCalendar,
  IconChat,
  IconCheckSquare,
  IconClipboard,
  IconFileText,
  IconFolder,
  IconGlobe,
  IconGraduation,
  IconGrid,
  IconHome,
  IconMail,
  IconPresentation,
  IconSettings,
  IconVideo,
} from "../icons.tsx";

/**
 * Registre de la suite — source unique du rail d'applications, du lanceur
 * et du tableau de bord. `shipped` = réellement utilisable (jamais de faux lien).
 */
export type SuiteAppId =
  | "home"
  | "drive"
  | "docs"
  | "sheets"
  | "slides"
  | "calendar"
  | "tasks"
  | "forms"
  | "mail"
  | "chat"
  | "meet"
  | "sites"
  | "classroom"
  | "admin";

/** Type de compte choisi à l'inscription (miroir de `@workspace/auth`). */
export type AccountKind = "personal" | "business" | "education";

export interface SuiteAppDefinition {
  id: SuiteAppId;
  name: string;
  description: string;
  phase: number;
  shipped: boolean;
  /** Types de compte qui voient l'application ; absent = tout le monde. */
  audiences?: AccountKind[];
  /** Classe de ton statique (petite marque d'identité uniquement). */
  toneClass: string;
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
}

export const SUITE_APPS: SuiteAppDefinition[] = [
  {
    id: "home",
    name: "Accueil",
    description: "Vue d'ensemble et lanceur",
    phase: 1,
    shipped: true,
    toneClass: "text-primary",
    Icon: IconHome,
  },
  {
    id: "drive",
    name: "Drive",
    description: "Fichiers et dossiers",
    phase: 2,
    shipped: true,
    toneClass: "text-app-drive",
    Icon: IconFolder,
  },
  {
    id: "docs",
    name: "Docs",
    description: "Traitement de texte",
    phase: 2,
    shipped: true,
    toneClass: "text-app-docs",
    Icon: IconFileText,
  },
  {
    id: "sheets",
    name: "Sheets",
    description: "Tableur avec formules",
    phase: 3,
    shipped: true,
    toneClass: "text-app-sheets",
    Icon: IconGrid,
  },
  {
    id: "slides",
    name: "Slides",
    description: "Présentations",
    phase: 3,
    shipped: true,
    toneClass: "text-app-slides",
    Icon: IconPresentation,
  },
  {
    id: "calendar",
    name: "Calendar",
    description: "Agenda partagé",
    phase: 3,
    shipped: true,
    toneClass: "text-app-calendar",
    Icon: IconCalendar,
  },
  {
    id: "tasks",
    name: "Tasks",
    description: "Tâches et listes",
    phase: 3,
    shipped: true,
    toneClass: "text-app-tasks",
    Icon: IconCheckSquare,
  },
  {
    id: "forms",
    name: "Forms",
    description: "Formulaires et réponses",
    phase: 3,
    shipped: true,
    toneClass: "text-app-forms",
    Icon: IconClipboard,
  },
  {
    id: "mail",
    name: "Mail",
    description: "Messagerie",
    phase: 4,
    shipped: true,
    toneClass: "text-app-mail",
    Icon: IconMail,
  },
  {
    id: "chat",
    name: "Chat",
    description: "Discussions d'équipe",
    phase: 4,
    shipped: true,
    toneClass: "text-app-chat",
    Icon: IconChat,
  },
  {
    id: "meet",
    name: "Meet",
    description: "Visioconférence",
    phase: 4,
    shipped: true,
    toneClass: "text-app-meet",
    Icon: IconVideo,
  },
  {
    id: "sites",
    name: "Sites",
    description: "Sites internes",
    phase: 5,
    shipped: true,
    toneClass: "text-app-sites",
    audiences: ["business", "education"],
    Icon: IconGlobe,
  },
  {
    id: "classroom",
    name: "Classroom",
    description: "Cours et devoirs",
    phase: 5,
    shipped: true,
    toneClass: "text-app-classroom",
    audiences: ["education"],
    Icon: IconGraduation,
  },
  {
    id: "admin",
    name: "Admin",
    description: "Administration",
    phase: 5,
    shipped: true,
    toneClass: "text-app-admin",
    audiences: ["business", "education"],
    Icon: IconSettings,
  },
];

/** Application + son URL réelle (fournie par l'application hôtesse). */
export type ResolvedSuiteApp = SuiteAppDefinition & { href?: string };

/**
 * Associe les URLs configurées aux définitions du registre.
 *
 * `kind` restreint la suite au type de compte (personnel, entreprise,
 * éducation) : un espace personnel ne voit ni Classroom, ni Sites, ni Admin.
 * Sans `kind` (anciens espaces créés avant le choix du type), la suite complète
 * reste visible — la parité ascendante prime.
 */
export function resolveSuiteApps(
  urls: Partial<Record<SuiteAppId, string>>,
  kind?: AccountKind,
): ResolvedSuiteApp[] {
  return SUITE_APPS.filter((app) => !kind || !app.audiences || app.audiences.includes(kind)).map(
    (app) => ({ ...app, href: urls[app.id] }),
  );
}

/** Une application est-elle proposée pour ce type d'espace ? (type inconnu : oui) */
export function isAppAvailable(id: SuiteAppId, kind?: AccountKind): boolean {
  const app = SUITE_APPS.find((candidate) => candidate.id === id);
  return !kind || !app?.audiences || app.audiences.includes(kind);
}

export function shippedApps(apps: ResolvedSuiteApp[]): ResolvedSuiteApp[] {
  return apps.filter((app) => app.shipped && app.href);
}
