import { listEvents } from "@workspace/calendar";
import { searchEntries } from "@workspace/drive";
import { listForms } from "@workspace/forms";
import type { Actor } from "@workspace/permissions";
import { listLists, listTasks } from "@workspace/tasks";

/**
 * Recherche globale de la suite.
 *
 * Composition stricte : ce paquet ne lit jamais les tables des modules, il
 * agrège leurs services publics — les mêmes points d'entrée que l'UI, donc les
 * mêmes contrôles de permissions et le même cloisonnement par organisation.
 */

export type SearchResultKind = "file" | "task" | "form" | "event";

export type SearchResult = {
  kind: SearchResultKind;
  id: string;
  title: string;
  subtitle: string;
  appId: "drive" | "tasks" | "forms" | "calendar";
};

export type SearchErrorCode = "validation";

export class SearchError extends Error {
  readonly code: SearchErrorCode;
  constructor(code: SearchErrorCode, message: string) {
    super(message);
    this.name = "SearchError";
    this.code = code;
  }
}

/** Garde-fous d'entrée : une requête trop courte est un bruit, trop longue un abus. */
const MIN_QUERY_LENGTH = 2;
const MAX_QUERY_LENGTH = 100;

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

/** Résultats collectés au maximum par source, avant fusion et rang. */
const PER_SOURCE_LIMIT = 10;
/** Listes de tâches parcourues au maximum (protection contre le coût en N+1). */
const TASK_LIST_SCAN_LIMIT = 20;

/** Fenêtre des événements examinés : 30 jours passés, 180 jours à venir. */
const EVENT_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000;
const EVENT_LOOKAHEAD_MS = 180 * 24 * 60 * 60 * 1000;

/** Ordre d'affichage des familles : la plus fréquente d'abord. */
const KIND_ORDER: readonly SearchResultKind[] = ["file", "form", "task", "event"];

/** Types MIME connus → libellés français (alignés sur l'UI Drive). */
const MIME_LABELS: Record<string, string> = {
  "application/vnd.workspace.docs+json": "Document",
  "application/vnd.workspace.sheets+json": "Feuille",
  "application/vnd.workspace.slides+json": "Présentation",
  "application/vnd.workspace.forms+json": "Formulaire",
  "application/vnd.workspace.sites+json": "Site",
  "application/pdf": "PDF",
};

/** Libellés de statut des tâches (alignés sur l'UI Tasks). */
const TASK_STATUS_LABELS: Record<string, string> = {
  todo: "À faire",
  in_progress: "En cours",
  done: "Terminée",
};

function mimeLabel(entry: { kind: string; mimeType: string | null }): string {
  if (entry.kind === "folder") return "Dossier";
  const mimeType = entry.mimeType ?? "";
  const known = MIME_LABELS[mimeType];
  if (known) return known;
  if (mimeType.startsWith("image/")) return "Image";
  return "Fichier";
}

