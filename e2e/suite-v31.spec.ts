import { expect, type Page, test } from "@playwright/test";
import { openApp, signupNewUser, uniqueEmail } from "./helpers.ts";

/**
 * Vague v3.1 « parité Office » : commentaires ancrés, nuanciers, images et
 * pagination (Docs) ; filtres, graphiques, formats personnalisés, références
 * entre onglets et volets figés (Sheets) ; poignée de rotation, mode
 * présentateur, texte enrichi et collage entre présentations (Slides) ;
 * import/export OOXML.
 */
const DOCS = "http://localhost:3002";
const SHEETS = "http://localhost:3006";
const SLIDES = "http://localhost:3007";

/** Capture facultative (SHOT=1) pour la relecture visuelle : e2e-explore/v31/. */
async function shot(page: Page, name: string) {
  // biome-ignore lint/suspicious/noUndeclaredEnvVars: capture facultative, relecture visuelle locale uniquement.
  if (process.env.SHOT) await page.screenshot({ path: `e2e-explore/v31/${name}.png` });
}

async function newSpreadsheet(page: Page, title: string) {
  await openApp(page, `${SHEETS}/`);
  await page.getByRole("button", { name: "Nouvelle feuille" }).first().click();
  await page.getByLabel("Titre de la feuille").fill(title);
  await page.getByRole("button", { name: "Créer et ouvrir" }).click();
  const cell = (ref: string) => page.getByRole("button", { name: `Cellule ${ref}`, exact: true });
  await expect(cell("A1")).toBeVisible({ timeout: 20_000 });
  await expect(async () => {
    await cell("A1").click();
    await expect(cell("A1")).toHaveAttribute("aria-current", "true", { timeout: 1_000 });
  }).toPass({ timeout: 20_000 });
  return cell;
}

/** Saisit une grille depuis A1 (une ligne par clic sur sa colonne A, Tab entre colonnes). */
async function typeRows(page: Page, rows: string[][]) {
  for (const [rowIndex, row] of rows.entries()) {
    await page.getByRole("button", { name: `Cellule A${rowIndex + 1}`, exact: true }).click();
    for (const [index, value] of row.entries()) {
      await page.keyboard.type(value);
      await page.keyboard.press(index === row.length - 1 ? "Enter" : "Tab");
    }
  }
}

