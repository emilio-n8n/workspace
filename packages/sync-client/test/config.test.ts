import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  loadConfig,
  normalizeConfig,
  normalizeRemotePath,
  resolveToken,
  saveConfig,
} from "../src/config.ts";

const tempDirs: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "workspace-sync-config-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("normalizeRemotePath", () => {
  it("normalise les chemins distants", () => {
    expect(normalizeRemotePath("/")).toBe("/");
    expect(normalizeRemotePath("")).toBe("/");
    expect(normalizeRemotePath("Projects")).toBe("/Projects");
    expect(normalizeRemotePath("/Projects/Docs/")).toBe("/Projects/Docs");
  });
});

describe("normalizeConfig", () => {
  it("applique les valeurs par défaut et résout le chemin local", () => {
    const config = normalizeConfig(
      {
        serverUrl: "https://drive.example.org/",
        folders: [{ localPath: "./Workspace" }],
      },
      "/tmp/base",
    );

    expect(config.serverUrl).toBe("https://drive.example.org");
    expect(config.intervalSeconds).toBe(30);
    expect(config.folders[0]?.localPath).toBe("/tmp/base/Workspace");
    expect(config.folders[0]?.remotePath).toBe("/");
    expect(config.folders[0]?.mode).toBe("two-way");
    expect(config.folders[0]?.mirrorDeletes).toBe(false);
  });

  it("refuse une configuration sans dossier", () => {
    expect(() =>
      normalizeConfig({ serverUrl: "https://drive.example.org", folders: [] }),
    ).toThrow();
  });

  it("refuse un mode inconnu", () => {
    expect(() =>
      normalizeConfig({
        serverUrl: "https://drive.example.org",
        folders: [{ localPath: "/tmp/x", mode: "mirror" }],
      }),
    ).toThrow();
  });
});

describe("resolveToken", () => {
  it("préfère la variable d'environnement au jeton du fichier", () => {
    const previous = process.env.WORKSPACE_SYNC_TOKEN;
    process.env.WORKSPACE_SYNC_TOKEN = "wsk_env";
    try {
      const config = normalizeConfig({
        serverUrl: "https://drive.example.org",
        token: "wsk_file",
        folders: [{ localPath: "/tmp/x" }],
      });
      expect(resolveToken(config)).toBe("wsk_env");
    } finally {
      if (previous === undefined) delete process.env.WORKSPACE_SYNC_TOKEN;
      else process.env.WORKSPACE_SYNC_TOKEN = previous;
    }
  });

  it("refuse l'absence de jeton", () => {
    const previous = process.env.WORKSPACE_SYNC_TOKEN;
    delete process.env.WORKSPACE_SYNC_TOKEN;
    try {
      const config = normalizeConfig({
        serverUrl: "https://drive.example.org",
        folders: [{ localPath: "/tmp/x" }],
      });
      expect(() => resolveToken(config)).toThrow(/Jeton manquant/);
    } finally {
      if (previous !== undefined) process.env.WORKSPACE_SYNC_TOKEN = previous;
    }
  });
});

describe("saveConfig / loadConfig", () => {
  it("écrit la configuration en 0600 et la relit", async () => {
    const dir = await tempDir();
    const path = join(dir, "config.json");
    const config = normalizeConfig(
      {
        serverUrl: "https://drive.example.org",
        token: "wsk_secret",
        deviceName: "portable",
        folders: [{ localPath: "./data", mode: "upload", ignore: ["*.tmp"] }],
      },
      dir,
    );

    saveConfig(config, path);
    const mode = (await stat(path)).mode & 0o777;
    expect(mode).toBe(0o600);

    const loaded = loadConfig(path);
    expect(loaded.serverUrl).toBe("https://drive.example.org");
    expect(loaded.deviceName).toBe("portable");
    expect(loaded.folders[0]?.localPath).toBe(join(dir, "data"));
    expect(loaded.folders[0]?.mode).toBe("upload");
    expect(loaded.folders[0]?.ignore).toEqual(["*.tmp"]);
  });
});
