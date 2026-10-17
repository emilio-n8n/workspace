import { describe, expect, it } from "vitest";
import { cn } from "../src/cn.ts";
import { pluralizeFr } from "../src/lib/french-text.ts";
import { startsWithQuery } from "../src/lib/text-match.ts";
import {
  isAppAvailable,
  resolveSuiteApps,
  SUITE_APPS,
  shippedApps,
} from "../src/shell/suite-apps.ts";

describe("cn", () => {
  it("résout les conflits Tailwind au profit de la dernière classe", () => {
    expect(cn("px-3 py-1", "px-4")).toBe("py-1 px-4");
    expect(cn("a", false, null, undefined, "b")).toBe("a b");
  });
});

describe("pluralizeFr", () => {
  it("accorde au pluriel à partir de 2 (0 et 1 au singulier)", () => {
    expect(pluralizeFr(0, "message")).toBe("0 message");
    expect(pluralizeFr(1, "message")).toBe("1 message");
    expect(pluralizeFr(2, "message")).toBe("2 messages");
    expect(pluralizeFr(3, "travail", "travaux")).toBe("3 travaux");
  });
});

describe("startsWithQuery", () => {
  it("ignore la casse et les accents", () => {
    expect(startsWithQuery("Éteint", "ete")).toBe(true);
    expect(startsWithQuery("Allumé", "ete")).toBe(false);
  });
});

describe("applications de la suite par type d'espace", () => {
  const urls = Object.fromEntries(SUITE_APPS.map((app) => [app.id, `https://${app.id}.x`]));
  const ids = (kind?: "personal" | "business" | "education") =>
    resolveSuiteApps(urls, kind).map((app) => app.id);

  it("sans type connu, toute la suite reste visible (anciens espaces)", () => {
    expect(ids()).toEqual(SUITE_APPS.map((app) => app.id));
  });

  it("espace personnel : Classroom (élève qui rejoint un cours), ni Sites ni Admin", () => {
    const personal = ids("personal");
    expect(personal).toContain("classroom");
    expect(personal).not.toContain("sites");
    expect(personal).not.toContain("admin");
    expect(personal).toContain("docs");
  });

  it("entreprise : Admin et Sites mais pas Classroom ; éducation : tout", () => {
    expect(ids("business")).toEqual(expect.arrayContaining(["admin", "sites"]));
    expect(ids("business")).not.toContain("classroom");
    expect(ids("education")).toEqual(expect.arrayContaining(["admin", "sites", "classroom"]));
  });

  it("isAppAvailable suit les mêmes règles que le rail", () => {
    expect(isAppAvailable("classroom", "personal")).toBe(true);
    expect(isAppAvailable("classroom", "business")).toBe(false);
    expect(isAppAvailable("sites", "personal")).toBe(false);
    expect(isAppAvailable("classroom", "education")).toBe(true);
    expect(isAppAvailable("docs", "personal")).toBe(true);
    expect(isAppAvailable("admin", undefined)).toBe(true);
  });

  it("shippedApps écarte les applications sans URL", () => {
    const apps = resolveSuiteApps({ docs: "https://docs.x" });
    expect(shippedApps(apps).map((app) => app.id)).toEqual(["docs"]);
  });
});
