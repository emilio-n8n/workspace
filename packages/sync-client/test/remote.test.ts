import { describe, expect, it } from "vitest";
import { baseName, buildRemoteTree, parentPath } from "../src/remote.ts";
import type { RemoteEntry } from "../src/types.ts";

const entries: RemoteEntry[] = [
  {
    id: "projects",
    parentId: null,
    kind: "folder",
    name: "Projects",
    mimeType: null,
    sizeBytes: null,
    checksum: null,
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "docs",
    parentId: "projects",
    kind: "folder",
    name: "Docs",
    mimeType: null,
    sizeBytes: null,
    checksum: null,
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "file",
    parentId: "docs",
    kind: "file",
    name: "a.txt",
    mimeType: "text/plain",
    sizeBytes: 1,
    checksum: "aaa",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "root-file",
    parentId: null,
    kind: "file",
    name: "root.txt",
    mimeType: "text/plain",
    sizeBytes: 1,
    checksum: "bbb",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
];

describe("buildRemoteTree", () => {
  it("reconstruit les chemins depuis la racine", () => {
    const tree = buildRemoteTree(entries, "/");
    expect([...tree.entries.keys()].sort()).toEqual([
      "Projects",
      "Projects/Docs",
      "Projects/Docs/a.txt",
      "root.txt",
    ]);
    expect(tree.rootId).toBeNull();
    expect(tree.rootFound).toBe(true);
  });

  it("filtre un sous-arbre et retourne son identifiant", () => {
    const tree = buildRemoteTree(entries, "/Projects");
    expect(tree.rootId).toBe("projects");
    expect([...tree.entries.keys()].sort()).toEqual(["Docs", "Docs/a.txt"]);
  });

  it("signale un dossier racine absent", () => {
    const tree = buildRemoteTree(entries, "/Inconnu");
    expect(tree.rootFound).toBe(false);
    expect(tree.entries.size).toBe(0);
  });
});

describe("chemins", () => {
  it("calcule le parent et le nom de base", () => {
    expect(parentPath("a/b/c.txt")).toBe("a/b");
    expect(parentPath("a.txt")).toBe("");
    expect(baseName("a/b/c.txt")).toBe("c.txt");
    expect(baseName("a.txt")).toBe("a.txt");
  });
});
