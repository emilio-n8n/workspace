import { describe, expect, it } from "vitest";
import { toPlainText } from "../src/export.ts";
import { fromPlainText } from "../src/service.ts";

describe("fromPlainText (écriture des agents)", () => {
  it("titres, puces et paragraphes", () => {
    const doc = fromPlainText("# Titre\n\nUn paragraphe\nsur deux lignes\n\n- un\n- deux");
    expect(doc.content?.map((node) => node.type)).toEqual(["heading", "paragraph", "bulletList"]);
    expect(doc.content?.[0]?.attrs).toEqual({ level: 1 });
    expect(doc.content?.[2]?.content).toHaveLength(2);
    expect(toPlainText(doc)).toContain("Un paragraphe\nsur deux lignes");
  });

  it("texte vide : un paragraphe vide valide", () => {
    expect(fromPlainText("")).toEqual({ type: "doc", content: [{ type: "paragraph" }] });
  });

  it("aller-retour texte brut", () => {
    expect(toPlainText(fromPlainText("Bonjour\n\nAu revoir"))).toBe("Bonjour\nAu revoir");
  });
});
