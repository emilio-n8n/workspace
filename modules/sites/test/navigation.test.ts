import { describe, expect, it } from "vitest";
import {
  checkNavigation,
  hiddenNavigationCount,
  NAV_LABEL_MAX,
  type NavigationItem,
  type NavigationPage,
  navigationFromPages,
  normalizeNavigation,
  renderNavigation,
  setNavigationLabel,
  toggleNavigationVisibility,
} from "../src/navigation.ts";

const PAGES: NavigationPage[] = [
  { id: "11111111-1111-4111-8111-111111111111", title: "Accueil", slug: "accueil" },
  { id: "22222222-2222-4222-8222-222222222222", title: "Journal", slug: "journal" },
  { id: "33333333-3333-4333-8333-333333333333", title: "Contact", slug: "contact" },
];

// Fixture partagée : l'assertion évite les `!` dispersés dans les tests.
const [ACCUEIL, JOURNAL, CONTACT] = PAGES;
if (!ACCUEIL || !JOURNAL || !CONTACT) throw new Error("pages de test manquantes");

describe("sites — menu de navigation (TASK-006)", () => {
  it("dérive le menu des pages, dans leur ordre", () => {
    expect(navigationFromPages(PAGES)).toEqual([
      { pageId: ACCUEIL.id, label: "Accueil", visible: true },
      { pageId: JOURNAL.id, label: "Journal", visible: true },
      { pageId: CONTACT.id, label: "Contact", visible: true },
    ]);
    // L'ordre du menu suit celui des pages : déplacer une page déplace son
    // entrée, il n'existe jamais deux ordres divergents.
    const renversees = [...PAGES].reverse();
    expect(navigationFromPages(renversees).map((entry) => entry.label)).toEqual([
      "Contact",
      "Journal",
      "Accueil",
    ]);
  });

  it("normalise un menu relu en base sans jamais lever", () => {
    expect(normalizeNavigation(null, PAGES)).toEqual(navigationFromPages(PAGES));
    expect(normalizeNavigation("n'importe quoi", PAGES)).toEqual(navigationFromPages(PAGES));
    const mixed = normalizeNavigation(
      [
        { pageId: CONTACT.id, label: "Nous écrire", visible: false },
        { pageId: "inconnu", label: "Fantôme" },
        { pageId: CONTACT.id, label: "Doublon" },
        "entrée illisible",
      ],
      PAGES,
    );
    // L'ordre suit les pages, la page inconnue et le doublon sont écartés.
    expect(mixed).toEqual([
      { pageId: ACCUEIL.id, label: "Accueil", visible: true },
      { pageId: JOURNAL.id, label: "Journal", visible: true },
      { pageId: CONTACT.id, label: "Nous écrire", visible: false },
    ]);
  });

  it("ajoute au menu une page créée après la dernière sauvegarde", () => {
    const stored = normalizeNavigation([{ pageId: JOURNAL.id, label: "Actus" }], PAGES);
    const nouvelle: NavigationPage[] = [
      ...PAGES,
      { id: "44444444-4444-4444-8444-444444444444", title: "Foire aux questions", slug: "faq" },
    ];
    expect(normalizeNavigation(stored, nouvelle).map((entry) => entry.label)).toEqual([
      "Accueil",
      "Actus",
      "Contact",
      "Foire aux questions",
    ]);
  });

  it("refuse un menu invalide avec un message en français", () => {
    expect(checkNavigation("texte", PAGES).error).toBe("Le menu de navigation est invalide.");
    expect(checkNavigation([42], PAGES).error).toBe("Entrée de menu invalide.");
    expect(checkNavigation([{ pageId: "inconnu" }], PAGES).error).toBe(
      "Le menu référence une page inconnue.",
    );
    expect(checkNavigation([{ pageId: ACCUEIL.id }, { pageId: ACCUEIL.id }], PAGES).error).toBe(
      "Une page apparaît deux fois dans le menu.",
    );
    expect(checkNavigation([{ pageId: ACCUEIL.id, label: 12 }], PAGES).error).toBe(
      "Libellé de menu invalide.",
    );
    expect(
      checkNavigation([{ pageId: ACCUEIL.id, label: "a".repeat(NAV_LABEL_MAX + 1) }], PAGES).error,
    ).toBe(`Libellé de menu limité à ${NAV_LABEL_MAX} caractères.`);
    expect(checkNavigation([{ pageId: ACCUEIL.id, visible: "oui" }], PAGES).error).toBe(
      "Visibilité de menu invalide.",
    );
  });

  it("accepte un menu valide, y compris sans valeur (`null` = menu par défaut)", () => {
    expect(checkNavigation(null, PAGES)).toEqual({
      navigation: navigationFromPages(PAGES),
      error: null,
    });
    const checked = checkNavigation(
      [
        { pageId: JOURNAL.id, label: "  Actus  ", visible: false },
        { pageId: ACCUEIL.id, label: "Accueil", visible: true },
      ],
      PAGES,
    );
    expect(checked.error).toBeNull();
    expect(checked.navigation).toEqual([
      { pageId: ACCUEIL.id, label: "Accueil", visible: true },
      { pageId: JOURNAL.id, label: "Actus", visible: false },
      { pageId: CONTACT.id, label: "Contact", visible: true },
    ]);
  });

  it("modifie un libellé et une visibilité", () => {
    const items = navigationFromPages(PAGES);
    expect(setNavigationLabel(items, JOURNAL.id, "  Actus  ")).toEqual([
      { pageId: ACCUEIL.id, label: "Accueil", visible: true },
      { pageId: JOURNAL.id, label: "Actus", visible: true },
      { pageId: CONTACT.id, label: "Contact", visible: true },
    ]);
    // Un identifiant inconnu ne change rien.
    expect(setNavigationLabel(items, "inconnu", "Rien")).toEqual(items);
    // Le libellé est borné.
    expect(setNavigationLabel(items, ACCUEIL.id, "a".repeat(200))[0]?.label).toHaveLength(
      NAV_LABEL_MAX,
    );

    const masque = toggleNavigationVisibility(items, CONTACT.id);
    expect(masque[2]).toEqual({ pageId: CONTACT.id, label: "Contact", visible: false });
    // Un double appel annule l'opération ; les autres entrées sont intactes.
    expect(toggleNavigationVisibility(masque, CONTACT.id)).toEqual(items);
    expect(toggleNavigationVisibility(items, "inconnu")).toEqual(items);
  });

  it("compte les entrées masquées", () => {
    const items = navigationFromPages(PAGES);
    expect(hiddenNavigationCount(items)).toBe(0);
    expect(
      hiddenNavigationCount([
        ...items.slice(0, 2),
        { pageId: CONTACT.id, label: "Contact", visible: false },
      ]),
    ).toBe(1);
  });
});

