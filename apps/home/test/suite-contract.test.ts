import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Contrat transverse des 14 applications : les fichiers de coquille sont
 * dupliqués par app (une app = un déploiement), ces tests empêchent qu'une
 * copie dérive des autres.
 */
const APPS_DIR = join(import.meta.dirname, "..", "..");
const APPS = [
  ["home", 3000],
  ["drive", 3001],
  ["docs", 3002],
  ["tasks", 3003],
  ["calendar", 3004],
  ["forms", 3005],
  ["sheets", 3006],
  ["slides", 3007],
  ["mail", 3008],
  ["chat", 3009],
  ["meet", 3010],
  ["sites", 3011],
  ["classroom", 3012],
  ["admin", 3013],
] as const;

const read = (...parts: string[]) => readFileSync(join(APPS_DIR, ...parts), "utf8");

describe.each(APPS)("application %s", (app, port) => {
  it(`démarre en développement sur le port ${port} (aligné sur getAppUrls)`, () => {
    const pkg = JSON.parse(read(app, "package.json")) as { scripts: { dev: string } };
    expect(pkg.scripts.dev).toBe(`vite dev --port ${port}`);
  });

  it("filtre le rail d'applications selon le type d'espace actif", () => {
    const layout = read(app, "src", "routes", app === "home" ? "app.tsx" : "_app.tsx");
    expect(layout).toContain("resolveSuiteApps(urls, workspace.activeOrganization?.kind)");
  });

  it("lit l'espace via le helper partagé (type de compte inclus)", () => {
    expect(read(app, "src", "server", "context.ts")).toContain("getActiveWorkspace(");
  });

  it("masque les outils de développement en E2E (bouton flottant)", () => {
    expect(read(app, "src", "routes", "__root.tsx")).toContain(
      'import.meta.env.VITE_DEVTOOLS !== "off"',
    );
  });
});
