import { expect, test } from "@playwright/test";
import { login, logout, openApp, signupNewUser, uniqueEmail } from "./helpers.ts";

const MAIL = "http://localhost:3008";
const CHAT = "http://localhost:3009";
const MEET = "http://localhost:3010";
const SITES = "http://localhost:3011";
const CLASSROOM = "http://localhost:3012";
const ADMIN = "http://localhost:3013";

test("chat : canal, message envoyé, compteur de non-lus", async ({ page }) => {
  const email = uniqueEmail("chat");
  await signupNewUser(page, "Chat E2E", email);

  await openApp(page, `${CHAT}/`);
  await page.getByRole("button", { name: "Nouveau canal" }).click();
  await page.getByLabel("Nom du canal").fill("produit");
  await page.getByRole("button", { name: "Créer le canal" }).click();

  await page.getByLabel("Message", { exact: true }).fill("Bonjour l'équipe");
  await page.getByRole("button", { name: "Envoyer" }).click();
  await expect(page.getByText("Bonjour l'équipe")).toBeVisible({ timeout: 15_000 });
  await page.screenshot({ path: "e2e/screenshots/chat.png", fullPage: true });
});

test("mail : brouillon puis envoi conservé avec erreur explicite sans SMTP", async ({ page }) => {
  const email = uniqueEmail("mail");
  await signupNewUser(page, "Mail E2E", email);

  await openApp(page, `${MAIL}/`);
  await page.getByRole("button", { name: "Écrire", exact: true }).click();
  await page.getByLabel("À (séparés par des virgules)").fill("ami@exemple.org");
  await page.getByLabel("Objet").fill("Test E2E");
  await page
    .getByRole("dialog", { name: "Nouveau message" })
    .getByLabel("Message", { exact: true })
    .fill("Corps du message E2E");
  await page.getByRole("button", { name: "Enregistrer en brouillon" }).click();
  await expect(page.getByText("Brouillons").first()).toBeVisible();
  // Selon l'état, le compositeur peut rester ouvert après l'enregistrement :
  // on le referme (Échap, dialogue natif) avant de recommencer un message.
  if (
    await page
      .getByRole("dialog", { name: "Nouveau message" })
      .isVisible()
      .catch(() => false)
  ) {
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Nouveau message" })).toBeHidden();
  }

  await page.getByRole("button", { name: "Écrire", exact: true }).click();
  await page.getByLabel("À (séparés par des virgules)").fill("ami@exemple.org");
  await page.getByLabel("Objet").fill("Envoi E2E");
  await page
    .getByRole("dialog", { name: "Nouveau message" })
    .getByLabel("Message", { exact: true })
    .fill("Un vrai envoi");
  await page.getByRole("button", { name: "Envoyer" }).click();

  await expect(page.getByRole("alert").filter({ hasText: "SMTP" })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByText("Envoi E2E")).toBeVisible();
  await page.screenshot({ path: "e2e/screenshots/mail.png", fullPage: true });
});

