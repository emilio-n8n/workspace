import { describe, expect, it } from "vitest";
import {
  BLOCK_LIBRARY,
  BLOCKS_LIMITS,
  blockFields,
  blockGroups,
  blockLabel,
  blocksToMarkdown,
  checkBlocks,
  createBlock,
  findBlock,
  insertBlock,
  markdownToBlocks,
  moveBlock,
  normalizeBlocks,
  patchBlock,
  removeBlock,
  renderBlock,
  renderBlocks,
  type SiteBlock,
  type SiteBlockKind,
  safeImageUrl,
  safeUrl,
} from "../src/blocks.ts";

const ID = "0f4d1b2c-3a4b-4c5d-8e9f-0a1b2c3d4e5f";
const OTHER = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const THIRD = "2b3c4d5e-6f70-4a8b-9c0d-1e2f3a4b5c6d";

/** Bloc d'identifiant connu (les identifiants sont sinon aléatoires). */
function make(kind: SiteBlockKind, id: string, overrides: Record<string, unknown> = {}): SiteBlock {
  return createBlock(kind, id, overrides);
}

describe("sites — bibliothèque de blocs (TASK-001)", () => {
  it("expose exactement les cinq blocs annoncés", () => {
    expect(BLOCK_LIBRARY.map((definition) => definition.kind)).toEqual([
      "heading",
      "text",
      "image",
      "button",
      "columns",
    ]);
    expect(BLOCK_LIBRARY.map((definition) => definition.label)).toEqual([
      "Titre",
      "Texte",
      "Image",
      "Bouton",
      "Colonnes",
    ]);
    for (const definition of BLOCK_LIBRARY) {
      expect(definition.description.length).toBeGreaterThan(0);
    }
  });

  it("nomme chaque bloc pour les libellés d'accessibilité", () => {
    expect(blockLabel("heading")).toBe("Titre");
    expect(blockLabel("columns")).toBe("Colonnes");
  });

  it("crée chaque bloc avec des valeurs par défaut utilisables", () => {
    const heading = createBlock("heading", ID);
    expect(heading).toMatchObject({ id: ID, kind: "heading", level: 2, align: "left" });
    expect(createBlock("text", ID)).toMatchObject({ id: ID, kind: "text", align: "left" });
    expect(createBlock("image", ID)).toMatchObject({
      id: ID,
      kind: "image",
      width: "large",
      rounded: true,
    });
    expect(createBlock("button", ID)).toMatchObject({ id: ID, kind: "button", style: "primary" });
    const columns = createBlock("columns", ID);
    expect(columns).toMatchObject({ id: ID, kind: "columns", count: 2 });
    if (columns.kind !== "columns") throw new Error("type");
    expect(columns.children).toHaveLength(2);
  });

  it("décrit les propriétés par famille : contenu, lien, style", () => {
    // Bouton : les trois familles sont représentées.
    expect(blockGroups("button")).toEqual(["content", "link", "style"]);
    expect(blockFields("button").map((field) => [field.group, field.key])).toEqual([
      ["content", "label"],
      ["link", "href"],
      ["style", "style"],
      ["style", "align"],
    ]);
    // Titre : contenu puis style uniquement.
    expect(blockGroups("heading")).toEqual(["content", "style"]);
    // Aucun bloc sans propriété.
    for (const definition of BLOCK_LIBRARY) {
      expect(definition.fields.length).toBeGreaterThan(0);
    }
  });
});

