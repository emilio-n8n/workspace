import { describe, expect, it } from "vitest";
import { isLabelColorKey, LABEL_COLORS, labelColorName } from "../src/label-colors.ts";
import {
  activeFilters,
  clearFilter,
  EMPTY_FILTERS,
  filtersAnnouncement,
  filtersEqual,
  hasActiveFilters,
  MAX_FILTER_LENGTH,
  type MailFilters,
  normalizeFilterValue,
} from "../src/ui/filters.ts";
import { labelChipLabel, labelDotClasses, labelSwatchRing } from "../src/ui/label-tokens.ts";

function filters(partial: Partial<MailFilters>): MailFilters {
  return { ...EMPTY_FILTERS, ...partial };
}

describe("filtres — état et annulation", () => {
  it("ne signale aucun filtre sur un état vide", () => {
    expect(hasActiveFilters(EMPTY_FILTERS)).toBe(false);
    expect(activeFilters(EMPTY_FILTERS)).toEqual([]);
    expect(filtersEqual(EMPTY_FILTERS, { ...EMPTY_FILTERS })).toBe(true);
  });

  it("nettoie un critère saisi et le borne", () => {
    expect(normalizeFilterValue("  Amine   Diop  ")).toBe("Amine Diop");
    expect(normalizeFilterValue("x".repeat(200))).toHaveLength(MAX_FILTER_LENGTH);
  });

  it("décrit chaque filtre actif en français, dans l'ordre du bandeau", () => {
    const active = activeFilters(
      filters({
        query: "devis",
        from: "amine@exemple.org",
        to: "client@exemple.org",
        unreadOnly: true,
        starredOnly: true,
        hasAttachment: true,
      }),
    );
    expect(active.map((chip) => chip.label)).toEqual([
      "Recherche : devis",
      "De : amine@exemple.org",
      "À : client@exemple.org",
      "Non lus",
      "Suivis",
      "Avec pièce jointe",
    ]);
    expect(hasActiveFilters(filters({ hasAttachment: true }))).toBe(true);
  });

  it("nomme le filtre de libellé quand le libellé est connu", () => {
    const active = activeFilters(filters({ labelId: "abc" }), "Clients");
    expect(active).toEqual([{ key: "labelId", label: "Libellé : Clients" }]);
  });

  it("retire un filtre à la fois, sans toucher aux autres", () => {
    const initial = filters({ query: "devis", from: "amine@exemple.org", unreadOnly: true });
    const withoutFrom = clearFilter(initial, "from");
    expect(withoutFrom.from).toBe("");
    expect(withoutFrom.query).toBe("devis");
    expect(withoutFrom.unreadOnly).toBe(true);
    expect(clearFilter(initial, "unreadOnly").unreadOnly).toBe(false);
    expect(clearFilter(initial, "labelId").labelId).toBeNull();
  });

  it("annonce le nombre de résultats et les filtres appliqués", () => {
    expect(filtersAnnouncement(EMPTY_FILTERS, 1)).toBe("1 message affiché, aucun filtre.");
    expect(filtersAnnouncement(EMPTY_FILTERS, 4)).toBe("4 messages affichés, aucun filtre.");
    expect(filtersAnnouncement(filters({ unreadOnly: true }), 2, undefined)).toBe(
      "2 messages affichés — filtres : Non lus.",
    );
  });
});

describe("libellés — palette et jetons", () => {
  it("propose cinq couleurs nommées en français", () => {
    expect(LABEL_COLORS).toHaveLength(5);
    expect(LABEL_COLORS.map((color) => color.label)).toEqual([
      "Vert",
      "Ambre",
      "Bleu",
      "Orange",
      "Violet",
    ]);
  });

  it("valide une clé de couleur sans jamais accepter autre chose", () => {
    expect(isLabelColorKey("bleu")).toBe(true);
    expect(isLabelColorKey("#ff0000")).toBe(false);
    expect(isLabelColorKey("chart-1")).toBe(false);
    expect(isLabelColorKey(undefined)).toBe(false);
    expect(labelColorName("violet")).toBe("Violet");
    expect(labelColorName("inconnue")).toBe("Couleur inconnue");
  });

  it("dérive les classes de pastille des tokens sémantiques", () => {
    expect(labelDotClasses("vert")).toBe("bg-primary");
    expect(labelDotClasses("ambre")).toBe("bg-attention");
    expect(labelDotClasses("bleu")).toBe("bg-chart-3");
    expect(labelDotClasses("orange")).toBe("bg-chart-4");
    expect(labelDotClasses("violet")).toBe("bg-chart-5");
    // Une couleur inconnue retombe sur un jeton neutre, jamais sur du noir.
    expect(labelDotClasses("mauve")).toBe("bg-muted-foreground");
  });

  it("n'utilise aucun hexadécimal ni couleur littérale", () => {
    for (const color of LABEL_COLORS) {
      expect(labelDotClasses(color.key)).not.toMatch(/#[0-9a-f]{3,8}/i);
      expect(labelDotClasses(color.key)).not.toMatch(
        /\b(red|blue|green|purple|amber|orange|gray)\b/,
      );
      expect(labelSwatchRing(color.key, true)).toBe(`ring-${labelDotClasses(color.key).slice(3)}`);
      expect(labelSwatchRing(color.key, false)).toBe("ring-transparent");
    }
  });

  it("nomme une puce pour les lecteurs d'écran", () => {
    expect(labelChipLabel({ name: "Clients", color: "vert" })).toBe(
      "Libellé Clients, couleur Vert",
    );
  });
});
