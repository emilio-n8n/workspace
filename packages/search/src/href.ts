/**
 * Lien de destination d'un résultat de recherche (module pur, sans accès base) :
 * les documents, feuilles, présentations et formulaires s'ouvrent dans leur
 * éditeur, les dossiers dans Drive — au lieu de tout renvoyer à l'accueil d'une app.
 */
export type SearchHrefInput = {
  kind: "file" | "task" | "form" | "event";
  id: string;
  appId: "drive" | "tasks" | "forms" | "calendar";
  mimeType?: string | null;
  isFolder?: boolean;
};

export type SearchHrefUrls = Record<
  "drive" | "docs" | "sheets" | "slides" | "forms" | "tasks" | "calendar" | "sites",
  string
>;

export const EDITOR_ROUTES: Record<string, { app: keyof SearchHrefUrls; path: string }> = {
  "application/vnd.workspace.docs+json": { app: "docs", path: "doc" },
  "application/vnd.workspace.sheets+json": { app: "sheets", path: "sheet" },
  "application/vnd.workspace.slides+json": { app: "slides", path: "slide" },
  "application/vnd.workspace.forms+json": { app: "forms", path: "form" },
};

export function searchResultHref(result: SearchHrefInput, urls: SearchHrefUrls): string {
  const id = encodeURIComponent(result.id);
  switch (result.appId) {
    case "drive": {
      if (result.isFolder) return `${urls.drive}/${id}`;
      const editor = result.mimeType ? EDITOR_ROUTES[result.mimeType] : undefined;
      if (editor) return `${urls[editor.app]}/${editor.path}/${id}`;
      return `${urls.drive}/`;
    }
    case "forms":
      return `${urls.forms}/form/${id}`;
    case "tasks":
      return `${urls.tasks}/`;
    case "calendar":
      return `${urls.calendar}/`;
  }
}
