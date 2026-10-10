import { expect, type Page, test } from "@playwright/test";

/**
 * Parcours réellement vérifiés dans un navigateur :
 * inscription → espace personnel → déconnexion → reconnexion,
 * garde d'accès sur /app, erreurs d'authentification.
 */

const PASSWORD = "mot-de-passe-123";

function uniqueEmail(): string {
  return `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@exemple.org`;
}

/** Navigue puis attend l'hydratation complète (aucune interaction avant). */
async function gotoHydrated(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.waitForSelector("html[data-hydrated='true']", { timeout: 30_000 });
}

test("page d'accueil : identité, CTA et bascule de thème", async ({ page }) => {
  await gotoHydrated(page, "/");

  await expect(page.getByRole("heading", { level: 1 })).toContainText("La suite bureautique libre");
  await expect(page.getByRole("link", { name: "Ouvrir l'application" })).toBeVisible();
  await expect(page.getByText("AGPL-3.0-only").first()).toBeVisible();

  // Le thème sombre fonctionne (la classe est posée sur <html>).
  await page.getByRole("button", { name: /thème/i }).first().click();
  await expect(page.locator("html")).toHaveClass(/dark/);

  await page.screenshot({ path: "e2e/screenshots/accueil-sombre.png", fullPage: true });
});

test("/app redirige vers /login sans session", async ({ page }) => {
  await gotoHydrated(page, "/app");
  await expect(page).toHaveURL(/\/login$/);

  await page.screenshot({ path: "e2e/screenshots/login.png", fullPage: true });
});

test("inscription → espace personnel → déconnexion → reconnexion", async ({ page }) => {
  const email = uniqueEmail();

  // Inscription
  await gotoHydrated(page, "/signup");
  await page.getByLabel("Nom complet").fill("Camille E2E");
  await page.getByLabel("Adresse e-mail").fill(email);
  await page.getByLabel("Mot de passe").fill(PASSWORD);
  await page.getByRole("button", { name: "Créer mon compte" }).click();

  // Tableau de bord avec organisation personnelle
  await expect(page).toHaveURL(/\/app/, { timeout: 25_000 });
  await expect(page.getByRole("heading", { name: /Bonjour/ })).toBeVisible();
  await expect(page.getByText("Espace personnel").first()).toBeVisible();
  await expect(page.getByText(email).first()).toBeVisible();

  await page.screenshot({ path: "e2e/screenshots/app.png", fullPage: true });

  // Déconnexion
  await page.getByRole("button", { name: "Se déconnecter" }).click();
  await expect(page).toHaveURL(/\/$/, { timeout: 25_000 });

  // /app est de nouveau protégé
  await page.goto("/app");
  await expect(page).toHaveURL(/\/login$/);

  // Reconnexion
  await gotoHydrated(page, "/login");
  await page.getByLabel("Adresse e-mail").fill(email);
  await page.getByLabel("Mot de passe").fill(PASSWORD);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page).toHaveURL(/\/app/, { timeout: 25_000 });
  await expect(page.getByRole("heading", { name: /Bonjour/ })).toBeVisible();
});

test("erreur de connexion affichée en français", async ({ page }) => {
  await gotoHydrated(page, "/login");
  await page.getByLabel("Adresse e-mail").fill("inconnu@exemple.org");
  await page.getByLabel("Mot de passe").fill("mauvais-mot-de-passe");
  await page.getByRole("button", { name: "Se connecter" }).click();

  const alert = page.getByRole("alert");
  await expect(alert).toBeVisible();
  await expect(alert).toContainText(/incorrect|impossible/i);
});

test("mot de passe trop court refusé par le navigateur", async ({ page }) => {
  await gotoHydrated(page, "/signup");
  await page.getByLabel("Nom complet").fill("Test Court");
  await page.getByLabel("Adresse e-mail").fill(uniqueEmail());
  await page.getByLabel("Mot de passe").fill("court");
  await page.getByRole("button", { name: "Créer mon compte" }).click();

  // Toujours sur /signup : le formulaire HTML bloque l'envoi.
  await expect(page).toHaveURL(/\/signup$/);
});
