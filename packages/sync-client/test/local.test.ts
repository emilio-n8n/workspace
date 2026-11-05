import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checksumFile, conflictPath, isIgnored, mimeTypeFor, walkLocal } from "../src/local.ts";

const tempDirs: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "workspace-sync-test-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("isIgnored", () => {
  it("ignore un dossier par son nom, à n'importe quel niveau", () => {
    expect(isIgnored("node_modules", ["node_modules"])).toBe(true);
    expect(isIgnored("packages/app/node_modules/lib", ["node_modules"])).toBe(true);
    expect(isIgnored("src/index.ts", ["node_modules"])).toBe(false);
  });

  it("ignore les fichiers par glob", () => {
    expect(isIgnored("a.tmp", ["*.tmp"])).toBe(true);
    expect(isIgnored("sub/a.tmp", ["*.tmp"])).toBe(true);
    expect(isIgnored("sub/a.txt", ["*.tmp"])).toBe(false);
  });

  it("ignore toujours le dossier d'état", () => {
    expect(isIgnored(".workspace-sync/state.json", [])).toBe(true);
    expect(isIgnored("sub/.workspace-sync/state.json", [])).toBe(true);
  });

  it("gère un motif avec chemin", () => {
    expect(isIgnored("build/cache/a.bin", ["build/cache"])).toBe(true);
    expect(isIgnored("build/other/a.bin", ["build/cache"])).toBe(false);
  });
});

describe("conflictPath", () => {
  it("ajoute un suffixe lisible sans casser l'extension", () => {
    const result = conflictPath(
      "docs/rapport.pdf",
      "laptop-emilio",
      new Date("2026-01-02T03:04:05Z"),
    );
    expect(result).toBe("docs/rapport.conflict-laptop-emilio-20260102T030405.pdf");
  });
});

describe("mimeTypeFor", () => {
  it("reconnaît les extensions courantes", () => {
    expect(mimeTypeFor("a.md")).toBe("text/markdown");
    expect(mimeTypeFor("a.pdf")).toBe("application/pdf");
    expect(mimeTypeFor("a.unknown")).toBe("application/octet-stream");
  });
});

describe("walkLocal", () => {
  it("parcourt les fichiers et dossiers en ignorant les motifs", async () => {
    const root = await tempDir();
    await writeFile(join(root, "a.txt"), "a");
    await mkdir(join(root, "sub"));
    await writeFile(join(root, "sub", "b.txt"), "b");
    await mkdir(join(root, "node_modules"));
    await writeFile(join(root, "node_modules", "c.js"), "c");

    const entries = await walkLocal(root, ["node_modules"]);

    expect([...entries.keys()].sort()).toEqual(["a.txt", "sub", "sub/b.txt"]);
    expect(entries.get("a.txt")?.kind).toBe("file");
    expect(entries.get("sub")?.kind).toBe("folder");
  });

  it("calcule une empreinte SHA-256 stable", async () => {
    const root = await tempDir();
    const file = join(root, "a.txt");
    await writeFile(file, "bonjour");
    expect(await checksumFile(file)).toBe(
      "2cb4b1431b84ec15d35ed83bb927e27e8967d75f4bcd9cc4b25c8d879ae23e18",
    );
  });
});