describe("sites — lecture et écriture des blocs", () => {
  it("normalise une mise en page venue de la base sans jamais lever", () => {
    expect(normalizeBlocks(null)).toEqual([]);
    expect(normalizeBlocks("n'importe quoi")).toEqual([]);
    // Champs absents ou corrompus : valeurs par défaut, champs inconnus ôtés.
    expect(
      normalizeBlocks([
        { id: ID, kind: "text", text: "Bonjour", align: "droite", xss: "<script>" },
      ]),
    ).toEqual([{ id: ID, kind: "text", text: "Bonjour", align: "left" }]);
    // Bloc illisible (identifiant invalide) : écarté, la page reste lisible.
    expect(
      normalizeBlocks([
        { id: "pas-un-uuid", kind: "text" },
        { id: ID, kind: "text" },
      ]),
    ).toEqual([{ id: ID, kind: "text", text: "", align: "left" }]);
    // Type inconnu : écarté.
    expect(normalizeBlocks([{ id: ID, kind: "video" }])).toEqual([]);
  });

  it("plafonne les enfants d'une colonne et refuse l'imbrication", () => {
    const children = Array.from({ length: BLOCKS_LIMITS.children + 3 }, (_, index) => ({
      id: `11111111-2222-4333-8444-${String(index).padStart(12, "0")}`,
      kind: "text",
      text: `Colonne ${index}`,
    }));
    const [columns] = normalizeBlocks([{ id: ID, kind: "columns", count: 5, children }]);
    if (columns?.kind !== "columns") throw new Error("type");
    expect(columns.children).toHaveLength(BLOCKS_LIMITS.children);
    // `count` hors bornes retombe sur la valeur par défaut.
    expect(columns.count).toBe(2);
  });

  it("refuse une mise en page invalide avec un message en français", () => {
    expect(checkBlocks("texte").error).toBe("La mise en page est invalide.");
    expect(checkBlocks([{ id: ID, kind: "video" }]).error).toContain("Type de bloc inconnu");
    expect(
      checkBlocks([
        { id: ID, kind: "text" },
        { id: ID, kind: "text" },
      ]).error,
    ).toBe("Deux blocs portent le même identifiant.");
    expect(checkBlocks([{ id: "court", kind: "text" }]).error).toContain("identifiant");
    expect(
      checkBlocks([{ id: ID, kind: "columns", children: [{ id: OTHER, kind: "image" }] }]).error,
    ).toBe("Seuls les titres et les textes sont autorisés en colonne.");
    const trop = Array.from({ length: BLOCKS_LIMITS.blocks + 1 }, (_, index) => ({
      id: `11111111-2222-4333-8444-${String(index).padStart(12, "0")}`,
      kind: "text",
    }));
    expect(checkBlocks(trop).error).toBe(`${BLOCKS_LIMITS.blocks} blocs par page au maximum.`);
  });

  it("accepte une mise en page valide et la normalise au passage", () => {
    const { blocks, error } = checkBlocks([
      { id: ID, kind: "heading", text: "  Bienvenue  ", level: 3 },
      {
        id: OTHER,
        kind: "columns",
        count: 3,
        children: [{ id: THIRD, kind: "text", text: "Col" }],
      },
    ]);
    expect(error).toBeNull();
    expect(blocks).toEqual([
      { id: ID, kind: "heading", text: "Bienvenue", level: 3, align: "left" },
      {
        id: OTHER,
        kind: "columns",
        count: 3,
        align: "left",
        children: [{ id: THIRD, kind: "text", text: "Col", align: "left" }],
      },
    ]);
  });
});

