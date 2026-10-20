import { describe, expect, it } from "vitest";
import {
  clamp,
  cloneSlide,
  type EditorSlide,
  mergeSavedIds,
  rebindSlide,
  round1,
  slideTitle,
  toEditor,
} from "../src/editor-model.ts";
import type { SlideView } from "../src/service.ts";

function slideView(overrides: Partial<SlideView> = {}): SlideView {
  return {
    id: "slide-1",
    position: 0,
    title: "Intro",
    notes: null,
    elements: [
      {
        id: "element-1",
        kind: "text",
        x: 10,
        y: 20,
        w: 40,
        h: 12,
        text: "Bonjour",
        fontSize: 24,
        bold: false,
        italic: false,
        underline: false,
        textColor: "default",
        placeholder: null,
        align: "left",
        fill: "theme",
        rotation: 0,
      },
    ],
    ...overrides,
  };
}

function editorSlide(overrides: Partial<EditorSlide> = {}): EditorSlide {
  return {
    key: "key-a",
    title: "A",
    notes: "",
    elements: [],
    ...overrides,
  };
}

describe("slides — modèle de l'éditeur", () => {
  it("convertit une présentation relue en état local", () => {
    const slides = toEditor([slideView(), slideView({ id: "slide-2", title: null })]);
    expect(slides).toHaveLength(2);
    expect(slides.map((slide) => slide.title)).toEqual(["Intro", ""]);
    expect(slides[0]?.id).toBe("slide-1");
    // Chaque diapositive et chaque élément reçoit une clé React distincte.
    expect(new Set(slides.map((slide) => slide.key)).size).toBe(2);
    expect(slides[0]?.elements[0]?.key).toBeTypeOf("string");
    expect(slides[0]?.elements[0]?.key).not.toBe(slides[0]?.elements[0]?.id);
  });

  it("injecte les identifiants serveur sans casser les éditions en cours", () => {
    const sent: EditorSlide[] = [editorSlide({ key: "key-a" })];
    // Pendant la sauvegarde, l'utilisateur ajoute un élément non envoyé.
    const current: EditorSlide[] = [
      {
        key: "key-a",
        id: "saved-1",
        title: "A",
        notes: "",
        elements: [
          {
            key: "key-el",
            id: "el-1",
            kind: "text",
            x: 1,
            y: 2,
            w: 3,
            h: 4,
            text: "",
            fontSize: 24,
            bold: false,
            italic: false,
            underline: false,
            textColor: "default",
            placeholder: null,
            align: "left",
            fill: "theme",
            rotation: 0,
          },
        ],
      },
    ];
    const merged = mergeSavedIds(current, sent, [slideView({ id: "saved-1" })]);
    expect(merged[0]?.id).toBe("saved-1");
    expect(merged[0]?.elements[0]?.id).toBe("el-1");
    // La clé React ne change pas : aucun remontage, édition préservée.
    expect(merged[0]?.elements[0]?.key).toBe("key-el");
  });

  it("laisse intact un état dont les identifiants sont déjà connus", () => {
    const slides = [editorSlide({ id: "existing" })];
    expect(mergeSavedIds(slides, slides, [slideView()])).toEqual(slides);
    // Sans correspondance dans ce qui a été envoyé : rien à compléter.
    expect(mergeSavedIds(slides, [editorSlide({ key: "other" })], [slideView()])).toEqual(slides);
  });

  it("clone une diapositive avec des clés neuves et sans identifiant serveur", () => {
    const source: EditorSlide = {
      id: "slide-1",
      key: "key-a",
      title: "Intro",
      notes: "Parler des prix",
      elements: [
        {
          key: "key-el",
          id: "el-1",
          kind: "text",
          x: 5,
          y: 5,
          w: 20,
          h: 10,
          text: "Bonjour",
          fontSize: 24,
          bold: false,
          italic: false,
          underline: false,
          textColor: "default",
          placeholder: null,
          align: "left",
          fill: "theme",
          rotation: 0,
        },
      ],
    };
    const copy = cloneSlide(source, "Intro (copie)");
    expect(copy.id).toBeUndefined();
    expect(copy.key).not.toBe(source.key);
    expect(copy.title).toBe("Intro (copie)");
    expect(copy.notes).toBe(source.notes);
    expect(copy.elements[0]?.id).toBeUndefined();
    expect(copy.elements[0]?.key).not.toBe(source.elements[0]?.key);
    expect(copy.elements[0]?.text).toBe("Bonjour");
    // La source n'est pas modifiée par le clonage.
    expect(source.elements[0]?.id).toBe("el-1");
  });

  it("prépare une diapositive rétablie sans identifiant serveur périmé", () => {
    const source: EditorSlide = {
      id: "slide-1",
      key: "key-a",
      title: "Intro",
      notes: "",
      elements: [
        {
          key: "key-el",
          id: "el-1",
          kind: "shape",
          x: 5,
          y: 5,
          w: 20,
          h: 10,
          text: "",
          fontSize: 24,
          bold: false,
          italic: false,
          underline: false,
          textColor: "default",
          placeholder: null,
          align: "left",
          fill: "theme",
          rotation: 0,
        },
      ],
    };
    const rebound = rebindSlide(source);
    expect(rebound.id).toBeUndefined();
    expect(rebound.elements[0]?.id).toBeUndefined();
    // Les clés React sont conservées : aucun remontage à l'annulation.
    expect(rebound.key).toBe(source.key);
    expect(rebound.elements[0]?.key).toBe("key-el");
    // La source reste intacte.
    expect(source.id).toBe("slide-1");
    expect(source.elements[0]?.id).toBe("el-1");
  });

  it("nomme une diapositive par son titre, ou par son rang", () => {
    expect(slideTitle(editorSlide({ title: "Chiffres" }), 2)).toBe("Chiffres");
    expect(slideTitle(editorSlide({ title: "   " }), 2)).toBe("Diapositive 3");
    expect(slideTitle(editorSlide({ title: "" }), 0)).toBe("Diapositive 1");
  });

  it("arrondit et borne les valeurs manipulées à la souris", () => {
    expect(round1(10.04)).toBe(10);
    expect(round1(10.06)).toBe(10.1);
    expect(clamp(5, 0, 100)).toBe(5);
    expect(clamp(-5, 0, 100)).toBe(0);
    expect(clamp(500, 0, 100)).toBe(100);
  });
});