test("sheets v3.1 : filtre, tri, graphique, format personnalisé, volets figés, référence entre onglets", async ({
  page,
}) => {
  await signupNewUser(page, "Sheets v31", uniqueEmail("sheets-v31"));
  const cell = await newSpreadsheet(page, "Ventes v3.1");
  await typeRows(page, [
    ["Ville", "Ventes"],
    ["Paris", "120"],
    ["Lyon", "90"],
    ["Dakar", "150"],
  ]);
  await expect(cell("B4")).toHaveText("150");

  // Filtre automatique sur la région de données (Ctrl+Maj+L).
  await cell("A1").click();
  await page.keyboard.press("Control+Shift+L");
  const filterButton = page.getByRole("button", { name: "Filtrer la colonne A" });
  await expect(filterButton).toBeVisible();
  await filterButton.click();
  const panel = page.getByRole("dialog", { name: "Filtre de la colonne A" });
  await panel.getByRole("checkbox").nth(2).uncheck(); // « Lyon » (Dakar, Lyon, Paris)
  await panel.getByRole("button", { name: "OK" }).click();
  await expect(cell("A3")).toHaveCount(0);
  await expect(page.getByText("2 lignes sur 3 affichées")).toBeVisible();

  // Tri décroissant depuis le filtre de la colonne B.
  await page.getByRole("button", { name: "Filtrer la colonne B" }).click();
  await page
    .getByRole("dialog", { name: "Filtre de la colonne B" })
    .getByRole("button", { name: "Trier de Z à A" })
    .click();
  await expect(cell("A2")).toHaveText("Dakar");

  // Retirer le filtre : toutes les lignes reviennent.
  await page.getByRole("button", { name: "Données" }).click();
  await page.getByRole("menuitem", { name: "Retirer le filtre" }).click();
  await expect(cell("A3")).toBeVisible();

  // Graphique en histogramme depuis la sélection A1:B4.
  await cell("A1").click();
  await cell("B4").click({ modifiers: ["Shift"] });
  await page.getByRole("button", { name: "Données" }).click();
  await page.getByRole("menuitem", { name: "Insérer un histogramme" }).click();
  const chart = page.locator("[data-chart-id]");
  await expect(chart).toBeVisible();
  await expect(chart.locator("svg[role=img] rect")).toHaveCount(3);
  // Passage en secteurs : 3 parts.
  await chart.getByRole("button", { name: "Type de graphique" }).click();
  await shot(page, "sheets-column");
  await page.getByRole("menuitem", { name: "Secteurs" }).click();
  await expect(chart.locator("svg[role=img] path")).toHaveCount(3);

  // Format personnalisé sur B2.
  await cell("B2").click();
  await page.getByRole("button", { name: "Données" }).click();
  await page.getByRole("menuitem", { name: "Format personnalisé…" }).click();
  await page.getByLabel("Code de format").fill('0.00" €"');
  await page.getByRole("button", { name: "Appliquer" }).click();
  await expect(cell("B2")).toHaveText(/150,00 €/);

  // Volets figés : première ligne collante.
  await page.getByRole("button", { name: "Données" }).click();
  await page.getByRole("menuitem", { name: "Figer la première ligne" }).click();
  await expect(cell("A1").locator("xpath=..")).toHaveCSS("position", "sticky");

  // Référence entre onglets : =Feuil2!A1 lit l'autre onglet.
  await page.getByRole("button", { name: "Onglet", exact: true }).click();
  await page.getByLabel("Nom de l'onglet").fill("Feuil2");
  await page.getByRole("button", { name: "Ajouter" }).click();
  await page.getByRole("button", { name: "Feuil2", exact: true }).click();
  await expect(async () => {
    await cell("A1").click();
    await expect(cell("A1")).toHaveAttribute("aria-current", "true", { timeout: 1_000 });
  }).toPass({ timeout: 10_000 });
  await page.keyboard.type("42");
  await page.keyboard.press("Enter");
  await page
    .locator("button", { hasText: /^Feuille 1$|^Feuil1$/ })
    .first()
    .click();
  await cell("C1").click();
  await page.keyboard.type("=Feuil2!A1*2");
  await page.keyboard.press("Enter");
  await expect(cell("C1")).toHaveText("84");

  // Les réglages sont persistés : après rechargement, graphique et volets restent.
  await page.reload();
  await expect(page.locator("[data-chart-id]")).toBeVisible({ timeout: 20_000 });
  await shot(page, "sheets");
});

async function newPresentation(page: Page, title: string) {
  await openApp(page, `${SLIDES}/`);
  await page.getByRole("button", { name: "Nouvelle présentation" }).first().click();
  await page.getByLabel("Titre de la présentation").fill(title);
  await page.getByRole("button", { name: "Créer et ouvrir" }).click();
  await expect(page.getByRole("button", { name: "Élément titre" })).toBeVisible({
    timeout: 20_000,
  });
  return page.url();
}

