import { expect, type Page, test } from "@playwright/test";
import { openApp, signupNewUser, uniqueEmail } from "./helpers.ts";

/**
 * Vague v3 « parité Word / Excel / PowerPoint web » : menus, mise en page,
 * rechercher-remplacer (Docs) ; modèle de sélection Excel, poignée de recopie,
 * fonctions et autocomplétion (Sheets) ; menu contextuel, trieuse et remplissage
 * des formes (Slides).
 */
const DOCS = "http://localhost:3002";
const SHEETS = "http://localhost:3006";
const SLIDES = "http://localhost:3007";

async function newDocument(page: Page, title: string) {
  await openApp(page, `${DOCS}/`);
  await page.getByLabel("Titre").fill(title);
  await page.getByRole("button", { name: "Créer", exact: true }).click();
  const surface = page.locator(".workspace-editor[contenteditable='true']");
  await expect(surface).toBeVisible({ timeout: 20_000 });
  return surface;
}

test("docs v3 : menus, mise en page paysage, police, rechercher-remplacer, liste de tâches", async ({
  page,
}) => {
  await signupNewUser(page, "Docs v3", uniqueEmail("docs-v3"));
  const surface = await newDocument(page, "Rapport v3");

  await expect(async () => {
    await surface.click();
    await page.keyboard.type("chat chat chien");
    await expect(page.getByText("chat chat chien")).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });

  // Vue page : la feuille A4 portrait est affichée par défaut.
  const sheet = page.locator("[data-page-view='true']");
  await expect(sheet).toBeVisible();
  const portrait = await sheet.boundingBox();
  expect(portrait && portrait.height > portrait.width).toBe(true);

  // Fichier › Mise en page… : paysage.
  await page.getByRole("button", { name: "Fichier", exact: true }).click();
  await page.getByRole("menuitem", { name: /Mise en page/ }).click();
  const setup = page.getByRole("dialog", { name: "Mise en page" });
  await setup.getByLabel("Paysage").check();
  await setup.getByRole("button", { name: "Appliquer" }).click();
  await expect(async () => {
    const box = await sheet.boundingBox();
    expect(box && box.width > box.height).toBe(true);
  }).toPass({ timeout: 5_000 });

  // Police : la sélection passe en Georgia.
  await surface.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.getByLabel("Police", { exact: true }).selectOption("georgia");
  await expect(page.locator(".workspace-editor span[style*='Georgia']").first()).toBeVisible();

  // Rechercher-remplacer (Ctrl+H) : « chat » → « lion », tout remplacer.
  await surface.click();
  await page.keyboard.press("ControlOrMeta+h");
  await page.getByLabel("Texte à rechercher").fill("chat");
  await page.getByLabel("Remplacer par").fill("lion");
  await page.getByRole("button", { name: "Tout remplacer", exact: true }).click();
  await expect(page.getByText("lion lion chien")).toBeVisible();
  await page.getByRole("button", { name: "Fermer la recherche" }).click();

  // Menu contextuel : clic droit dans le texte.
  await page.getByText("lion lion chien").click({ button: "right" });
  const contextMenu = page.getByRole("menu", { name: "Menu contextuel du document" });
  await expect(contextMenu).toBeVisible();
  await expect(
    contextMenu.getByRole("menuitem", { name: "Coller sans mise en forme" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(contextMenu).toBeHidden();

  // Liste de tâches : une case à cocher apparaît.
  await surface.click();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Liste de tâches" }).click();
  await page.keyboard.type("Relire");
  await expect(
    page.locator(".workspace-editor ul[data-type='taskList'] input[type='checkbox']"),
  ).toHaveCount(1);

  // Persistance : la mise en page paysage et la police survivent au rechargement.
  // « Modifications non enregistrées » contient aussi « enregistré » : on
  // attend explicitement l'état final.
  await expect(page.getByRole("status").filter({ hasText: /^Enregistré/ })).toBeVisible({
    timeout: 15_000,
  });
  await page.reload();
  await page.waitForSelector("html[data-hydrated='true']", { timeout: 40_000 });
  await expect(page.getByText("lion lion chien")).toBeVisible({ timeout: 15_000 });
  await expect(async () => {
    const box = await page.locator("[data-page-view='true']").boundingBox();
    expect(box && box.width > box.height).toBe(true);
  }).toPass({ timeout: 10_000 });
  await expect(page.locator(".workspace-editor span[style*='Georgia']").first()).toBeVisible();
});