describe("sites — rendu du menu", () => {
  it("rend les entrées visibles avec des liens internes échappés", () => {
    const items: NavigationItem[] = [
      { pageId: ACCUEIL.id, label: "Accueil", visible: true },
      { pageId: JOURNAL.id, label: '<script>alert("x")</script>', visible: true },
    ];
    const html = renderNavigation(PAGES, items, ACCUEIL.id);
    expect(html).toContain('<nav aria-label="Menu du site"');
    expect(html).toContain('<a href="/accueil"');
    expect(html).toContain('aria-current="page"');
    // Le libellé est échappé : aucun HTML brut n'est rendu.
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("ignore les entrées masquées et les pages inconnues", () => {
    const html = renderNavigation(
      PAGES,
      [
        { pageId: ACCUEIL.id, label: "Accueil", visible: true },
        { pageId: JOURNAL.id, label: "Journal", visible: false },
        { pageId: "inconnu", label: "Fantôme", visible: true },
      ],
      null,
    );
    expect(html.match(/<li>/g)).toHaveLength(1);
    expect(html).not.toContain("Journal");
    expect(html).not.toContain("Fantôme");
    // Sans page active, aucun lien n'est marqué courant.
    expect(html).not.toContain("aria-current");
  });

  it("marque la page active, quelle que soit sa position", () => {
    const html = renderNavigation(PAGES, navigationFromPages(PAGES), CONTACT.id);
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    expect(html.indexOf("Contact")).toBeGreaterThan(0);
    expect(html).toContain('<a href="/contact"');
  });

  it("rend un menu vide quand aucune entrée n'est visible", () => {
    const html = renderNavigation(
      PAGES,
      [{ pageId: ACCUEIL.id, label: "Accueil", visible: false }],
      ACCUEIL.id,
    );
    expect(html).not.toContain("<li>");
    expect(html).toContain("<nav");
  });
});
