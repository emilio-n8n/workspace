/**
 * Menu de navigation d'un site (TASK-006).
 *
 * Module pur. Le menu reprend **l'ordre des pages** : déplacer une page dans
 * la liste déplace son entrée dans le menu, ce qui évite deux ordres
 * divergents. Ce qui est éditable, entrée par entrée, c'est le **libellé**
 * (indépendant du titre de la page) et la **visibilité** (une page peut
 * rester accessible par son URL sans figurer au menu).
 *
 * `navigation` vaut `null` en base tant que le menu n'a pas été personnalisé :
 * il est alors dérivé des pages.
 */

import { escapeHtml } from "./markdown.ts";

/** Une page telle que le menu la connaît. */
export type NavigationPage = { id: string; title: string; slug: string };

export type NavigationItem = { pageId: string; label: string; visible: boolean };

/** Longueur maximale d'un libellé de menu (les intitulés restent courts). */
export const NAV_LABEL_MAX = 80;

/** Menu par défaut : toutes les pages, visibles, dans l'ordre des pages. */
export function navigationFromPages(pages: readonly NavigationPage[]): NavigationItem[] {
  return pages.map((page) => ({ pageId: page.id, label: page.title, visible: true }));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function textLabel(value: unknown): string | null {
  return typeof value === "string" ? value.trim().slice(0, NAV_LABEL_MAX) : null;
}

/**
 * Normalise un menu **relu en base** : les entrées illisibles ou qui
 * référencent une page disparue sont écartées, les pages sans entrée sont
 * ajoutées en fin de menu (une page créée après coup apparaît au menu), et
 * l'ordre suit toujours celui des pages.
 */
export function normalizeNavigation(
  value: unknown,
  pages: readonly NavigationPage[],
): NavigationItem[] {
  const byId = new Map(pages.map((page) => [page.id, page]));
  const stored = new Map<string, NavigationItem>();

  if (Array.isArray(value)) {
    for (const raw of value) {
      if (!isRecord(raw)) continue;
      const pageId = raw.pageId;
      if (typeof pageId !== "string") continue;
      const page = byId.get(pageId);
      if (!page || stored.has(pageId)) continue;
      stored.set(pageId, {
        pageId,
        label: textLabel(raw.label) || page.title,
        visible: typeof raw.visible === "boolean" ? raw.visible : true,
      });
    }
  }

  return pages.map(
    (page) => stored.get(page.id) ?? { pageId: page.id, label: page.title, visible: true },
  );
}

/**
 * Normalise un menu **reçu pour écriture** et signale en français la première
 * raison de refus : page inconnue, page en double, libellé trop long.
 */
export function checkNavigation(
  value: unknown,
  pages: readonly NavigationPage[],
): { navigation: NavigationItem[]; error: string | null } {
  const fallback = { navigation: navigationFromPages(pages), error: null as string | null };
  if (value == null) return fallback;
  if (!Array.isArray(value)) {
    return { navigation: [], error: "Le menu de navigation est invalide." };
  }

  const known = new Set(pages.map((page) => page.id));
  const seen = new Set<string>();
  for (const raw of value) {
    if (!isRecord(raw)) return { navigation: [], error: "Entrée de menu invalide." };
    const pageId = raw.pageId;
    if (typeof pageId !== "string" || !known.has(pageId)) {
      return { navigation: [], error: "Le menu référence une page inconnue." };
    }
    if (seen.has(pageId)) {
      return { navigation: [], error: "Une page apparaît deux fois dans le menu." };
    }
    seen.add(pageId);
    const label = raw.label;
    if (label != null && typeof label !== "string") {
      return { navigation: [], error: "Libellé de menu invalide." };
    }
    if (typeof label === "string" && label.trim().length > NAV_LABEL_MAX) {
      return {
        navigation: [],
        error: `Libellé de menu limité à ${NAV_LABEL_MAX} caractères.`,
      };
    }
    if (raw.visible != null && typeof raw.visible !== "boolean") {
      return { navigation: [], error: "Visibilité de menu invalide." };
    }
  }

  return { navigation: normalizeNavigation(value, pages), error: null };
}

/** Modifie le libellé d'une entrée ; les autres entrées sont inchangées. */
export function setNavigationLabel(
  items: readonly NavigationItem[],
  pageId: string,
  label: string,
): NavigationItem[] {
  return items.map((item) =>
    item.pageId === pageId ? { ...item, label: label.trim().slice(0, NAV_LABEL_MAX) } : item,
  );
}

/** Affiche ou masque une entrée du menu (la page reste joignable par son URL). */
export function toggleNavigationVisibility(
  items: readonly NavigationItem[],
  pageId: string,
): NavigationItem[] {
  return items.map((item) => (item.pageId === pageId ? { ...item, visible: !item.visible } : item));
}

/** Nombre d'entrées masquées : le menu lui-même n'affiche que les visibles. */
export function hiddenNavigationCount(items: readonly NavigationItem[]): number {
  return items.filter((item) => !item.visible).length;
}

/**
 * HTML du menu de navigation. Les libellés sont échappés, les liens sont
 * internes (chemins dérivés du slug) et la page courante porte
 * `aria-current="page"`. Les entrées masquées n'apparaissent pas.
 */
export function renderNavigation(
  pages: readonly NavigationPage[],
  items: readonly NavigationItem[],
  activePageId: string | null,
): string {
  const byId = new Map(pages.map((page) => [page.id, page]));
  const links = items
    .filter((item) => item.visible && byId.has(item.pageId))
    .map((item) => {
      const page = byId.get(item.pageId);
      if (!page) return "";
      const current = item.pageId === activePageId;
      const appearance = current
        ? "bg-primary text-primary-foreground"
        : "text-muted-foreground hover:bg-muted";
      return `<li><a href="/${escapeHtml(page.slug)}" class="rounded-full px-3 py-1 text-xs font-medium ${appearance}"${
        current ? ' aria-current="page"' : ""
      }>${escapeHtml(item.label)}</a></li>`;
    });

  return `<nav aria-label="Menu du site" class="flex flex-wrap items-center gap-1"><ul class="flex flex-wrap items-center gap-1">${links.join(
    "",
  )}</ul></nav>`;
}
