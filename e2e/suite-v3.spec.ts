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

test("sheets v3 : saisie directe, recopie, fonctions françaises, autocomplétion, mise en forme de plage", async ({
  page,
}) => {
  await signupNewUser(page, "Sheets v3", uniqueEmail("sheets-v3"));
  await openApp(page, `${SHEETS}/`);
  await page.getByRole("button", { name: "Nouvelle feuille" }).first().click();
  await page.getByLabel("Titre de la feuille").fill("Ventes v3");
  await page.getByRole("button", { name: "Créer et ouvrir" }).click();

  const cell = (ref: string) => page.getByRole("button", { name: `Cellule ${ref}`, exact: true });
  const input = (ref: string) => page.getByRole("textbox", { name: `Cellule ${ref}`, exact: true });
  await expect(cell("A1")).toBeVisible({ timeout: 20_000 });

  // Modèle Excel : un clic sélectionne (pas d'édition), la frappe remplace.
  await expect(async () => {
    await cell("A1").click();
    await expect(cell("A1")).toHaveAttribute("aria-current", "true", { timeout: 1_000 });
  }).toPass({ timeout: 20_000 });
  await expect(input("A1")).toHaveCount(0);
  await page.keyboard.type("10");
  await expect(input("A1")).toHaveValue("10");
  await page.keyboard.press("Enter");
  // Entrée valide et sélectionne la cellule du dessous, sans l'éditer.
  await expect(cell("A2")).toHaveAttribute("aria-current", "true");
  await page.keyboard.type("20");
  await page.keyboard.press("Enter");
  await expect(cell("A2")).toHaveText("20");

  // Poignée de recopie : A1:A2 prolongée jusqu'à A5 → 30, 40, 50.
  await cell("A1").click();
  await cell("A2").click({ modifiers: ["Shift"] });
  const handle = page.locator("[data-fill-handle]");
  await expect(handle).toBeVisible();
  const from = await handle.boundingBox();
  const to = await cell("A5").boundingBox();
  if (!from || !to) throw new Error("poignée ou cellule introuvable");
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect(cell("A3")).toHaveText("30");
  await expect(cell("A5")).toHaveText("50");

  // Fonction française avec point-virgule.
  await cell("B1").click();
  await page.keyboard.type("=SOMME(A1;A5)");
  await page.keyboard.press("Enter");
  await expect(cell("B1")).toHaveText("60");

  // Autocomplétion : « =MOY » propose MOYENNE, Tab l'insère.
  await page.keyboard.type("=MOY");
  const suggestions = page.getByRole("listbox", { name: "Fonctions suggérées" });
  await expect(suggestions.getByRole("option", { name: /MOYENNE/ }).first()).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(input("B2")).toHaveValue("=MOYENNE(");
  await page.keyboard.type("A1:A5)");
  await page.keyboard.press("Enter");
  await expect(cell("B2")).toHaveText("30");

  // Mise en forme de plage : A1:A3 en gras d'un coup.
  await cell("A1").click();
  await cell("A3").click({ modifiers: ["Shift"] });
  await page.getByRole("button", { name: "Gras", exact: true }).click();
  for (const ref of ["A1", "A2", "A3"]) {
    await expect(cell(ref)).toHaveCSS("font-weight", "700");
  }
  await expect(cell("A4")).not.toHaveCSS("font-weight", "700");

  // Barre d'état : somme de la plage sélectionnée.
  await cell("A5").click({ modifiers: ["Shift"] });
  await expect(page.getByText("Somme : 150")).toBeVisible();

  // Suppr efface le contenu de la cellule active.
  await cell("B2").click();
  await page.keyboard.press("Delete");
  await expect(cell("B2")).toHaveText("");

  // Persistance.
  await expect(page.getByRole("status").filter({ hasText: /^Enregistré$/ })).toBeVisible({
    timeout: 15_000,
  });
  await page.reload();
  await page.waitForSelector("html[data-hydrated='true']", { timeout: 40_000 });
  await expect(cell("A5")).toHaveText("50", { timeout: 15_000 });
  await expect(cell("B1")).toHaveText("60");
  await expect(cell("A2")).toHaveCSS("font-weight", "700");
  await expect(cell("B2")).toHaveText("");
});

