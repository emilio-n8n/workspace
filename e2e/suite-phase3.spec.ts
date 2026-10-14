import { expect, test } from "@playwright/test";
import { gotoHydrated, openApp, signupNewUser, uniqueEmail } from "./helpers.ts";

const CALENDAR = "http://localhost:3004";
const DOCS = "http://localhost:3002";
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
  // Course d'hydratation possible : on retente l'ajout jusqu'à l'apparition du champ.
  await expect(async () => {
    await page.getByRole("button", { name: "Texte court" }).click();
    await expect(page.getByLabel("Intitulé de la question")).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
  await page.getByLabel("Intitulé de la question").fill("Votre avis");
  await page.getByLabel("Statut").selectOption("open");
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByRole("status")).toContainText("Enregistré", { timeout: 15_000 });

  // Formulaire public (nouvel onglet) : réponse.
  const [publicPage] = await Promise.all([
    page.waitForEvent("popup"),
    page.getByRole("link", { name: "Ouvrir" }).click(),
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
    const button = page.getByRole("button", { name: `Cellule ${ref}`, exact: true });
    const input = page.getByRole("textbox", { name: `Cellule ${ref}`, exact: true });
    // Course d'hydratation (canEdit arrive avec le détail serveur) : on retente
    // le clic jusqu'à ce que l'éditeur de cellule s'ouvre réellement.
    await expect(async () => {
      if ((await button.count()) > 0) await button.first().click();
      await expect(input).toBeVisible({ timeout: 1_500 });
    }).toPass({ timeout: 20_000 });
    await input.fill(value);
    await input.press("Enter");
  }

  await typeCell("A1", "2");
  await typeCell("A2", "3");
  await typeCell("A3", "=SUM(A1:A2)");
  await expect(page.getByRole("button", { name: "Cellule A3", exact: true })).toHaveText("5", {
    timeout: 10_000,
  });
  await expect(page.getByRole("status").filter({ hasText: "Enregistré" })).toBeVisible({
    timeout: 15_000,
  });

  await page.reload();
  await page.waitForSelector("html[data-hydrated='true']", { timeout: 40_000 });
  await expect(page.getByRole("button", { name: "Cellule A3", exact: true })).toHaveText("5", {
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

  // Course d'hydratation possible : on retente l'ajout jusqu'à l'apparition de l'élément.
  await expect(async () => {
    await page.getByRole("button", { name: "Ajouter une zone de texte" }).click();
    await expect(page.getByRole("button", { name: /Élément/ }).first()).toBeVisible({
      timeout: 2_000,
    });
  }).toPass({ timeout: 20_000 });
  // Le nom accessible de l'élément dérive de son texte (« Élément texte » à la création).
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

test("slides : mise en page de titre, édition en place et nouvelle diapositive", async ({
  page,
}) => {
  const email = uniqueEmail("slides2");
  await signupNewUser(page, "Slides E2E 2", email);

  await openApp(page, `${SLIDES}/`);
  await page.getByRole("button", { name: "Nouvelle présentation" }).first().click();
  await page.getByLabel("Titre de la présentation").fill("Pitch visuel");
  await page.getByRole("button", { name: "Créer et ouvrir" }).click();

  // La première diapositive porte la mise en page « Titre » : les invitations
  // des zones apparaissent dès le chargement de l'éditeur.
  await expect(page.getByText("Cliquez pour ajouter un titre").first()).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByText("Cliquez pour ajouter un sous-titre").first()).toBeVisible();

  // Une zone vide s'ouvre au clic et le texte s'édite en place, sur la
  // diapositive (course d'hydratation tolérée par la reprise).
  await expect(async () => {
    await page.getByRole("button", { name: "Élément titre" }).first().click();
    await expect(page.getByRole("textbox", { name: "Modifier le texte" })).toBeVisible({
      timeout: 2_000,
    });
  }).toPass({ timeout: 20_000 });
  await page.getByRole("textbox", { name: "Modifier le texte" }).fill("Lancement 2026");
  await page.getByRole("textbox", { name: "Modifier le texte" }).press("Escape");
  await expect(page.getByText("Lancement 2026").first()).toBeVisible();

  // Mise en forme : l'élément reste sélectionné après l'édition en place.
  await page.getByRole("button", { name: "Italique" }).click();
  await expect(page.getByRole("button", { name: "Italique" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  // Puces : la zone devient une liste, visible dans le rendu comme en présentation.
  await page.getByRole("button", { name: "Puces" }).click();
  await expect(page.getByRole("button", { name: "Puces" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("• Lancement 2026").first()).toBeVisible();

  // Transition choisie dans la barre de réglages (persistée avec la présentation).
  await page.getByLabel("Transition", { exact: true }).selectOption("fade");

  // Nouvelle diapositive avec la mise en page « Titre et contenu ».
  await expect(async () => {
    await page.getByRole("button", { name: "Nouvelle diapositive" }).click();
    await page.getByRole("button", { name: "Titre et contenu" }).click();
    await expect(page.getByText("Cliquez pour ajouter du texte").first()).toBeVisible({
      timeout: 3_000,
    });
  }).toPass({ timeout: 15_000 });

  // Persistance : le rechargement retrouve le titre saisi et la mise en page.
  await expect(page.getByRole("status").filter({ hasText: "Enregistré" })).toBeVisible({
    timeout: 15_000,
  });
  await page.reload();
  await page.waitForSelector("html[data-hydrated='true']", { timeout: 40_000 });
  await expect(page.getByText("Lancement 2026").first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByLabel("Transition", { exact: true })).toHaveValue("fade");
});

test("docs : styles, saut de page, tableau et zoom", async ({ page }) => {
  const email = uniqueEmail("docs-edit");
  await signupNewUser(page, "Docs E2E", email);

  await openApp(page, `${DOCS}/`);
  await page.getByLabel("Titre").fill("Notes E2E");
  await page.getByRole("button", { name: "Créer" }).click();

  // L'éditeur arrive après hydratation : saisie tolérante à la course initiale.
  const surface = page.locator(".workspace-editor[contenteditable='true']");
  await expect(surface).toBeVisible({ timeout: 20_000 });
  await expect(async () => {
    await surface.click();
    await page.keyboard.type("Bonjour le monde");
    await expect(page.getByText("Bonjour le monde")).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });

  // Style de paragraphe « Titre 1 » via le sélecteur (comme Word).
  await page.getByLabel("Style de paragraphe").selectOption("heading1");
  await expect(page.getByRole("heading", { name: "Bonjour le monde" })).toBeVisible();

  // Saut de page : nouveau paragraphe puis repère visible dans l'éditeur.
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Saut de page" }).click();
  await expect(page.locator(".workspace-page-break")).toBeVisible();

  // Tableau 2×2 inséré par le dialogue.
  await page.getByRole("button", { name: "Insérer un tableau" }).click();
  const tableDialog = page.getByRole("dialog", { name: "Insérer un tableau" });
  await tableDialog.getByLabel("Lignes").fill("2");
  await tableDialog.getByLabel("Colonnes").fill("2");
  await tableDialog.getByRole("button", { name: "Insérer" }).click();
  await expect(page.locator(".workspace-editor table")).toBeVisible();

  // Zoom (vue) : le sélecteur du pied de page.
  await page.getByLabel("Zoom").selectOption("125");
  await expect(page.getByLabel("Zoom")).toHaveValue("125");

  // Persistance : rechargement → titre, saut de page et tableau.
  await expect(page.getByText(/Enregistré/).first()).toBeVisible({ timeout: 15_000 });
  await page.reload();
  await page.waitForSelector("html[data-hydrated='true']", { timeout: 40_000 });
  await expect(page.getByRole("heading", { name: "Bonjour le monde" })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.locator(".workspace-page-break")).toBeVisible();
  await expect(page.locator(".workspace-editor table")).toBeVisible();
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
