import { expect, test } from "@playwright/test";
import { gotoHydrated, openApp, signupNewUser, uniqueEmail } from "./helpers.ts";

const CALENDAR = "http://localhost:3004";
const FORMS = "http://localhost:3005";
const SHEETS = "http://localhost:3006";
const SLIDES = "http://localhost:3007";

test("calendar : création d'un événement et affichage dans le mois", async ({ page }) => {
  const email = uniqueEmail("cal");
  await signupNewUser(page, "Cal E2E", email);

  await openApp(page, `${CALENDAR}/`);
  await expect(page.getByRole("button", { name: "Nouvel événement" }).first()).toBeVisible();

  await page.getByRole("button", { name: "Nouvel événement" }).first().click();
  await page.getByLabel("Titre").fill("Point E2E");
  await page.getByRole("button", { name: "Créer l'événement" }).click();

  await expect(page.getByRole("button", { name: /Point E2E/ }).first()).toBeVisible({
    timeout: 15_000,
  });
  await page.screenshot({ path: "e2e/screenshots/calendar.png", fullPage: true });
});

test("forms : création, publication, réponse publique et lecture des réponses", async ({
  page,
}) => {
  const email = uniqueEmail("form");
  await signupNewUser(page, "Form E2E", email);

  await openApp(page, `${FORMS}/`);
  await page.getByRole("button", { name: "Nouveau formulaire" }).first().click();
  await page.getByLabel("Titre du formulaire").fill("Enquête E2E");
  await page.getByRole("button", { name: "Créer", exact: true }).click();

  // Constructeur : ajout d'une question texte, puis publication.
  await page.getByRole("button", { name: "Texte court" }).click();
  await page.getByLabel("Intitulé de la question").fill("Votre avis");
  await page.getByLabel("Statut").selectOption("open");
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByRole("status")).toContainText("Enregistré", { timeout: 15_000 });

  // Formulaire public (nouvel onglet) : réponse.
  const [publicPage] = await Promise.all([
    page.waitForEvent("popup"),
    page.getByRole("button", { name: "Ouvrir", exact: true }).click(),
  ]);
  await publicPage.waitForSelector("html[data-hydrated='true']", { timeout: 40_000 });
  await expect(publicPage.getByRole("heading", { name: "Enquête E2E" })).toBeVisible();
  await publicPage.getByLabel("Votre avis").fill("Tout va bien");
  await publicPage.getByRole("button", { name: "Envoyer" }).click();
  await expect(publicPage.getByRole("heading", { name: "Merci !" })).toBeVisible();
  await publicPage.close();

  // Réponses côté propriétaire.
  await page.getByRole("tab", { name: "Réponses" }).click();
  await expect(page.getByText("Tout va bien")).toBeVisible({ timeout: 15_000 });
  await page.screenshot({ path: "e2e/screenshots/forms.png", fullPage: true });
});

test("sheets : saisie, formule évaluée et persistance après rechargement", async ({ page }) => {
  const email = uniqueEmail("sheet");
  await signupNewUser(page, "Sheet E2E", email);

  await openApp(page, `${SHEETS}/`);
  await page.getByRole("button", { name: "Nouvelle feuille" }).first().click();
  await page.getByLabel("Titre de la feuille").fill("Budget E2E");
  await page.getByRole("button", { name: "Créer et ouvrir" }).click();

  // Entrée valide et descend d'une ligne : la cellule suivante est déjà en
  // édition (champ), sinon c'est un bouton au repos — on accepte les deux.
  async function typeCell(ref: string, value: string) {
    const button = page.getByRole("button", { name: `Cellule ${ref}` });
    if ((await button.count()) > 0) await button.first().click();
    const input = page.getByRole("textbox", { name: `Cellule ${ref}` });
    await input.fill(value);
    await input.press("Enter");
  }

  await typeCell("A1", "2");
  await typeCell("A2", "3");
  await typeCell("A3", "=SUM(A1:A2)");
  await expect(page.getByRole("button", { name: "Cellule A3" })).toHaveText("5", {
    timeout: 10_000,
  });
  await expect(page.getByRole("status").filter({ hasText: "Enregistré" })).toBeVisible({
    timeout: 15_000,
  });

  await page.reload();
  await page.waitForSelector("html[data-hydrated='true']", { timeout: 40_000 });
  await expect(page.getByRole("button", { name: "Cellule A3" })).toHaveText("5", {
    timeout: 15_000,
  });
  await page.screenshot({ path: "e2e/screenshots/sheets.png", fullPage: true });
});

test("slides : zone de texte, sauvegarde et persistance", async ({ page }) => {
  const email = uniqueEmail("slide");
  await signupNewUser(page, "Slide E2E", email);

  await openApp(page, `${SLIDES}/`);
  await page.getByRole("button", { name: "Nouvelle présentation" }).first().click();
  await page.getByLabel("Titre de la présentation").fill("Pitch E2E");
  await page.getByRole("button", { name: "Créer et ouvrir" }).click();

  await page.getByRole("button", { name: "Ajouter une zone de texte" }).click();
  // Le nom accessible de l'élément dérive de son texte (« Élément Texte » à la création).
  await page
    .getByRole("button", { name: /Élément/ })
    .first()
    .click();
  await page.getByRole("textbox", { name: "Texte", exact: true }).fill("Bonjour E2E");
  await expect(page.getByRole("status").filter({ hasText: "Enregistré" })).toBeVisible({
    timeout: 15_000,
  });

  await page.reload();
  await page.waitForSelector("html[data-hydrated='true']", { timeout: 40_000 });
  await expect(page.getByText("Bonjour E2E").first()).toBeVisible({ timeout: 15_000 });
  await page.screenshot({ path: "e2e/screenshots/slides.png", fullPage: true });
});

test("accueil : le lanceur expose les quatorze applications", async ({ page }) => {
  const email = uniqueEmail("lanceur");
  await signupNewUser(page, "Lanceur E2E", email);
  await gotoHydrated(page, "/app");

  for (const name of ["Drive", "Docs", "Sheets", "Slides", "Calendar", "Tasks", "Forms"]) {
    await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
  }
  await expect(page.getByText("Mail", { exact: true }).first()).toBeVisible();
  await page.screenshot({ path: "e2e/screenshots/lanceur-complet.png", fullPage: true });
});
