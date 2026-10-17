import { expect, type Page } from "@playwright/test";

/** Helpers partagés par les specs de la suite (inscription, SSO, session). */

export const PASSWORD = "mot-de-passe-123";

export function uniqueEmail(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@exemple.org`;
}

export async function gotoHydrated(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.waitForSelector("html[data-hydrated='true']", { timeout: 30_000 });
}

/** Type d'espace choisi à l'inscription (Sites/Admin : entreprise, Classroom : éducation). */
export type SignupKind = "Personnel" | "Entreprise" | "Éducation";

export async function signupNewUser(
  page: Page,
  name: string,
  email: string,
  kind: SignupKind = "Personnel",
): Promise<void> {
  await gotoHydrated(page, "/signup");
  if (kind !== "Personnel") await page.getByText(kind, { exact: true }).click();
  await page.getByLabel("Nom complet").fill(name);
  await page.getByLabel("Adresse e-mail").fill(email);
  await page.getByLabel("Mot de passe").fill(PASSWORD);
  await page.getByRole("button", { name: "Créer mon compte" }).click();
  await expect(page).toHaveURL(/\/app/, { timeout: 25_000 });
  await expect(page.getByRole("heading", { name: /Bonjour/ })).toBeVisible();
}

export async function login(page: Page, email: string): Promise<void> {
  await gotoHydrated(page, "/login");
  await page.getByLabel("Adresse e-mail").fill(email);
  await page.getByLabel("Mot de passe").fill(PASSWORD);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page).toHaveURL(/\/app/, { timeout: 25_000 });
}

export async function logout(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Menu du compte" }).click();
  await page.getByRole("menuitem", { name: "Se déconnecter" }).click();
  await expect(page).toHaveURL(/localhost:3000\/$/, { timeout: 25_000 });
}

/** Ouvre une application de la suite (SSO attendu : aucune reconnexion). */
export async function openApp(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await page.waitForSelector("html[data-hydrated='true']", { timeout: 40_000 });
}
