import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import { expect, type Page, test } from "@playwright/test";
import { loadDotEnv } from "@workspace/config";
import { getDb, schema } from "@workspace/database";
import { eq } from "drizzle-orm";

/**
 * Parcours réellement vérifiés dans un navigateur — critères de preuve du MVP :
 * inscription, espace personnel, Drive (dossiers, upload, corbeille, purge),
 * Docs (création, édition, autosave, export), partage entre deux membres avec
 * révocation, jetons d'API.
 *
 * Les identités utilisées par les scénarios « deux membres » sont amorcées
 * directement en base (l'invitation par e-mail dans l'interface arrive ensuite),
 * mais TOUTES les opérations testées (partage, accès, révocation) passent par
 * l'interface et les API réelles de l'application.
 */

loadDotEnv();
const db = getDb();

const PASSWORD = "mot-de-passe-123";

function uniqueEmail(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@exemple.org`;
}

/** Navigue puis attend l'hydratation complète (aucune interaction avant). */
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
  await page.getByRole("button", { name: "Se déconnecter" }).click();
  await expect(page).toHaveURL(/\/$/, { timeout: 25_000 });
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

  return org.orgId;
}

/** Bascule l'organisation active d'une session via l'API better-auth (réelle). */
async function switchActiveOrg(page: Page, organizationId: string): Promise<void> {
  await page.evaluate(async (orgId) => {
    await fetch("/api/auth/organization/set-active", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ organizationId: orgId }),
    });
  }, organizationId);
  await page.reload();
  await page.waitForSelector("html[data-hydrated='true']", { timeout: 30_000 });
}

test("page d'accueil : identité, CTA et bascule de thème", async ({ page }) => {
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

test("inscription → espace personnel → déconnexion → reconnexion", async ({ page }) => {
  const email = uniqueEmail("e2e");

  await signupNewUser(page, "Camille E2E", email);
  await expect(page.getByText("Espace personnel").first()).toBeVisible();
  await expect(page.getByText(email).first()).toBeVisible();

  await page.screenshot({ path: "e2e/screenshots/app.png", fullPage: true });

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

test("jetons d'API : création (affiché une seule fois), liste, révocation", async ({ page }) => {
  const email = uniqueEmail("jeton");
  await signupNewUser(page, "Jeton E2E", email);

  await page.getByRole("link", { name: "Agents & jetons" }).click();
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
  await expect(row.getByText("docs:read")).toBeVisible();

  await row.getByRole("button", { name: /Révoquer/ }).click();
  await expect(page.getByRole("row", { name: /Jeton E2E/ }).getByText("Révoqué")).toBeVisible();
});

test("drive : dossiers, téléversement, corbeille et document avec autosave", async ({ page }) => {
  const email = uniqueEmail("drive");
  await signupNewUser(page, "Drive E2E", email);

  await page.getByRole("link", { name: "Drive" }).click();
  await expect(page.getByText("Ce dossier est vide")).toBeVisible();

  // Dossier
  await page.getByRole("button", { name: "Nouveau dossier" }).first().click();
  await page.getByLabel("Nom du dossier").fill("Projets");
  await page.getByRole("button", { name: "Créer le dossier" }).click();
  await expect(page.getByRole("button", { name: "Projets", exact: true })).toBeVisible();

  // Téléversement (input fichier caché)
  await page.locator('input[type="file"]').setInputFiles({
    name: "notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("contenu e2e", "utf8"),
  });
  await expect(page.getByRole("button", { name: "notes.txt", exact: true })).toBeVisible();

  await page.screenshot({ path: "e2e/screenshots/drive.png", fullPage: true });

  // Navigation dans le dossier puis retour par le fil d'Ariane
  await page.getByRole("button", { name: "Projets", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/drive\/.+/);
  await page.getByRole("link", { name: "Drive", exact: true }).first().click();
  await expect(page).toHaveURL(/\/app\/drive$/);

  // Corbeille puis restauration
  await page.getByRole("button", { name: "Mettre « notes.txt » à la corbeille" }).click();
  await expect(page.getByRole("button", { name: "notes.txt", exact: true })).toHaveCount(0);

  await page.getByRole("link", { name: "Corbeille" }).click();
  await expect(page.getByText("notes.txt")).toBeVisible();
  await page.getByRole("button", { name: "Restaurer" }).click();
  await expect(page.getByText("La corbeille est vide.")).toBeVisible();

  // Document : création depuis le Drive puis édition avec autosave
  await page.getByRole("link", { name: "Drive", exact: true }).first().click();
  await page.getByRole("button", { name: "Nouveau document" }).click();
  await page.getByLabel("Titre du document").fill("Rapport E2E");
  await page.getByRole("button", { name: "Créer et ouvrir" }).click();

  await expect(page).toHaveURL(/\/app\/docs\/.+/);
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

  // A crée un dossier.
  await signupNewUser(page, "Alice Partage", ownerEmail);
  await page.getByRole("link", { name: "Drive" }).click();
  await page.getByRole("button", { name: "Nouveau dossier" }).first().click();
  await page.getByLabel("Nom du dossier").fill("Commun");
  await page.getByRole("button", { name: "Créer le dossier" }).click();
  await expect(page.getByRole("button", { name: "Commun", exact: true })).toBeVisible();

  // B s'inscrit, puis son appartenance à l'organisation d'Alice est amorcée.
  await logout(page);
  await signupNewUser(page, "Bruno Partage", memberEmail);
  const orgId = await seedMembership(memberEmail, ownerEmail);

  // B (dans SON organisation) ne voit rien.
  await page.getByRole("link", { name: "Drive" }).click();
  await expect(page.getByText("Ce dossier est vide")).toBeVisible();

  // A se reconnecte et partage « Commun » avec B.
  await logout(page);
  await login(page, ownerEmail);
  await page.getByRole("link", { name: "Drive" }).click();
  await page.getByRole("button", { name: "Partager" }).first().click();
  await page.getByLabel("E-mail du membre").fill(memberEmail);
  await page.locator("dialog[open]").getByRole("button", { name: "Partager", exact: true }).click();
  await expect(page.getByText(`Bruno Partage (${memberEmail})`)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("dialog[open]")).toHaveCount(0);

  // B bascule sur l'organisation d'Alice : le dossier partagé apparaît.
  await logout(page);
  await login(page, memberEmail);
  await switchActiveOrg(page, orgId);
  await page.getByRole("link", { name: "Drive" }).click();
  await expect(page.getByRole("button", { name: "Commun", exact: true })).toBeVisible();

  // A révoque le partage.
  await logout(page);
  await login(page, ownerEmail);
  await page.getByRole("link", { name: "Drive" }).click();
  await page.getByRole("button", { name: "Partager" }).first().click();
  await page.getByRole("button", { name: /Retirer l'accès de Bruno/ }).click();
  await expect(page.getByText("Personne d'autre n'a accès pour le moment.")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("dialog[open]")).toHaveCount(0);

  // B ne voit plus rien : la révocation est effective.
  await logout(page);
  await login(page, memberEmail);
  await switchActiveOrg(page, orgId);
  await page.getByRole("link", { name: "Drive" }).click();
  await expect(page.getByText("Ce dossier est vide")).toBeVisible();
});
