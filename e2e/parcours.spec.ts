import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import { expect, type Page, test } from "@playwright/test";
import { loadDotEnv } from "@workspace/config";
import { getDb, schema } from "@workspace/database";
import { eq } from "drizzle-orm";

/**
 * Critères de preuve du MVP — vérifiés dans un navigateur réel, sur la suite
 * multi-applications : accueil (3000), Drive (3001), Docs (3002), Tasks (3003).
 * Le SSO entre applications repose sur le cookie de session partagé (localhost).
 *
 * Les identités des scénarios « deux membres » sont amorcées directement en
 * base (l'invitation par e-mail dans l'interface arrive ensuite), mais TOUTES
 * les opérations testées passent par l'interface et les API réelles.
 */

loadDotEnv();
const db = getDb();

const PASSWORD = "mot-de-passe-123";
const HOME = "http://localhost:3000";
const DRIVE = "http://localhost:3001";
const DOCS = "http://localhost:3002";
const TASKS = "http://localhost:3003";

function uniqueEmail(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@exemple.org`;
}

async function gotoHydrated(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.waitForSelector("html[data-hydrated='true']", { timeout: 30_000 });
}

async function signupNewUser(page: Page, name: string, email: string): Promise<void> {
  await gotoHydrated(page, "/signup");
  await page.getByLabel("Nom complet").fill(name);
  await page.getByLabel("Adresse e-mail").fill(email);
  await page.getByLabel("Mot de passe").fill(PASSWORD);
  await page.getByRole("button", { name: "Créer mon compte" }).click();
  await expect(page).toHaveURL(/\/app/, { timeout: 25_000 });
  await expect(page.getByRole("heading", { name: /Bonjour/ })).toBeVisible();
}

async function login(page: Page, email: string): Promise<void> {
  await gotoHydrated(page, "/login");
  await page.getByLabel("Adresse e-mail").fill(email);
  await page.getByLabel("Mot de passe").fill(PASSWORD);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page).toHaveURL(/\/app/, { timeout: 25_000 });
}

async function logout(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Menu du compte" }).click();
  await page.getByRole("menuitem", { name: "Se déconnecter" }).click();
  await expect(page).toHaveURL(/localhost:3000\/$/, { timeout: 25_000 });
}

/** Ouvre une application de la suite (SSO attendu : aucune reconnexion). */
async function openApp(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await page.waitForSelector("html[data-hydrated='true']", { timeout: 40_000 });
}

/** Amorce l'appartenance d'un utilisateur à l'organisation personnelle d'un autre. */
async function seedMembership(memberEmail: string, ownerEmail: string): Promise<string> {
  const [owner] = await db
    .select({ id: schema.user.id })
    .from(schema.user)
    .where(eq(schema.user.email, ownerEmail))
    .limit(1);
  if (!owner) throw new Error(`Utilisateur introuvable : ${ownerEmail}`);

  const [org] = await db
    .select({ orgId: schema.member.organizationId })
    .from(schema.member)
    .where(eq(schema.member.userId, owner.id))
    .limit(1);
  if (!org) throw new Error(`Organisation introuvable pour : ${ownerEmail}`);

  const [member] = await db
    .select({ id: schema.user.id })
    .from(schema.user)
    .where(eq(schema.user.email, memberEmail))
    .limit(1);
  if (!member) throw new Error(`Utilisateur introuvable : ${memberEmail}`);

  await db.insert(schema.member).values({
    id: randomUUID(),
    organizationId: org.orgId,
    userId: member.id,
    role: "member",
    createdAt: new Date(),
  });

  // Nom unique pour pouvoir sélectionner l'organisation dans le menu du compte.
  await db
    .update(schema.organization)
    .set({ name: "Org d'Alice" })
    .where(eq(schema.organization.id, org.orgId));

  return org.orgId;
}

/** Bascule d'organisation via le menu du compte (parcours réel de l'utilisateur). */
async function switchOrgViaMenu(page: Page, orgName: string): Promise<void> {
  await page.getByRole("button", { name: "Menu du compte" }).click();
  await page.getByRole("menuitem", { name: new RegExp(orgName) }).click();
  await page.waitForSelector("html[data-hydrated='true']", { timeout: 40_000 });
  await page.waitForTimeout(1000);
}

test("accueil : identité, CTA et bascule de thème", async ({ page }) => {
  await gotoHydrated(page, "/");

  await expect(page.getByRole("heading", { level: 1 })).toContainText("La suite bureautique libre");
  await expect(page.getByRole("link", { name: "Ouvrir l'application" })).toBeVisible();
  await expect(page.getByText("AGPL-3.0-only").first()).toBeVisible();

  await page.getByRole("button", { name: /thème/i }).first().click();
  await expect(page.locator("html")).toHaveClass(/dark/);

  await page.screenshot({ path: "e2e/screenshots/accueil-sombre.png", fullPage: true });
});

test("/app redirige vers /login sans session", async ({ page }) => {
  await gotoHydrated(page, "/app");
  await expect(page).toHaveURL(/\/login$/);

  await page.screenshot({ path: "e2e/screenshots/login.png", fullPage: true });
});

test("inscription → lanceur → déconnexion → reconnexion", async ({ page }) => {
  const email = uniqueEmail("e2e");

  await signupNewUser(page, "Camille E2E", email);
  await expect(page.getByText("Applications").first()).toBeVisible();
  await page.getByRole("button", { name: "Menu du compte" }).click();
  await expect(page.getByText(email).first()).toBeVisible();
  await page.keyboard.press("Escape");

  await page.screenshot({ path: "e2e/screenshots/launcher.png", fullPage: true });

  await logout(page);
  await page.goto("/app");
  await expect(page).toHaveURL(/\/login$/);

  await login(page, email);
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
  await page.getByLabel("Adresse e-mail").fill(uniqueEmail("court"));
  await page.getByLabel("Mot de passe").fill("court");
  await page.getByRole("button", { name: "Créer mon compte" }).click();

  await expect(page).toHaveURL(/\/signup$/);
});

test("SSO multi-applications : Drive, Docs, Tasks sans reconnexion + palette ⌘K", async ({
  page,
}) => {
  const email = uniqueEmail("sso");
  await signupNewUser(page, "SSO E2E", email);

  // Drive (autre origine) : session reconnue, aucun retour au login.
  await openApp(page, `${DRIVE}/`);
  await expect(page.getByRole("button", { name: "Nouveau", exact: true })).toBeVisible();

  // Palette de commandes ⌘K.
  await page.keyboard.press("ControlOrMeta+k");
  await expect(page.getByPlaceholder("Rechercher une application ou une action…")).toBeVisible();
  await expect(page.getByText("Aller à Docs — Traitement de texte")).toBeVisible();
  await page.keyboard.press("Escape");

  // Docs et Tasks : mêmes cookies.
  await openApp(page, `${DOCS}/`);
  await expect(page.getByRole("heading", { name: "Documents", exact: true })).toBeVisible();
  await openApp(page, `${TASKS}/`);
  await expect(page.getByText("Aucune liste pour le moment")).toBeVisible();

  // Déconnexion puis : Drive exige maintenant une session → retour au login de l'accueil.
  await openApp(page, `${HOME}/app`);
  await logout(page);
  await page.goto(`${DRIVE}/`);
  await expect(page).toHaveURL(/localhost:3000\/login/, { timeout: 25_000 });
});

test("jetons d'API : création (affiché une seule fois), liste, révocation", async ({ page }) => {
  const email = uniqueEmail("jeton");
  await signupNewUser(page, "Jeton E2E", email);

  await gotoHydrated(page, "/app/settings/tokens");
  await expect(page.getByRole("heading", { name: /Agents & jetons/ })).toBeVisible();
  await expect(page.getByText("Aucun jeton pour le moment.")).toBeVisible();

  await page.getByLabel("Nom").fill("Jeton E2E");
  await page.getByLabel(/docs:read/).check();
  await page.getByRole("button", { name: "Créer le jeton" }).click();

  await expect(page.getByText("Votre nouveau jeton — affiché une seule fois")).toBeVisible();
  const shownToken = await page.locator("code", { hasText: "wsk_" }).first().innerText();
  expect(shownToken.startsWith("wsk_")).toBe(true);

  const row = page.getByRole("row", { name: /Jeton E2E/ });
  await expect(row).toBeVisible();
  await expect(row.getByText("Actif")).toBeVisible();

  await row.getByRole("button", { name: /Révoquer/ }).click();
  // La révocation passe par un dialogue de confirmation (action irréversible).
  await page.getByRole("dialog").getByRole("button", { name: "Révoquer", exact: true }).click();
  await expect(page.getByRole("row", { name: /Jeton E2E/ }).getByText("Révoqué")).toBeVisible();
});

test("drive : dossiers, téléversement, corbeille et document (app Docs)", async ({ page }) => {
  const email = uniqueEmail("drive");
  await signupNewUser(page, "Drive E2E", email);

  await openApp(page, `${DRIVE}/`);
  await expect(page.getByText("Ce dossier est vide")).toBeVisible();

  await page.getByRole("button", { name: "Nouveau dossier" }).first().click();
  await page.getByLabel("Nom du nouveau dossier").fill("Projets");
  await page.getByRole("button", { name: "Créer", exact: true }).click();
  await expect(page.getByRole("button", { name: "Projets", exact: true })).toBeVisible();

  await page.locator('input[type="file"]').setInputFiles({
    name: "notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("contenu e2e", "utf8"),
  });
  await expect(page.getByRole("button", { name: "notes.txt", exact: true })).toBeVisible();

  // Vues agrégées
  await page.getByRole("link", { name: "Récents" }).click();
  await expect(page.getByRole("button", { name: "notes.txt", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Partagés avec moi" }).click();
  await expect(page.getByText("Rien ne vous a été partagé pour le moment")).toBeVisible();
  await page.getByRole("link", { name: "Mon Drive" }).click();
  await expect(page.getByRole("button", { name: "notes.txt", exact: true })).toBeVisible();

  await page.screenshot({ path: "e2e/screenshots/drive.png", fullPage: true });

  // Corbeille puis restauration (menu ⋮)
  await page.getByRole("button", { name: /Actions pour « notes.txt »/ }).click();
  await page.getByRole("menuitem", { name: "Mettre à la corbeille" }).click();
  await expect(page.getByRole("button", { name: "notes.txt", exact: true })).toHaveCount(0);

  await page.getByRole("link", { name: "Corbeille" }).click();
  await expect(page.getByRole("button", { name: "notes.txt", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Restaurer" }).click();
  await expect(page.getByText("La corbeille est vide.")).toBeVisible();

  // Document : création depuis le Drive → atterrissage sur l'application Docs.
  await openApp(page, `${DRIVE}/`);
  await page.getByRole("button", { name: "Nouveau", exact: true }).click();
  await page.getByRole("menuitem", { name: "Nouveau document" }).click();
  await page.getByLabel("Titre du document").fill("Rapport E2E");
  await page.getByRole("button", { name: "Créer et ouvrir" }).click();

  await expect(page).toHaveURL(/localhost:3002\/doc\//, { timeout: 25_000 });
  await page.waitForSelector("html[data-hydrated='true']", { timeout: 30_000 });

  await page.locator(".workspace-editor").click();
  await page.keyboard.type("Bonjour le monde");
  await expect(page.getByRole("status")).toContainText("Enregistré", { timeout: 20_000 });
  await expect(page.getByRole("link", { name: "Exporter .md" })).toBeVisible();

  await page.screenshot({ path: "e2e/screenshots/docs.png", fullPage: true });
});

test("partage : deuxième membre, accès réel via l'interface, révocation", async ({ page }) => {
  test.slow();

  const ownerEmail = uniqueEmail("partage-a");
  const memberEmail = uniqueEmail("partage-b");

  // A crée un dossier dans le Drive.
  await signupNewUser(page, "Alice Partage", ownerEmail);
  await openApp(page, `${DRIVE}/`);
  await page.getByRole("button", { name: "Nouveau dossier" }).first().click();
  await page.getByLabel("Nom du nouveau dossier").fill("Commun");
  await page.getByRole("button", { name: "Créer", exact: true }).click();
  await expect(page.getByRole("button", { name: "Commun", exact: true })).toBeVisible();

  // B s'inscrit, puis son appartenance à l'organisation d'Alice est amorcée.
  await logout(page);
  await signupNewUser(page, "Bruno Partage", memberEmail);
  await seedMembership(memberEmail, ownerEmail);

  // B (dans SON organisation) ne voit rien.
  await openApp(page, `${DRIVE}/`);
  await expect(page.getByText("Ce dossier est vide")).toBeVisible();

  // A se reconnecte et partage « Commun » avec B.
  await logout(page);
  await login(page, ownerEmail);
  await openApp(page, `${DRIVE}/`);
  await page.getByRole("button", { name: /Actions pour « Commun »/ }).click();
  await page.getByRole("menuitem", { name: "Partager" }).click();
  await page.getByLabel("E-mail du membre").fill(memberEmail);
  await page.locator("dialog[open]").getByRole("button", { name: "Partager", exact: true }).click();
  await expect(page.getByText(`Bruno Partage (${memberEmail})`)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("dialog[open]")).toHaveCount(0);

  // B bascule sur l'organisation d'Alice : le dossier partagé apparaît.
  await logout(page);
  await login(page, memberEmail);
  await openApp(page, `${DRIVE}/`);
  await switchOrgViaMenu(page, "Org d'Alice");
  await expect(page.getByRole("button", { name: "Commun", exact: true })).toBeVisible();

  // A révoque le partage.
  await logout(page);
  await login(page, ownerEmail);
  await openApp(page, `${DRIVE}/`);
  await page.getByRole("button", { name: /Actions pour « Commun »/ }).click();
  await page.getByRole("menuitem", { name: "Partager" }).click();
  await page.getByRole("button", { name: /Retirer l'accès de Bruno/ }).click();
  await expect(page.getByText("Personne d'autre n'a accès pour le moment.")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("dialog[open]")).toHaveCount(0);

  // B ne voit plus rien : la révocation est effective.
  await logout(page);
  await login(page, memberEmail);
  await openApp(page, `${DRIVE}/`);
  await switchOrgViaMenu(page, "Org d'Alice");
  await expect(page.getByText("Ce dossier est vide")).toBeVisible();
});

test("tâches : liste, ajout rapide, terminer, filtres et édition", async ({ page }) => {
  const email = uniqueEmail("taches");
  await signupNewUser(page, "Tâches E2E", email);

  await openApp(page, `${TASKS}/`);
  await expect(page.getByText("Aucune liste pour le moment")).toBeVisible();

  await page.getByRole("button", { name: "Nouvelle liste" }).first().click();
  await page.getByLabel("Nom de la liste").fill("Projet E2E");
  await page.getByRole("button", { name: "Créer la liste" }).click();
  await expect(page.getByRole("button", { name: "Projet E2E", exact: true })).toBeVisible();

  await page.getByLabel("Ajouter une tâche").fill("Relire la roadmap");
  await page.keyboard.press("Enter");
  await expect(page.getByText("Relire la roadmap", { exact: true })).toBeVisible();

  await page.getByRole("checkbox", { name: /Marquer « Relire la roadmap »/ }).check();
  await page.getByRole("button", { name: "Terminées" }).click();
  await expect(page.getByText("Relire la roadmap", { exact: true })).toBeVisible();

  await page.getByText("Relire la roadmap").click();
  await page.getByLabel("Priorité", { exact: true }).selectOption("high");
  await page.getByRole("button", { name: "Enregistrer" }).click();

  await page.getByRole("button", { name: "Toutes" }).click();
  await expect(page.getByLabel("Priorité Haute").first()).toBeVisible();

  await page.screenshot({ path: "e2e/screenshots/tasks.png", fullPage: true });
});
