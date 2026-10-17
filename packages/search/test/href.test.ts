import { describe, expect, it } from "vitest";
import { searchResultHref } from "../src/href.ts";

const urls = {
  drive: "https://drive.x",
  docs: "https://docs.x",
  sheets: "https://sheets.x",
  slides: "https://slides.x",
  forms: "https://forms.x",
  tasks: "https://tasks.x",
  calendar: "https://calendar.x",
  sites: "https://sites.x",
};

describe("searchResultHref", () => {
  it("ouvre les documents, feuilles et présentations dans leur éditeur", () => {
    const file = (mimeType: string) =>
      searchResultHref({ kind: "file", id: "f1", appId: "drive", mimeType }, urls);
    expect(file("application/vnd.workspace.docs+json")).toBe("https://docs.x/doc/f1");
    expect(file("application/vnd.workspace.sheets+json")).toBe("https://sheets.x/sheet/f1");
    expect(file("application/vnd.workspace.slides+json")).toBe("https://slides.x/slide/f1");
    expect(file("application/vnd.workspace.forms+json")).toBe("https://forms.x/form/f1");
  });

  it("ouvre un dossier dans Drive et un fichier binaire à la racine de Drive", () => {
    expect(searchResultHref({ kind: "file", id: "d1", appId: "drive", isFolder: true }, urls)).toBe(
      "https://drive.x/d1",
    );
    expect(
      searchResultHref(
        { kind: "file", id: "p", appId: "drive", mimeType: "application/pdf" },
        urls,
      ),
    ).toBe("https://drive.x/");
  });

  it("route les tâches, événements et formulaires vers leur application", () => {
    expect(searchResultHref({ kind: "task", id: "t", appId: "tasks" }, urls)).toBe(
      "https://tasks.x/",
    );
    expect(searchResultHref({ kind: "event", id: "e", appId: "calendar" }, urls)).toBe(
      "https://calendar.x/",
    );
    expect(searchResultHref({ kind: "form", id: "a b", appId: "forms" }, urls)).toBe(
      "https://forms.x/form/a%20b",
    );
  });
});
