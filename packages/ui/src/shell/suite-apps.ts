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

export interface SuiteAppDefinition {
  id: SuiteAppId;
  name: string;
  description: string;
  phase: number;
  shipped: boolean;
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
    description: "Tableur",
    phase: 3,
    shipped: false,
    toneClass: "text-app-sheets",
    Icon: IconGrid,
  },
  {
    id: "slides",
    name: "Slides",
    description: "Présentations",
    phase: 3,
    shipped: false,
    toneClass: "text-app-slides",
    Icon: IconPresentation,
  },
  {
    id: "calendar",
    name: "Calendar",
    description: "Agenda partagé",
    phase: 3,
    shipped: false,
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
    description: "Formulaires",
    phase: 3,
    shipped: false,
    toneClass: "text-app-forms",
    Icon: IconClipboard,
  },
  {
    id: "mail",
    name: "Mail",
    description: "Messagerie",
    phase: 4,
    shipped: false,
    toneClass: "text-app-mail",
    Icon: IconMail,
  },
  {
    id: "chat",
    name: "Chat",
    description: "Discussions",
    phase: 4,
    shipped: false,
    toneClass: "text-app-chat",
    Icon: IconChat,
  },
  {
    id: "meet",
    name: "Meet",
    description: "Visioconférence",
    phase: 4,
    shipped: false,
    toneClass: "text-app-meet",
    Icon: IconVideo,
  },
  {
    id: "sites",
    name: "Sites",
    description: "Sites internes",
    phase: 5,
    shipped: false,
    toneClass: "text-app-sites",
    Icon: IconGlobe,
  },
  {
    id: "classroom",
    name: "Classroom",
    description: "Classes et devoirs",
    phase: 5,
    shipped: false,
    toneClass: "text-app-classroom",
    Icon: IconGraduation,
  },
  {
    id: "admin",
    name: "Admin",
    description: "Administration",
    phase: 5,
    shipped: false,
    toneClass: "text-app-admin",
    Icon: IconSettings,
  },
];

/** Application + son URL réelle (fournie par l'application hôtesse). */
export type ResolvedSuiteApp = SuiteAppDefinition & { href?: string };

/** Associe les URLs configurées aux définitions du registre. */
export function resolveSuiteApps(
  urls: Partial<Record<SuiteAppId, string>>,
): ResolvedSuiteApp[] {
  return SUITE_APPS.map((app) => ({ ...app, href: urls[app.id] }));
}

export function shippedApps(apps: ResolvedSuiteApp[]): ResolvedSuiteApp[] {
  return apps.filter((app) => app.shipped && app.href);
}
