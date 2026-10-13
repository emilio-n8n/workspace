import { AxeBuilder } from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { openApp, signupNewUser, uniqueEmail } from "./helpers.ts";

/**
 * Portes d'accessibilité automatisées (axe-core, règles WCAG 2.0 A + AA)
 * sur les surfaces à plus fort trafic : accueil public, connexion et
 * inscription, lanceur et palette ⌘K, Drive et formulaire public, thème
 * sombre. Aucune règle n'est désactivée : une violation échoue en nommant
 * la règle, ce qui rend la régression actionnable.
 */

const HOME = "http://localhost:3000";
const DRIVE = "http://localhost:3001";
const FORMS = "http://localhost:3005";

/** Analyse la page courante ; l'échec liste chaque règle violée. */
async function expectNoViolations(page: Page, include?: string): Promise<void> {
  const builder = new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]);
  const { violations } = await (include ? builder.include(include) : builder).analyze();
  expect(
    violations.map(
      (v) => `${v.id} — ${v.help} (${v.nodes.length}×) : ${v.nodes[0]?.target?.[0] ?? ""}`,
    ),
  ).toEqual([]);
}

/** Charge l'URL (hydratation attendue) puis vérifie l'accessibilité. */
async function analyze(page: Page, url: string, include?: string): Promise<void> {
  await openApp(page, url);
  await expectNoViolations(page, include);
}

test("a11y : accueil public", async ({ page }) => {
  await analyze(page, `${HOME}/`);
});

test("a11y : connexion et inscription", async ({ page }) => {
  await analyze(page, `${HOME}/login`);
  await analyze(page, `${HOME}/signup`);
});

test("a11y : lanceur et palette ⌘K", async ({ page }) => {
  const email = uniqueEmail("a11y-app");
  await signupNewUser(page, "A11y Lanceur", email);

  await analyze(page, `${HOME}/app`);

  await page.keyboard.press("ControlOrMeta+k");
  await expect(page.getByRole("dialog", { name: "Palette de commandes" })).toBeVisible();
  await expectNoViolations(page);
  await page.keyboard.press("Escape");
  await expect(page.getByPlaceholder("Rechercher une application ou une action…")).toBeHidden();
});

test("a11y : Drive et formulaires publics", async ({ page }) => {
  test.slow();

  const email = uniqueEmail("a11y-form");
  await signupNewUser(page, "A11y Formulaire", email);

  // Drive : la surface de fichiers la plus consultée, via le SSO.
  await analyze(page, `${DRIVE}/`);

  // Un formulaire publié, puis la page publique qu'il expose.
  await openApp(page, `${FORMS}/`);
  await page.getByRole("button", { name: "Nouveau formulaire" }).first().click();
  await page.getByLabel("Titre du formulaire").fill("Enquête accessibilité");
  await page.getByRole("button", { name: "Créer", exact: true }).click();
  await expect(page).toHaveURL(/\/form\//, { timeout: 25_000 });

  await page.getByRole("button", { name: "Texte court" }).click();
  await page.getByLabel("Intitulé de la question").fill("Votre avis");
  await page.getByLabel("Statut").selectOption("open");
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByRole("status")).toContainText("Enregistré", { timeout: 15_000 });

  const [publicPage] = await Promise.all([
    page.waitForEvent("popup"),
    page.getByRole("link", { name: "Ouvrir" }).click(),
  ]);
  await publicPage.waitForSelector("html[data-hydrated='true']", { timeout: 40_000 });
  const publicUrl = publicPage.url();
  expect(publicUrl).toContain("/f/");
  await expectNoViolations(publicPage);
  await publicPage.close();
});

test("a11y : thème sombre — accueil app", async ({ page }) => {
  const email = uniqueEmail("a11y-theme");
  await signupNewUser(page, "A11y Thème", email);

  await page.getByRole("button", { name: "Passer en thème sombre" }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);

  await analyze(page, `${HOME}/app`);
});