test("slides v3 : menu contextuel, remplissage, rotation, raccourcis, collage de texte, trieuse", async ({
  page,
}) => {
  await signupNewUser(page, "Slides v3", uniqueEmail("slides-v3"));
  await openApp(page, `${SLIDES}/`);
  await page.getByRole("button", { name: "Nouvelle présentation" }).first().click();
  await page.getByLabel("Titre de la présentation").fill("Pitch v3");
  await page.getByRole("button", { name: "Créer et ouvrir" }).click();
  await expect(page.getByRole("button", { name: "Élément titre" })).toBeVisible({
    timeout: 20_000,
  });

  // Plus aucun glyphe « ＋ » pleine chasse : de vraies icônes.
  await expect(page.getByText("＋")).toHaveCount(0);

  // Insertion d'un rectangle (reprise : course d'hydratation).
  const rect = page.getByRole("button", { name: "Élément rectangle" });
  await expect(async () => {
    await page.getByRole("button", { name: "Formes" }).click();
    await page.getByRole("menuitem", { name: "Rectangle" }).click();
    await expect(rect.first()).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
  await expect(rect).toHaveCount(1);

  // Remplissage (jeton accent) et rotation à 45°.
  await page.getByLabel("Remplissage", { exact: true }).selectOption("accent");
  await expect(rect).toHaveClass(/bg-primary/);
  await page.getByLabel("Rotation (degrés)").fill("45");
  await expect(rect).toHaveAttribute("style", /rotate\(45deg\)/);

  // Flèches : déplacement d'un pas (1 %) de l'élément sélectionné.
  await rect.click();
  const leftOf = async () =>
    Number.parseFloat((await rect.getAttribute("style"))?.match(/left:\s*([\d.]+)%/)?.[1] ?? "NaN");
  const before = await leftOf();
  await page.keyboard.press("ArrowRight");
  await expect.poll(leftOf).toBeCloseTo(before + 1, 1);
  await page.keyboard.press("Shift+ArrowRight");
  await expect.poll(leftOf).toBeCloseTo(before + 6, 1);

  // Menu contextuel de l'élément : Dupliquer.
  await rect.click({ button: "right" });
  const menu = page.getByRole("menu", { name: "Actions de l'élément" });
  await expect(menu).toBeVisible();
  await menu.getByRole("menuitem", { name: "Dupliquer" }).click();
  await expect(rect).toHaveCount(2);
  // Ctrl+D duplique la sélection.
  await page.keyboard.press("ControlOrMeta+d");
  await expect(rect).toHaveCount(3);

  // Collage d'un texte venu d'ailleurs : nouvelle zone de texte.
  await page.keyboard.press("Escape");
  await page.evaluate(() => {
    const data = new DataTransfer();
    data.setData("text/plain", "Texte collé d'ailleurs");
    document.body.dispatchEvent(
      new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }),
    );
  });
  await expect(page.getByRole("button", { name: "Élément Texte collé d'ailleurs" })).toBeVisible();

  // Ctrl+M : nouvelle diapositive ; Ctrl+D sans sélection : duplique la diapositive.
  const thumbs = page.getByRole("list", { name: "Liste des diapositives" }).locator("[data-thumb]");
  await expect(thumbs).toHaveCount(1);
  await page.keyboard.press("Escape");
  await page.keyboard.press("ControlOrMeta+m");
  await expect(thumbs).toHaveCount(2);
  await page.keyboard.press("ControlOrMeta+d");
  await expect(thumbs).toHaveCount(3);

  // Menu contextuel d'une vignette.
  await thumbs.nth(2).click({ button: "right" });
  const slideMenu = page.getByRole("menu", { name: "Actions de la diapositive" });
  await expect(slideMenu).toBeVisible();
  await slideMenu.getByRole("menuitem", { name: "Supprimer la diapositive" }).click();
  await expect(thumbs).toHaveCount(2);

  // Trieuse : toutes les diapositives en grille, Entrée rouvre la vue normale.
  await page.getByRole("button", { name: "Trieuse de diapositives" }).click();
  const sorter = page.getByRole("region", { name: "Trieuse de diapositives" });
  await expect(sorter).toBeVisible();
  const sorterThumbs = sorter.locator("[data-sorter-thumb]");
  await expect(sorterThumbs).toHaveCount(2);
  await sorterThumbs.first().click();
  await page.keyboard.press("Enter");
  await expect(sorter).toHaveCount(0);
  await expect(rect.first()).toBeVisible();

  // Persistance du remplissage et de la rotation.
  await expect(page.getByRole("status").filter({ hasText: /^Enregistré$/ })).toBeVisible({
    timeout: 15_000,
  });
  await page.reload();
  await page.waitForSelector("html[data-hydrated='true']", { timeout: 40_000 });
  await expect(rect.first()).toHaveClass(/bg-primary/, { timeout: 15_000 });
  await expect(rect.first()).toHaveAttribute("style", /rotate\(45deg\)/);
  await expect(page.getByText("Texte collé d'ailleurs").first()).toBeVisible();
});