describe("sites — sélection et déplacement des blocs (TASK-002)", () => {
  const three = () => [make("heading", ID), make("text", OTHER), make("button", THIRD)];

  it("retrouve un bloc où qu'il soit dans la page", () => {
    const blocks: SiteBlock[] = [
      make("columns", ID, {
        children: [createBlock("text", OTHER), createBlock("heading", THIRD)],
      }),
      make("text", "3c4d5e6f-7080-4a9b-8c1d-2e3f4a5b6c7d"),
    ];
    expect(findBlock(blocks, THIRD)?.kind).toBe("heading");
    expect(findBlock(blocks, "inconnu")).toBeNull();
  });

  it("descend et monte un bloc", () => {
    const moved = moveBlock(three(), ID, "down");
    expect(moved.map((block) => block.id)).toEqual([OTHER, ID, THIRD]);
    expect(moveBlock(moved, ID, "up").map((block) => block.id)).toEqual([ID, OTHER, THIRD]);
  });

  it("laisse le tableau inchangé (même référence) aux bordures", () => {
    const blocks = three();
    expect(moveBlock(blocks, ID, "up")).toBe(blocks);
    expect(moveBlock(blocks, THIRD, "down")).toBe(blocks);
    expect(moveBlock(blocks, "inconnu", "down")).toBe(blocks);
  });

  it("déplace un bloc à l'intérieur de sa colonne sans toucher aux autres", () => {
    const blocks: SiteBlock[] = [
      make("heading", ID),
      make("columns", OTHER, {
        children: [
          createBlock("text", THIRD),
          createBlock("text", "4d5e6f70-8182-4b9c-8d2e-3f4a5b6c7d8e"),
        ],
      }),
    ];
    const moved = moveBlock(blocks, THIRD, "down");
    const columns = moved[1];
    if (columns?.kind !== "columns") throw new Error("type");
    expect(columns.children.map((child) => child.id)).toEqual([
      "4d5e6f70-8182-4b9c-8d2e-3f4a5b6c7d8e",
      THIRD,
    ]);
    // Le premier niveau n'a pas bougé.
    expect(moved.map((block) => block.id)).toEqual([ID, OTHER]);
  });

  it("insère après la sélection, sinon en fin de page", () => {
    const blocks = three();
    expect(
      insertBlock(blocks, make("text", "5e6f7081-9293-4c0d-8e3f-4a5b6c7d8e9f"), OTHER).map(
        (b) => b.id,
      ),
    ).toEqual([ID, OTHER, "5e6f7081-9293-4c0d-8e3f-4a5b6c7d8e9f", THIRD]);
    expect(
      insertBlock(blocks, make("text", "5e6f7081-9293-4c0d-8e3f-4a5b6c7d8e9f"), null).at(-1)?.id,
    ).toBe("5e6f7081-9293-4c0d-8e3f-4a5b6c7d8e9f");
    // Sélection introuvable (par exemple un enfant de colonne) : ajout en fin.
    expect(
      insertBlock(blocks, make("text", "5e6f7081-9293-4c0d-8e3f-4a5b6c7d8e9f"), "inconnu"),
    ).toHaveLength(4);
  });

  it("retire un bloc où qu'il soit", () => {
    const blocks: SiteBlock[] = [
      make("heading", ID),
      make("columns", OTHER, { children: [createBlock("text", THIRD)] }),
    ];
    expect(removeBlock(blocks, THIRD).map((block) => block.id)).toEqual([ID, OTHER]);
    expect(removeBlock(blocks, ID).map((block) => block.id)).toEqual([OTHER]);
    // Rien à retirer : même référence.
    expect(removeBlock(blocks, "inconnu")).toBe(blocks);
  });
});

describe("sites — propriétés des blocs (TASK-003)", () => {
  it("modifie le contenu d'un bloc texte", () => {
    const blocks = [make("text", ID)];
    const patched = patchBlock(blocks, ID, "text", "  Nouveau texte  ");
    expect(patched[0]).toMatchObject({ kind: "text", text: "Nouveau texte" });
  });

  it("modifie le lien d'un bouton et son apparence", () => {
    const blocks = [make("button", ID)];
    expect(patchBlock(blocks, ID, "href", "/contact")[0]).toMatchObject({ href: "/contact" });
    expect(patchBlock(blocks, ID, "style", "ghost")[0]).toMatchObject({ style: "ghost" });
    expect(patchBlock(blocks, ID, "label", "Écrire")[0]).toMatchObject({ label: "Écrire" });
    // Apparence inconnue : valeur conservée.
    expect(patchBlock(blocks, ID, "style", "fluo")[0]).toMatchObject({ style: "primary" });
  });

  it("modifie le style d'une image (largeur, alignement, coins)", () => {
    const blocks = [make("image", ID)];
    expect(patchBlock(blocks, ID, "width", "full")[0]).toMatchObject({ width: "full" });
    expect(patchBlock(blocks, ID, "align", "center")[0]).toMatchObject({ align: "center" });
    expect(patchBlock(blocks, ID, "rounded", false)[0]).toMatchObject({ rounded: false });
    expect(patchBlock(blocks, ID, "alt", "Photo")[0]).toMatchObject({ alt: "Photo" });
  });

  it("modifie le niveau d'un titre et son alignement", () => {
    const blocks = [make("heading", ID)];
    expect(patchBlock(blocks, ID, "level", "3")[0]).toMatchObject({ level: 3 });
    expect(patchBlock(blocks, ID, "level", "9")[0]).toMatchObject({ level: 2 });
    expect(patchBlock(blocks, ID, "align", "right")[0]).toMatchObject({ align: "right" });
  });

  it("ignore une clé inconnue et un bloc absent", () => {
    const blocks = [make("text", ID)];
    expect(patchBlock(blocks, ID, "src", "https://exemple.org")).toBe(blocks);
    expect(patchBlock(blocks, OTHER, "text", "Rien")).toBe(blocks);
    expect(patchBlock(blocks, ID, "href", "/x")).toBe(blocks);
  });

  it("atteint un bloc enfant de colonne", () => {
    const blocks: SiteBlock[] = [make("columns", ID, { children: [createBlock("text", OTHER)] })];
    expect(patchBlock(blocks, OTHER, "text", "Colonne modifiée")[1]).toBeUndefined();
    const columns = patchBlock(blocks, OTHER, "text", "Colonne modifiée")[0];
    if (columns?.kind !== "columns") throw new Error("type");
    expect(columns.children[0]).toMatchObject({ id: OTHER, text: "Colonne modifiée" });
  });

  it("plafonne la longueur saisie", () => {
    const blocks = [make("heading", ID)];
    const patched = patchBlock(blocks, ID, "text", "a".repeat(400));
    if (patched[0]?.kind !== "heading") throw new Error("type");
    expect(patched[0].text).toHaveLength(BLOCKS_LIMITS.heading);
  });
});