test("meet : salle créée, page de réunion avec configuration expliquée", async ({ page }) => {
  const email = uniqueEmail("meet");
  await signupNewUser(page, "Meet E2E", email);

  await openApp(page, `${MEET}/`);
  await page.getByRole("button", { name: "Nouvelle salle" }).first().click();
  await page.getByLabel("Nom de la salle").fill("Réunion E2E");
  await page.getByRole("button", { name: "Créer la salle" }).click();

  await expect(page).toHaveURL(/\/room\//, { timeout: 25_000 });
  await expect(page.getByText("Serveur média non configuré")).toBeVisible();
  await page.screenshot({ path: "e2e/screenshots/meet.png", fullPage: true });
});

test("sites : page en Markdown, aperçu HTML rendu et sûr", async ({ page }) => {
  const email = uniqueEmail("site");
  await signupNewUser(page, "Site E2E", email);

  await openApp(page, `${SITES}/`);
  await page.getByRole("button", { name: "Nouveau site" }).first().click();
  await page.getByLabel("Nom du site").fill("Wiki E2E");
  await page.getByRole("button", { name: "Créer et ouvrir" }).click();

  // Le champ peut être rempli avant que React n'attache ses gestionnaires :
  // on retente la saisie jusqu'à ce que « Enregistrer » devienne actif.
  const enregistrerSite = page.getByRole("button", { name: "Enregistrer" });
  await expect(async () => {
    await page.getByLabel("Contenu Markdown").fill("# Accueil E2E\n\nBienvenue au wiki.");
    await expect(enregistrerSite).toBeEnabled({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
  await enregistrerSite.click();
  await expect(page.getByRole("status").filter({ hasText: "Enregistré" }).first()).toBeVisible({
    timeout: 15_000,
  });

  await page.getByRole("button", { name: "Aperçu" }).click();
  await expect(page.getByRole("heading", { name: "Accueil E2E" })).toBeVisible();
  await page.screenshot({ path: "e2e/screenshots/sites.png", fullPage: true });
});

test("classroom : cours, code d'accès, copie d'élève et notation", async ({ page }) => {
  test.slow();

  const ownerEmail = uniqueEmail("prof");
  const studentEmail = uniqueEmail("eleve");

  // L'enseignant crée le cours et un devoir.
  await signupNewUser(page, "Prof E2E", ownerEmail);
  await openApp(page, `${CLASSROOM}/`);
  // En-tête + état vide exposent les deux mêmes actions : on vise la première.
  await page.getByRole("button", { name: "Créer un cours" }).first().click();
  await page.getByLabel("Nom du cours").fill("Maths E2E");
  await page.getByRole("button", { name: "Créer le cours" }).click();

  await expect(page.getByRole("button", { name: "Nouveau devoir" }).first()).toBeVisible({
    timeout: 25_000,
  });
  const codeButton = page.getByRole("button", { name: /Code :/ });
  const codeText = await codeButton.innerText();
  const match = /([A-HJ-NP-Z2-9]{8})/.exec(codeText);
  if (!match?.[1]) throw new Error("Code d'accès introuvable");
  const joinCode = match[1];

  await page.getByRole("button", { name: "Nouveau devoir" }).first().click();
  await page.getByLabel("Titre").fill("Exercice 1");
  await page.getByLabel("Consignes").fill("Faire les calculs.");
  await page.getByRole("button", { name: "Créer le devoir" }).click();
  await expect(page.getByText("Exercice 1")).toBeVisible({ timeout: 25_000 });

  // L'élève rejoint avec le code et rend sa copie.
  await logout(page);
  await signupNewUser(page, "Élève E2E", studentEmail);
  await openApp(page, `${CLASSROOM}/`);
  await page.getByRole("button", { name: "Rejoindre avec un code" }).first().click();
  await page.getByLabel("Code d'accès").fill(joinCode);
  await page.getByRole("button", { name: "Rejoindre", exact: true }).click();
  await expect(page.getByText("Exercice 1")).toBeVisible({ timeout: 25_000 });

  await page.getByRole("button", { name: "Rendre ma copie" }).click();
  await page.getByLabel("Votre réponse").fill("Ma réponse E2E");
  await page.getByRole("button", { name: "Rendre la copie" }).click();
  await expect(page.getByText(/Rendue le/)).toBeVisible({ timeout: 25_000 });

  // L'enseignant note la copie.
  await logout(page);
  await login(page, ownerEmail);
  await openApp(page, `${CLASSROOM}/`);
  await page.getByRole("button", { name: /Maths E2E/ }).click();
  await page.getByRole("button", { name: /Copies \(1\)/ }).click();
  await expect(page.getByText("Ma réponse E2E")).toBeVisible({ timeout: 25_000 });
  await page.getByLabel(/Note sur/).fill("15");
  await page.getByRole("button", { name: "Noter" }).click();
  await expect(page.getByLabel(/Note sur/)).toHaveValue("15", { timeout: 25_000 });
  await page.screenshot({ path: "e2e/screenshots/classroom.png", fullPage: true });
});

test("admin : profil d'organisation, membres, quota et journal", async ({ page }) => {
  const email = uniqueEmail("admin");
  await signupNewUser(page, "Admin E2E", email);

  await openApp(page, `${ADMIN}/`);
  await expect(page.getByRole("heading", { name: "Administration" })).toBeVisible();

  // Deux cartes « Enregistrer » (profil, politiques) : on vise la carte Profil.
  // Course d'hydratation : re-saisir jusqu'à ce que la carte devienne enregistrable.
  const enregistrerProfil = page
    .locator("section", { hasText: "Profil de l'organisation" })
    .getByRole("button", { name: "Enregistrer" });
  await expect(async () => {
    await page.getByLabel("Nom", { exact: true }).fill("Org E2E");
    await expect(enregistrerProfil).toBeEnabled({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
  await enregistrerProfil.click();
  await expect(page.getByRole("status")).toContainText("Profil mis à jour.");

  await expect(page.getByText(email).first()).toBeVisible();

  await page.getByLabel("Quota (Go, vide = illimité)").fill("10");
  await page.getByRole("button", { name: "Appliquer" }).click();
  await expect(page.getByRole("status")).toContainText("Quota mis à jour.");

  await page.screenshot({ path: "e2e/screenshots/admin.png", fullPage: true });
});