test("slides v3.1 : texte enrichi par mot, poignée de rotation, mode présentateur, collage entre présentations", async ({
  page,
}) => {
  await signupNewUser(page, "Slides v31", uniqueEmail("slides-v31"));
  const firstUrl = await newPresentation(page, "Deck A");

  // Texte enrichi : « monde » en gras et en couleur Accent, pas « Bonjour ».
  const editor = page.getByRole("textbox", { name: "Modifier le texte" });
  await expect(async () => {
    await page.getByRole("button", { name: "Élément titre" }).click();
    await expect(editor).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
  await editor.fill("Bonjour monde");
  await editor.evaluate((node) => {
    const text =
      node.firstChild?.nodeType === Node.TEXT_NODE
        ? node.firstChild
        : (node.querySelector("span")?.firstChild ?? node.firstChild);
    if (!text) throw new Error("texte introuvable");
    const range = document.createRange();
    const value = text.textContent ?? "";
    range.setStart(text, value.indexOf("monde"));
    range.setEnd(text, value.indexOf("monde") + 5);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  });
  await page.getByRole("button", { name: "Gras (sélection)" }).click();
  await page.getByRole("button", { name: "Couleur Accent (sélection)" }).click();
  await editor.press("Escape");
  const title = page
    .getByRole("button", { name: "Élément titre" })
    .filter({ hasText: "Bonjour monde" });
  await expect(title).toBeVisible();
  // La graisse de « monde » est basculée (le titre est gras : « monde » ne l'est plus).
  const word = title.locator("[data-run]", { hasText: "monde" });
  const rest = title.locator("[data-run]", { hasText: "Bonjour" });
  await expect(word).toHaveClass(/text-primary/);
  const weights = async () => [
    await rest.evaluate((node) => getComputedStyle(node).fontWeight),
    await word.evaluate((node) => getComputedStyle(node).fontWeight),
  ];
  const [restWeight, wordWeight] = await weights();
  expect(restWeight).not.toBe(wordWeight);

  // Poignée de rotation : glisser vers la droite fait pivoter, Maj aimante à 15°.
  await title.click();
  const handle = page.locator("[data-rotate-handle]");
  await expect(handle).toBeVisible();
  const handleBox = await handle.boundingBox();
  const titleBox = await title.boundingBox();
  if (!handleBox || !titleBox) throw new Error("poignée introuvable");
  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
  await page.mouse.down();
  await page.keyboard.down("Shift");
  await page.mouse.move(titleBox.x + titleBox.width, titleBox.y - 40, { steps: 10 });
  await page.mouse.up();
  await page.keyboard.up("Shift");
  const angle = Number(
    (await title.getAttribute("style"))?.match(/rotate\((\d+)deg\)/)?.[1] ?? "NaN",
  );
  expect(angle).toBeGreaterThan(0);
  expect(angle % 15).toBe(0);

  // Copier le titre (Ctrl+C) pour le coller dans une autre présentation.
  await title.click();
  await page.keyboard.press("ControlOrMeta+c");

  // Mode présentateur : 2 diapositives, suivante, notes, minuteur, fenêtre public.
  await page.keyboard.press("Escape");
  await page.keyboard.press("ControlOrMeta+m");
  await expect(page.getByRole("button", { name: /^Diapositive 2/ }).first()).toBeVisible();
  await page
    .getByRole("button", { name: /^Diapositive 1/ })
    .first()
    .click();
  const popupPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Mode présentateur" }).click();
  const presenter = page.getByRole("dialog", { name: "Mode présentateur" });
  await expect(presenter).toBeVisible();
  await expect(presenter.getByText("Suivante : diapositive 2 sur 2")).toBeVisible();
  await expect(presenter.getByRole("timer")).toHaveText(/00:0\d/);
  const popup = await popupPromise;
  await expect(popup.locator("[data-audience-slide]")).toBeVisible();
  await presenter.getByRole("button", { name: "Pause" }).click();
  await expect(presenter.getByRole("button", { name: "Reprendre" })).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expect(presenter.getByText("Fin du diaporama")).toBeVisible();
  await shot(page, "slides-presenter");
  await page.keyboard.press("Escape");
  await expect(presenter).toHaveCount(0);

  // Autre présentation (autre onglet) : Ctrl+V colle le titre enrichi.
  const second = await page.context().newPage();
  await newPresentation(second, "Deck B");
  await second
    .locator("main")
    .first()
    .click({ position: { x: 5, y: 5 } })
    .catch(() => undefined);
  await second.keyboard.press("Escape");
  await second.keyboard.press("ControlOrMeta+v");
  const pasted = second
    .getByRole("button", { name: "Élément titre" })
    .filter({ hasText: "Bonjour monde" });
  await expect(pasted).toBeVisible();
  await expect(pasted.locator("[data-run]", { hasText: "monde" })).toHaveClass(/text-primary/);
  expect(firstUrl).not.toBe(second.url());
});