describe("sites — URL assainies", () => {
  it("accepte http(s), mailto, tel et les chemins internes", () => {
    expect(safeUrl("https://exemple.org/page")).toBe("https://exemple.org/page");
    expect(safeUrl("http://exemple.org")).toBe("http://exemple.org");
    expect(safeUrl("mailto:bonjour@exemple.org")).toBe("mailto:bonjour@exemple.org");
    expect(safeUrl("tel:+33612345678")).toBe("tel:+33612345678");
    expect(safeUrl("/contact")).toBe("/contact");
    expect(safeUrl("#ancre")).toBe("#ancre");
    expect(safeUrl("./page")).toBe("./page");
  });

  it("refuse javascript:, les données: non image et les URL trop longues", () => {
    expect(safeUrl("javascript:alert(1)")).toBeNull();
    expect(safeUrl("  javascript:alert(1)  ")).toBeNull();
    expect(safeUrl("JaVaScRiPt:alert(1)")).toBeNull();
    expect(safeUrl(`x${"a".repeat(BLOCKS_LIMITS.url)}`)).toBeNull();
    expect(safeUrl("")).toBeNull();
  });

  it("neutralise les caractères de contrôle utilisés pour tromper le schéma", () => {
    // Sans nettoyage, « java\\tscript: » contournerait un simple startsWith.
    expect(safeUrl("java\tscript:alert(1)")).toBeNull();
    expect(safeUrl("java\nscript:alert(1)")).toBeNull();
  });

  it("assainit les sources d'image : http(s), interne et bitmaps base64", () => {
    expect(safeImageUrl("https://exemple.org/photo.jpg")).toBe("https://exemple.org/photo.jpg");
    expect(safeImageUrl("/images/photo.png")).toBe("/images/photo.png");
    expect(safeImageUrl("data:image/png;base64,iVBORw0KGgo=")).toBe(
      "data:image/png;base64,iVBORw0KGgo=",
    );
    expect(safeImageUrl("data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=")).toBeNull();
    expect(safeImageUrl("javascript:alert(1)")).toBeNull();
    expect(safeImageUrl("mailto:x@exemple.org")).toBeNull();
  });
});