function formatEventDate(startsAt: string): string {
  return new Date(startsAt).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

// ---------------------------------------------------------------------------
// Sources — chacune via le service public de son module
// ---------------------------------------------------------------------------

async function searchFiles(actor: Actor, query: string, limit: number): Promise<SearchResult[]> {
  const entries = await searchEntries(actor, { query, limit });
  return entries.map((entry): SearchResult => {
    return {
      kind: "file",
      id: entry.id,
      title: entry.name,
      subtitle: mimeLabel(entry),
      appId: "drive",
    };
  });
}

async function searchForms(actor: Actor, needle: string): Promise<SearchResult[]> {
  const forms = await listForms(actor);
  const results: SearchResult[] = [];
  for (const form of forms) {
    if (results.length >= PER_SOURCE_LIMIT) break;
    if (!form.title.toLowerCase().includes(needle)) continue;
    results.push({
      kind: "form",
      id: form.fileId,
      title: form.title,
      subtitle: `Formulaire · ${form.responseCount} réponse(s)`,
      appId: "forms",
    });
  }
  return results;
}

async function searchTasks(actor: Actor, needle: string): Promise<SearchResult[]> {
  const lists = await listLists(actor);
  const results: SearchResult[] = [];
  for (const { list } of lists.slice(0, TASK_LIST_SCAN_LIMIT)) {
    if (results.length >= PER_SOURCE_LIMIT) break;
    const tasks = await listTasks(actor, { listId: list.id });
    for (const task of tasks) {
      if (results.length >= PER_SOURCE_LIMIT) break;
      if (!task.title.toLowerCase().includes(needle)) continue;
      results.push({
        kind: "task",
        id: task.id,
        title: task.title,
        subtitle: `Liste « ${list.name} » · ${TASK_STATUS_LABELS[task.status] ?? task.status}`,
        appId: "tasks",
      });
    }
  }
  return results;
}

async function searchEvents(actor: Actor, needle: string): Promise<SearchResult[]> {
  const now = Date.now();
  const events = await listEvents(actor, {
    from: new Date(now - EVENT_LOOKBACK_MS).toISOString(),
    to: new Date(now + EVENT_LOOKAHEAD_MS).toISOString(),
  });

  const results: SearchResult[] = [];
  for (const event of events) {
    if (results.length >= PER_SOURCE_LIMIT) break;
    const matches =
      event.title.toLowerCase().includes(needle) ||
      (event.description?.toLowerCase().includes(needle) ?? false);
    if (!matches) continue;
    results.push({
      kind: "event",
      id: event.id,
      title: event.title,
      subtitle: `${formatEventDate(event.startsAt)} · ${event.calendarName}`,
      appId: "calendar",
    });
  }
  return results;
}

/** Une source en panne ne doit jamais faire échouer la recherche globale. */
async function searchSource(
  name: string,
  search: () => Promise<SearchResult[]>,
): Promise<SearchResult[]> {
  try {
    return await search();
  } catch (error) {
    console.error(`[search] source « ${name} » indisponible :`, error);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Fusion, rang et déduplication
// ---------------------------------------------------------------------------

/** 0 : le titre commence par la requête · 1 : titre contient · 2 : reste (sous-titre, description). */
function matchRank(result: SearchResult, needle: string): number {
  const title = result.title.toLowerCase();
  if (title.startsWith(needle)) return 0;
  if (title.includes(needle)) return 1;
  return 2;
}

function compareResults(a: SearchResult, b: SearchResult, needle: string): number {
  const kindDelta = KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind);
  if (kindDelta !== 0) return kindDelta;
  return matchRank(a, needle) - matchRank(b, needle);
}

/**
 * Recherche de l'acteur dans toute la suite, toutes sources confondues.
 *
 * Résultats dédupliqués par (type, identifiant), classés par famille puis par
 * pertinence — tri stable, l'ordre des sources ne change donc pas les ex æquo.
 */
export async function searchEverything(
  actor: Actor,
  input: { query: string; limit?: number },
): Promise<SearchResult[]> {
  const query = input.query.trim();
  if (query.length < MIN_QUERY_LENGTH) {
    throw new SearchError("validation", "Saisissez au moins 2 caractères pour rechercher.");
  }
  if (query.length > MAX_QUERY_LENGTH) {
    throw new SearchError("validation", "La recherche ne peut pas dépasser 100 caractères.");
  }

  const rawLimit = input.limit ?? DEFAULT_LIMIT;
  const limit = Math.min(
    Math.max(Number.isFinite(rawLimit) ? Math.trunc(rawLimit) : DEFAULT_LIMIT, 1),
    MAX_LIMIT,
  );

  const needle = query.toLowerCase();

  const groups = await Promise.all([
    searchSource("drive", () => searchFiles(actor, query, limit)),
    searchSource("forms", () => searchForms(actor, needle)),
    searchSource("tasks", () => searchTasks(actor, needle)),
    searchSource("calendar", () => searchEvents(actor, needle)),
  ]);

  const seen = new Set<string>();
  const merged: SearchResult[] = [];
  for (const group of groups) {
    for (const result of group) {
      const key = `${result.kind}:${result.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(result);
    }
  }

  merged.sort((a, b) => compareResults(a, b, needle));
  return merged.slice(0, limit);
}
