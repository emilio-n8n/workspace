import { describe, expect, it } from "vitest";
import { planSync } from "../src/plan.ts";
import type { LocalEntry, RemoteEntry, SyncState } from "../src/types.ts";

function localFile(path: string, checksum: string): LocalEntry {
  return {
    path,
    kind: "file",
    absolutePath: `/tmp/${path}`,
    size: 1,
    mtimeMs: 1,
    checksum,
  };
}

function localFolder(path: string): LocalEntry {
  return { path, kind: "folder", absolutePath: `/tmp/${path}`, size: 0, mtimeMs: 1 };
}

function remoteFile(path: string, checksum: string): RemoteEntry {
  return {
    id: `id-${path}`,
    parentId: null,
    kind: "file",
    name: path.split("/").at(-1) ?? path,
    mimeType: "text/plain",
    sizeBytes: 1,
    checksum,
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function remoteFolder(path: string): RemoteEntry {
  return {
    id: `id-${path}`,
    parentId: null,
    kind: "folder",
    name: path.split("/").at(-1) ?? path,
    mimeType: null,
    sizeBytes: null,
    checksum: null,
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function stateWith(
  path: string,
  checksum: string,
  remoteChecksum: string | null = checksum,
): SyncState {
  return {
    version: 1,
    deviceName: "test",
    lastSyncAt: null,
    entries: {
      [path]: {
        remoteId: `id-${path}`,
        kind: "file",
        checksum,
        remoteChecksum,
        lastSyncedAt: "2026-01-01T00:00:00.000Z",
      },
    },
  };
}

function emptyState(): SyncState {
  return { version: 1, deviceName: "test", lastSyncAt: null, entries: {} };
}

describe("planSync — two-way", () => {
  it("envoie un nouveau fichier local", () => {
    const plan = planSync({
      local: new Map([["a.txt", localFile("a.txt", "aaa")]]),
      remote: new Map(),
      state: emptyState(),
      mode: "two-way",
      mirrorDeletes: false,
    });
    expect(plan.actions).toContainEqual(
      expect.objectContaining({ type: "upload", path: "a.txt", reason: "new" }),
    );
  });

  it("télécharge un nouveau fichier distant", () => {
    const plan = planSync({
      local: new Map(),
      remote: new Map([["b.txt", remoteFile("b.txt", "bbb")]]),
      state: emptyState(),
      mode: "two-way",
      mirrorDeletes: false,
    });
    expect(plan.actions).toContainEqual(
      expect.objectContaining({ type: "download", path: "b.txt" }),
    );
  });

  it("ne fait rien quand les deux côtés sont identiques", () => {
    const plan = planSync({
      local: new Map([["a.txt", localFile("a.txt", "aaa")]]),
      remote: new Map([["a.txt", remoteFile("a.txt", "aaa")]]),
      state: stateWith("a.txt", "aaa"),
      mode: "two-way",
      mirrorDeletes: false,
    });
    expect(plan.actions).toHaveLength(0);
  });

  it("envoie un fichier modifié localement", () => {
    const plan = planSync({
      local: new Map([["a.txt", localFile("a.txt", "new")]]),
      remote: new Map([["a.txt", remoteFile("a.txt", "old")]]),
      state: stateWith("a.txt", "old"),
      mode: "two-way",
      mirrorDeletes: false,
    });
    expect(plan.actions).toContainEqual(
      expect.objectContaining({ type: "upload", path: "a.txt", reason: "local-changed" }),
    );
  });

  it("télécharge un fichier modifié à distance", () => {
    const plan = planSync({
      local: new Map([["a.txt", localFile("a.txt", "old")]]),
      remote: new Map([["a.txt", remoteFile("a.txt", "new")]]),
      state: stateWith("a.txt", "old"),
      mode: "two-way",
      mirrorDeletes: false,
    });
    expect(plan.actions).toContainEqual(
      expect.objectContaining({ type: "download", path: "a.txt" }),
    );
  });

  it("crée une copie de conflit quand les deux côtés ont changé", () => {
    const plan = planSync({
      local: new Map([["a.txt", localFile("a.txt", "local")]]),
      remote: new Map([["a.txt", remoteFile("a.txt", "remote")]]),
      state: stateWith("a.txt", "base"),
      mode: "two-way",
      mirrorDeletes: false,
    });
    expect(plan.actions).toContainEqual(
      expect.objectContaining({ type: "conflict", path: "a.txt", resolution: "both" }),
    );
  });

  it("propage une suppression locale quand le distant n'a pas changé", () => {
    const plan = planSync({
      local: new Map(),
      remote: new Map([["a.txt", remoteFile("a.txt", "aaa")]]),
      state: stateWith("a.txt", "aaa", "aaa"),
      mode: "two-way",
      mirrorDeletes: false,
    });
    expect(plan.actions).toContainEqual(
      expect.objectContaining({ type: "trash-remote", path: "a.txt", reason: "local-deleted" }),
    );
  });

  it("propage une suppression distante quand le local n'a pas changé", () => {
    const plan = planSync({
      local: new Map([["a.txt", localFile("a.txt", "aaa")]]),
      remote: new Map(),
      state: stateWith("a.txt", "aaa", "aaa"),
      mode: "two-way",
      mirrorDeletes: false,
    });
    expect(plan.actions).toContainEqual(
      expect.objectContaining({ type: "trash-local", path: "a.txt", reason: "remote-deleted" }),
    );
  });

  it("recrée un fichier local modifié après suppression distante", () => {
    const plan = planSync({
      local: new Map([["a.txt", localFile("a.txt", "changed")]]),
      remote: new Map(),
      state: stateWith("a.txt", "old", "old"),
      mode: "two-way",
      mirrorDeletes: false,
    });
    expect(plan.actions).toContainEqual(
      expect.objectContaining({ type: "upload", path: "a.txt", reason: "recreate" }),
    );
  });

  it("crée les dossiers des deux côtés", () => {
    const plan = planSync({
      local: new Map([["Local", localFolder("Local")]]),
      remote: new Map([["Remote", remoteFolder("Remote")]]),
      state: emptyState(),
      mode: "two-way",
      mirrorDeletes: false,
    });
    expect(plan.actions).toContainEqual(
      expect.objectContaining({ type: "mkdir-remote", path: "Local" }),
    );
    expect(plan.actions).toContainEqual(
      expect.objectContaining({ type: "mkdir-local", path: "Remote" }),
    );
  });

  it("oublie l'état des chemins disparus des deux côtés", () => {
    const plan = planSync({
      local: new Map(),
      remote: new Map(),
      state: stateWith("gone.txt", "aaa"),
      mode: "two-way",
      mirrorDeletes: false,
    });
    expect(plan.prune).toEqual(["gone.txt"]);
    expect(plan.actions).toHaveLength(0);
  });
});

describe("planSync — one-way", () => {
  it("mode upload : ignore un fichier uniquement distant", () => {
    const plan = planSync({
      local: new Map(),
      remote: new Map([["remote.txt", remoteFile("remote.txt", "bbb")]]),
      state: emptyState(),
      mode: "upload",
      mirrorDeletes: false,
    });
    expect(plan.actions).toContainEqual(
      expect.objectContaining({ type: "skip", path: "remote.txt" }),
    );
  });

  it("mode download : ignore un fichier uniquement local", () => {
    const plan = planSync({
      local: new Map([["local.txt", localFile("local.txt", "aaa")]]),
      remote: new Map(),
      state: emptyState(),
      mode: "download",
      mirrorDeletes: false,
    });
    expect(plan.actions).toContainEqual(
      expect.objectContaining({ type: "skip", path: "local.txt" }),
    );
  });

  it("mode upload : le local gagne en cas de conflit", () => {
    const plan = planSync({
      local: new Map([["a.txt", localFile("a.txt", "local")]]),
      remote: new Map([["a.txt", remoteFile("a.txt", "remote")]]),
      state: stateWith("a.txt", "base"),
      mode: "upload",
      mirrorDeletes: false,
    });
    expect(plan.actions).toContainEqual(
      expect.objectContaining({ type: "upload", path: "a.txt", reason: "local-changed" }),
    );
  });

  it("mode download : le distant gagne en cas de conflit", () => {
    const plan = planSync({
      local: new Map([["a.txt", localFile("a.txt", "local")]]),
      remote: new Map([["a.txt", remoteFile("a.txt", "remote")]]),
      state: stateWith("a.txt", "base"),
      mode: "download",
      mirrorDeletes: false,
    });
    expect(plan.actions).toContainEqual(
      expect.objectContaining({ type: "conflict", path: "a.txt", resolution: "remote-wins" }),
    );
  });

  it("mode download + mirrorDeletes : supprime le local quand le distant a disparu", () => {
    const plan = planSync({
      local: new Map([["a.txt", localFile("a.txt", "aaa")]]),
      remote: new Map(),
      state: stateWith("a.txt", "aaa", "aaa"),
      mode: "download",
      mirrorDeletes: true,
    });
    expect(plan.actions).toContainEqual(
      expect.objectContaining({ type: "trash-local", path: "a.txt" }),
    );
  });

  it("mode upload + mirrorDeletes : supprime le distant quand le local a disparu", () => {
    const plan = planSync({
      local: new Map(),
      remote: new Map([["a.txt", remoteFile("a.txt", "aaa")]]),
      state: stateWith("a.txt", "aaa", "aaa"),
      mode: "upload",
      mirrorDeletes: true,
    });
    expect(plan.actions).toContainEqual(
      expect.objectContaining({ type: "trash-remote", path: "a.txt" }),
    );
  });
});