describe("sites — rendu des blocs", () => {
  it("échappe tout contenu saisi", () => {
    const html = renderBlock(make("text", ID, { text: '<script>alert("x")</script>' }));
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    const heading = renderBlock(make("heading", ID, { text: "<img src=x onerror=alert(1)>" }));
    expect(heading).not.toContain("<img");
  });

  it("rend un titre selon son niveau et son alignement", () => {
    expect(renderBlock(make("heading", ID, { text: "Bonjour", level: 1 }))).toContain("<h1");
    expect(renderBlock(make("heading", ID, { text: "Bonjour", level: 3 }))).toContain("<h3");
    expect(renderBlock(make("heading", ID, { align: "center" }))).toContain("justify-center");
    expect(renderBlock(make("heading", ID, { align: "right" }))).toContain("justify-end");
  });

  it("rend un paragraphe avec ses retours à la ligne", () => {
    const html = renderBlock(make("text", ID, { text: "Ligne un\nLigne deux" }));
    expect(html).toContain("<p");
    expect(html).toContain("Ligne un<br />Ligne deux");
  });

  it("rend un bouton cliquable, ou inerte sans lien valide", () => {
    const lien = renderBlock(make("button", ID, { label: "Écrire", href: "https://exemple.org" }));
    expect(lien).toContain('<a href="https://exemple.org"');
    expect(lien).toContain('target="_blank"');
    expect(lien).toContain('rel="noreferrer"');
    expect(lien).toContain("Écrire");
    const interne = renderBlock(make("button", ID, { label: "Écrire", href: "/contact" }));
    expect(interne).toContain('<a href="/contact"');
    expect(interne).not.toContain("target=");
    const casse = renderBlock(make("button", ID, { label: "Danger", href: "javascript:alert(1)" }));
    expect(casse).not.toContain("<a");
    expect(casse).not.toContain("javascript:");
  });

  it("rend une image avec son texte alternatif, ou un message sans URL", () => {
    const image = renderBlock(
      make("image", ID, { src: "https://exemple.org/photo.jpg", alt: "Équipe", width: "full" }),
    );
    expect(image).toContain('<img src="https://exemple.org/photo.jpg"');
    expect(image).toContain('alt="Équipe"');
    expect(image).toContain("w-full");
    expect(image).toContain("rounded-xl");
    const vide = renderBlock(make("image", ID, { src: "", alt: "Équipe" }));
    expect(vide).not.toContain("<img");
    expect(vide).toContain("Image indisponible");
    const carre = renderBlock(
      make("image", ID, { src: "/photo.jpg", alt: "Équipe", rounded: false }),
    );
    expect(carre).toContain("rounded-none");
    expect(carre).not.toContain("rounded-xl");
  });

  it("rend des colonnes en grille", () => {
    const html = renderBlock(
      make("columns", ID, {
        count: 3,
        children: [createBlock("text", OTHER), createBlock("text", THIRD)],
      }),
    );
    expect(html).toContain("grid-template-columns: 1fr 1fr 1fr");
    expect(html.match(/<p/g)).toHaveLength(2);
    expect(html.match(/text-center/g)).toBeNull();
  });

  it("empile les blocs dans un conteneur unique", () => {
    const html = renderBlocks([make("heading", ID), make("text", OTHER)]);
    expect(html).toContain("flex flex-col");
    expect(html.match(/class="flex justify-start text-left"/g)).toHaveLength(2);
  });
});

describe("sites — pont Markdown ↔ blocs", () => {
  it("convertit un contenu Markdown en blocs", () => {
    const blocks = markdownToBlocks("# Titre\n\nUn paragraphe\nsur deux lignes\n\n### Section");
    expect(blocks.map((block) => block.kind)).toEqual(["heading", "text", "heading"]);
    expect(blocks[0]).toMatchObject({ kind: "heading", text: "Titre", level: 1 });
    expect(blocks[1]).toMatchObject({ kind: "text", text: "Un paragraphe\nsur deux lignes" });
    expect(blocks[2]).toMatchObject({ kind: "heading", text: "Section", level: 3 });
  });

  it("ignore les titres de niveau 4 à 6", () => {
    expect(markdownToBlocks("#### Trop profond")).toHaveLength(1);
    expect(markdownToBlocks("#### Trop profond")[0]?.kind).toBe("text");
  });

  it("revient au Markdown depuis les blocs", () => {
    const markdown = blocksToMarkdown([
      make("heading", ID, { text: "Titre", level: 2 }),
      make("text", OTHER, { text: "Paragraphe" }),
      make("image", THIRD, { src: "https://exemple.org/p.jpg", alt: "Photo" }),
      make("button", "3c4d5e6f-7081-4a2b-8c3d-4e5f6a7b8c9d", { label: "Écrire", href: "/contact" }),
      make("columns", "4d5e6f70-8192-4b3c-9d4e-5f6a7b8c9d0e", {
        children: [createBlock("text", "5e6f7081-92a3-4c4d-8e5f-6a7b8c9d0e1f")],
      }),
    ]);
    expect(markdown).toBe(
      [
        "## Titre",
        "Paragraphe",
        "![Photo](https://exemple.org/p.jpg)",
        "[Écrire](/contact)",
        "Un paragraphe de texte : remplacez ce contenu par le vôtre.",
      ].join("\n\n"),
    );
  });

  it("fait l'aller-retour Markdown → blocs → Markdown sans perdre le texte", () => {
    const source = "# Bienvenue\n\nCette page est modifiable.";
    const markdown = blocksToMarkdown(markdownToBlocks(source));
    expect(markdown).toBe("# Bienvenue\n\nCette page est modifiable.");
  });
});
