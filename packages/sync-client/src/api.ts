import { createWriteStream, openAsBlob } from "node:fs";
import { mkdir, rename, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import type { RemoteEntry } from "./types.ts";

export class SyncApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "SyncApiError";
  }
}

export type SyncIdentity = {
  userId: string;
  organizationId: string;
  scopes: string[];
};

type EntryResponse = { entry: RemoteEntry };
type TreeResponse = { entries: RemoteEntry[] };

/**
 * Client HTTP minimal du serveur de synchronisation.
 * Le jeton est porté par `Authorization: Bearer` ; aucune session navigateur.
 */
export class SyncApi {
  private readonly baseUrl: string;

  constructor(
    serverUrl: string,
    private readonly token: string,
  ) {
    this.baseUrl = serverUrl.replace(/\/+$/, "");
  }

  private async request(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set("authorization", `Bearer ${this.token}`);

    const response = await fetch(`${this.baseUrl}${path}`, { ...init, headers });
    if (!response.ok) {
      let code = "http_error";
      let message = `HTTP ${response.status}`;
      try {
        const body = (await response.json()) as { error?: string; message?: string };
        code = body.error ?? code;
        message = body.message ?? message;
      } catch {
        // Réponse non JSON : on garde le message HTTP générique.
      }
      throw new SyncApiError(response.status, code, message);
    }
    return response;
  }

  async me(): Promise<SyncIdentity> {
    const response = await this.request("/api/drive/sync/me");
    return (await response.json()) as SyncIdentity;
  }

  async tree(): Promise<RemoteEntry[]> {
    const response = await this.request("/api/drive/sync/tree");
    const body = (await response.json()) as TreeResponse;
    return body.entries;
  }

  async ensureFolder(parentId: string | null, name: string): Promise<RemoteEntry> {
    const response = await this.request("/api/drive/sync/folder", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ parentId, name }),
    });
    return ((await response.json()) as EntryResponse).entry;
  }

  async upload(input: {
    filePath: string;
    name: string;
    parentId: string | null;
    entryId?: string;
    contentType?: string;
  }): Promise<RemoteEntry> {
    const blob = await openAsBlob(input.filePath);
    const form = new FormData();
    form.set("file", blob, input.name);
    form.set("name", input.name);
    if (input.parentId) form.set("parentId", input.parentId);
    if (input.entryId) form.set("entryId", input.entryId);
    if (input.contentType) form.set("contentType", input.contentType);

    const response = await this.request("/api/drive/sync/upload", {
      method: "POST",
      body: form,
    });
    return ((await response.json()) as EntryResponse).entry;
  }

  async download(entryId: string, destination: string): Promise<void> {
    const response = await this.request(`/api/drive/sync/download/${encodeURIComponent(entryId)}`);
    if (!response.body) throw new Error("Réponse de téléchargement vide.");

    await mkdir(dirname(destination), { recursive: true });
    const temp = `${destination}.part-${process.pid}`;
    try {
      await pipeline(
        Readable.fromWeb(response.body as unknown as NodeReadableStream<Uint8Array>),
        createWriteStream(temp),
      );
      await rename(temp, destination);
    } catch (error) {
      await unlink(temp).catch(() => undefined);
      throw error;
    }
  }

  async op(
    body:
      | { action: "move"; entryId: string; parentId: string | null }
      | { action: "rename"; entryId: string; name: string }
      | { action: "trash"; entryId: string },
  ): Promise<void> {
    await this.request("/api/drive/sync/op", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }
}
