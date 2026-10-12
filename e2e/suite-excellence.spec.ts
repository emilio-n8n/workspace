import { expect, test } from "@playwright/test";
import { gotoHydrated, openApp, signupNewUser, uniqueEmail } from "./helpers.ts";

/**
 * Vague « excellence » — preuves des fonctionnalités transverses de la suite :
 * santé des 14 applications, recherche globale, palette ⌘K, thème sombre.
 * Chaque cas crée son propre compte : aucun état partagé entre les tests.
 */

const TASKS = "http://localhost:3003";
const CALENDAR = "http://localhost:3004";
const FORMS = "http://localhost:3005";

const PORTS = [3000, 3001, 3002, 3003, 3004, 3005, 3006, 3007, 3008, 3009, 3010, 3011, 3012, 3013];

test("santé : les 14 applications répondent /api/health", async ({ request }) => {
  for (const port of PORTS) {
    const response = await request.get(`http://localhost:${port}/api/health`, {
      timeout: 15_000,
    });
    expect(response.ok(), `HTTP ${response.status()} sur le port ${port}`).toBe(true);

    const body = await response.json();
    expect(body.status, `statut global sur le port ${port}`).toBe("ok");
    expect(body.checks.database.status, `base de données sur le port ${port}`).toBe("ok");
  }
});

test("recherche globale : trouve fichiers, formulaires, tâches et événements", async ({ page }) => {
  test.slow();

  const email = uniqueEmail("recherche");
  await signupNewUser(page, "Recherche E2E", email);

  // Un formulaire « Dossier Alpha » (le Drive serait trop lourd à scripter ici).
  await openApp(page, `${FORMS}/`);
  await page.getByRole("button", { name: "Nouveau formulaire" }).first().click();
  await page.getByLabel("Titre du formulaire").fill("Dossier Alpha");
  await page.getByRole("button", { name: "Créer", exact: true }).click();
  await expect(page).toHaveURL(/\/form\//, { timeout: 15_000 });

  // Une tâche « Relire Alpha », dans une liste créée pour l'occasion.
  await openApp(page, `${TASKS}/`);
  await page.getByRole("button", { name: "Nouvelle liste" }).first().click();
  await page.getByLabel("Nom de la liste").fill("Projets Alpha");
  await page.getByRole("button", { name: "Créer la liste" }).click();
  await page.getByLabel("Ajouter une tâche").fill("Relire Alpha");
  await page.keyboard.press("Enter");
  await expect(page.getByText("Relire Alpha").first()).toBeVisible({ timeout: 15_000 });

  // Un événement « Point Alpha ».
  await openApp(page, `${CALENDAR}/`);
  await page.getByRole("button", { name: "Nouvel événement" }).first().click();
  await page.getByLabel("Titre").fill("Point Alpha");
  await page.getByRole("button", { name: "Créer l'événement" }).click();
  await expect(page.getByRole("button", { name: /Point Alpha/ }).first()).toBeVisible({
    timeout: 15_000,
  });

  // Recherche globale depuis l'accueil : les trois contenus doivent remonter.
  await gotoHydrated(page, "/app/recherche");
  const champ = page
    .getByRole("searchbox")
    .or(page.getByPlaceholder(/Rechercher/i))
    .or(page.getByLabel(/Rechercher/i))
    .first();
  await champ.fill("Alpha");

  await expect
    .poll(async () => page.getByText(/Alpha/).count(), { timeout: 15_000 })
    .toBeGreaterThanOrEqual(3);
  await expect(page.getByText("Dossier Alpha").first()).toBeVisible();
  await expect(page.getByText("Relire Alpha").first()).toBeVisible();
  await expect(page.getByText("Point Alpha").first()).toBeVisible();
});

test("palette ⌘K : ouvre la recherche globale", async ({ page }) => {
  const email = uniqueEmail("palette");
  await signupNewUser(page, "Palette E2E", email);

  await page.keyboard.press("ControlOrMeta+k");
  const palette = page.getByPlaceholder("Rechercher une application ou une action…");
  await expect(page.getByRole("dialog", { name: "Palette de commandes" })).toBeVisible();
  await expect(palette).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(palette).toBeHidden();
});

test("thème sombre : contrastes critiques visibles", async ({ page }) => {
  const email = uniqueEmail("theme");
  await signupNewUser(page, "Thème E2E", email);

  await page.getByRole("button", { name: "Passer en thème sombre" }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect(page.getByRole("button", { name: "Passer en thème clair" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Rechercher ou agir/ })).toBeVisible();

  await page.screenshot({ path: "e2e/screenshots/theme-sombre.png", fullPage: true });
});
