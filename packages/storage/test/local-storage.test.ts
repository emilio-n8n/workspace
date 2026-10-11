import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { getServerEnv } from "@workspace/config";
import { afterAll, describe, expect, it } from "vitest";
import { assertValidKey, getStorage, LocalFsStorage, orgKey } from "../src/index";
import { InvalidStorageKeyError } from "../src/keys";

const storage = new LocalFsStorage("./storage-test-fixture");
const root = path.resolve(process.cwd(), "./storage-test-fixture");

afterAll(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("storage — LocalFS", () => {
  it("écrit, relit, donne la taille, puis supprime", async () => {
    const key = orgKey("org_1", "file_1", "rapport-annuel.pdf");
    expect(existsSync(path.resolve(root, key))).toBe(false);

    await storage.put({ key, body: Buffer.from("contenu-de-test"), contentType: "text/plain" });

    expect(await storage.get(key)).toEqual(Buffer.from("contenu-de-test"));
    const stat = await storage.stat(key);
    expect(stat?.size).toBe(15);

    await storage.delete(key);
    expect(await storage.get(key)).toBeNull();
    expect(await storage.stat(key)).toBeNull();
  });

  it("suppression idempotente (objet absent)", async () => {
    await expect(storage.delete("orgs/inconnu/absent")).resolves.toBeUndefined();
  });

  it("écrase le contenu existant", async () => {
    const key = orgKey("org_1", "file_overwrite");
    await storage.put({ key, body: Buffer.from("v1") });
    await storage.put({ key, body: Buffer.from("v2-plus-long") });
    const content = await storage.get(key);
    expect(content?.toString()).toBe("v2-plus-long");
    await storage.delete(key);
  });

  it("getStream renvoie un flux lisible", async () => {
    const key = orgKey("org_1", "file_stream", "data.bin");
    await storage.put({ key, body: Buffer.from("flux-de-donnees") });

    const stream = await storage.getStream(key);
    expect(stream).not.toBeNull();
    if (!stream) throw new Error("flux manquant");
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    expect(Buffer.concat(chunks).toString()).toBe("flux-de-donnees");
    await storage.delete(key);
  });

  it("rejette les clés invalides (traversal, absolu, doublon, espace)", async () => {
    for (const bad of [
      "../secret",
      "orgs/../../etc/passwd",
      "/absolu",
      "orgs//double",
      "a/./b",
      "a b",
      "",
    ]) {
      expect(() => assertValidKey(bad)).toThrow(InvalidStorageKeyError);
    }
    await expect(storage.put({ key: "../evil", body: Buffer.from("x") })).rejects.toThrow(
      InvalidStorageKeyError,
    );
  });

  it("orgKey assainit les composants", () => {
    expect(orgKey("org_1", "file_1", "Mon Rapport (v2).pdf")).toBe(
      "orgs/org_1/file_1/Mon-Rapport-v2.pdf",
    );
    expect(orgKey("org_1", "file_2")).toBe("orgs/org_1/file_2");
  });
});

describe("storage — fabrique", () => {
  it("getStorage() renvoie l'adaptateur local par défaut", () => {
    const env = getServerEnv();
    const adapter = getStorage();
    expect(adapter.driver).toBe(env.STORAGE_DRIVER);
  });
});
