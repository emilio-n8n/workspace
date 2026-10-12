import { expect, test } from "@playwright/test";
import { openApp, signupNewUser, uniqueEmail } from "./helpers.ts";

/**
 * Vague S — preuves des surfaces transverses livrées avec les applications :
 * raccourcis du tableau de bord, agrégat « Mes tâches », commentaires des
 * Documents et cloche de notifications. Chaque cas crée son propre compte :
 * aucun état partagé entre les tests.
 */

const DOCS = "http://localhost:3002";
const TASKS = "http://localhost:3003";

test("raccourcis du tableau de bord : créer une feuille", async ({ page }) => {
  test.slow(); // multi-applications : accueil (3000) → Sheets (3006)

  const email = uniqueEmail("wfs-raccourci");
  await signupNewUser(page, "Raccourci E2E", email);

  // La carte de raccourci crée la feuille côté serveur puis ouvre Sheets.
  await page.getByRole("button", { name: "Nouvelle feuille de calcul" }).click();
  await expect(page).toHaveURL(/localhost:3006\/sheet\//, { timeout: 25_000 });
  await page.waitForSelector("html[data-hydrated='true']", { timeout: 40_000 });
  await expect(page.getByRole("button", { name: "Exporter CSV" })).toBeVisible({ timeout: 15_000 });
});

test("mes tâches : agrégat transverse", async ({ page }) => {
  const email = uniqueEmail("wfs-taches");
  await signupNewUser(page, "Mes Tâches E2E", email);

  await openApp(page, `${TASKS}/`);
  await expect(page.getByText("Aucune liste pour le moment")).toBeVisible();

  await page.getByRole("button", { name: "Nouvelle liste" }).first().click();
  await page.getByLabel("Nom de la liste").fill("Perso WFS");
  await page.getByRole("button", { name: "Créer la liste" }).click();
  await expect(page.getByRole("button", { name: "Perso WFS" })).toBeVisible();

  await page.getByLabel("Ajouter une tâche").fill("Priorité absolue");
  await page.keyboard.press("Enter");
  await expect(page.getByText("Priorité absolue").first()).toBeVisible({ timeout: 15_000 });

  // Sans échéance, la tâche n'apparaît que dans la fenêtre « Tout ».
  await page.getByRole("button", { name: "Mes tâches" }).click();
  await expect(page.getByRole("tab", { name: "Aujourd'hui" })).toBeVisible();
  await page.getByRole("tab", { name: "Tout" }).click();
  await expect(page.getByText("Priorité absolue").first()).toBeVisible({ timeout: 15_000 });
});

test("commentaires Docs", async ({ page }) => {
  test.slow(); // multi-applications : accueil (3000) → Docs (3002)

  const email = uniqueEmail("wfs-commentaires");
  await signupNewUser(page, "Commentaires E2E", email);

  // Création depuis la liste du module Documents.
  await openApp(page, `${DOCS}/`);
  await page.getByLabel("Titre").fill("Doc commenté E2E");
  await page.getByRole("button", { name: "Créer", exact: true }).click();
  await expect(page).toHaveURL(/localhost:3002\/doc\//, { timeout: 25_000 });

  // Panneau « Commentaires » : composition puis publication du premier fil.
  await page.getByRole("button", { name: "Commentaires" }).click();
  const composer = page.getByLabel("Nouveau commentaire");
  await expect(composer).toBeVisible({ timeout: 15_000 });
  await composer.fill("Premier retour");
  await page.getByRole("button", { name: "Commenter" }).click();
  await expect(page.getByText("Premier retour")).toBeVisible({ timeout: 15_000 });
});

test("notifications : la cloche existe sur le lanceur", async ({ page }) => {
  const email = uniqueEmail("wfs-notifications");
  await signupNewUser(page, "Notifications E2E", email);

  const cloche = page.getByRole("button", { name: /^Notifications/ });
  await expect(cloche).toBeVisible();
  await cloche.click();

  const panneau = page.getByRole("menu").getByText("Notifications", { exact: true });
  await expect(panneau).toBeVisible({ timeout: 10_000 });

  await page.keyboard.press("Escape");
  await expect(panneau).toBeHidden({ timeout: 10_000 });
});
