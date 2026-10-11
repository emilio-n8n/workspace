import { randomUUID } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { issueApiToken, type WorkspaceScope } from "@workspace/auth";
import { closeDb, getDb, schema } from "@workspace/database";
import { createDocument, saveDocument } from "@workspace/docs";
import { uploadFile } from "@workspace/drive";
import { createList as createTaskList } from "@workspace/tasks";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, describe, expect, it } from "vitest";

const { user, organization, member, apiTokens, auditEvents } = schema;

let counter = 0;
const tag = (prefix: string) => `${prefix}${++counter}_${randomUUID().slice(0, 8)}`;

type Fixtures = { orgId: string; userId: string; token: string };

async function createFixtures(scopes: string[]): Promise<Fixtures> {
  const db = getDb();
  const now = new Date();
  const orgId = tag("org");
  const userId = tag("usr");

  await db
    .insert(organization)
    .values({ id: orgId, name: tag("Org "), slug: orgId, createdAt: now });
  await db.insert(user).values({
    id: userId,
    name: "Agent MCP",
    email: `${userId}@example.org`,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  });
  // Tout jeton appartient à un membre : propriétaire de son organisation
  // (le garde-fou admin d'audit.recent l'exige, comme l'écran Admin).
  await db.insert(member).values({
    id: randomUUID(),
    organizationId: orgId,
    userId,
    role: "owner",
    createdAt: now,
  });

  const issued = await issueApiToken({
    userId,
    orgId,
    name: "Smoke MCP",
    scopes: scopes as WorkspaceScope[],
  });

  return { orgId, userId, token: issued.token };
}

async function cleanup(f: Fixtures): Promise<void> {
  const db = getDb();
  await db.delete(auditEvents).where(eq(auditEvents.orgId, f.orgId));
  await db.delete(apiTokens).where(eq(apiTokens.userId, f.userId));
  // La suppression de l'organisation cascade sur Drive et Docs.
  await db.delete(organization).where(eq(organization.id, f.orgId));
  await db.delete(user).where(eq(user.id, f.userId));
}

/** Démarre le vrai serveur MCP (stdio) et retourne un client connecté. */
async function connectClient(
  token: string,
): Promise<{ client: Client; transport: StdioClientTransport }> {
  const transport = new StdioClientTransport({
    command: "npx",
    args: ["tsx", "src/main.ts"],
    cwd: new URL("..", import.meta.url).pathname,
    env: {
      ...Object.fromEntries(
        Object.entries(process.env).filter(
          (entry): entry is [string, string] => typeof entry[1] === "string",
        ),
      ),
      WORKSPACE_TOKEN: token,
    },
    stderr: "pipe",
  });
  const client = new Client({ name: "workspace-tests", version: "0.0.0" });
  await client.connect(transport);
  return { client, transport };
}

function payloadOf(result: unknown): Record<string, unknown> {
  const content = (result as { content: { type: string; text: string }[] }).content;
  const first = content[0];
  if (!first) throw new Error("Réponse MCP sans contenu.");
  return JSON.parse(first.text) as Record<string, unknown>;
}

const fixturesStack: Fixtures[] = [];

async function fixtures(scopes: string[]): Promise<Fixtures> {
  const f = await createFixtures(scopes);
  fixturesStack.push(f);
  return f;
}

afterEach(async () => {
  while (fixturesStack.length > 0) {
    const f = fixturesStack.pop();
    if (f) await cleanup(f);
  }
});

afterAll(async () => {
  await closeDb();
});

describe("serveur MCP — intégration réelle (stdio)", () => {
  it("liste les vingt outils de la suite et répond à me.whoami avec le bon principal", async () => {
    const f = await fixtures(["drive:read"]);
    const { client, transport } = await connectClient(f.token);
    try {
      const tools = await client.listTools();
      const names = tools.tools.map((tool) => tool.name).sort();
      expect(names).toEqual([
        "audit.recent",
        "calendar.create",
        "calendar.list",
        "chat.list",
        "chat.send",
        "classroom.list",
        "docs.read",
        "files.read",
        "files.search",
        "forms.list",
        "forms.responses",
        "mail.list",
        "mail.send",
        "me.whoami",
        "sheets.read",
        "sites.read",
        "slides.read",
        "tasks.create",
        "tasks.list",
        "tasks.lists",
      ]);

      const whoami = await client.callTool({ name: "me.whoami", arguments: {} });
      expect(whoami.isError).toBeFalsy();
      const payload = payloadOf(whoami);
      expect(payload.organizationId).toBe(f.orgId);
      expect(payload.scopes).toEqual(["drive:read"]);
      expect((payload.user as { email: string }).email).toBe(`${f.userId}@example.org`);
    } finally {
      await client.close();
      await transport.close();
    }
  });

  it("refuse audit.recent sans scope et journalise le refus", async () => {
    const f = await fixtures(["drive:read"]);
    const { client, transport } = await connectClient(f.token);
    try {
      const result = await client.callTool({ name: "audit.recent", arguments: {} });
      expect(result.isError).toBe(true);

      const db = getDb();
      const events = await db.select().from(auditEvents).where(eq(auditEvents.orgId, f.orgId));
      const denied = events.find((event) => event.action === "mcp.audit.recent");
      expect(denied?.result).toBe("denied");
    } finally {
      await client.close();
      await transport.close();
    }
  });

  it("autorise audit.recent avec scope et journalise le succès", async () => {
    const f = await fixtures(["audit:read"]);
    const { client, transport } = await connectClient(f.token);
    try {
      const result = await client.callTool({ name: "audit.recent", arguments: { limit: 5 } });
      expect(result.isError).toBeFalsy();

      const db = getDb();
      const events = await db.select().from(auditEvents).where(eq(auditEvents.orgId, f.orgId));
      expect(
        events.some((event) => event.action === "mcp.audit.recent" && event.result === "success"),
      ).toBe(true);
    } finally {
      await client.close();
      await transport.close();
    }
  });

  it("files.search + files.read : cherche et lit un fichier texte autorisé", async () => {
    const f = await fixtures(["drive:read"]);
    const actor = { userId: f.userId, orgId: f.orgId };

    const { entry } = await uploadFile(actor, {
      name: "notes-mcp.txt",
      contentType: "text/plain",
      body: Buffer.from("Ligne un\nLigne deux", "utf8"),
    });

    const { client, transport } = await connectClient(f.token);
    try {
      const search = await client.callTool({
        name: "files.search",
        arguments: { query: "notes-mcp" },
      });
      expect(search.isError).toBeFalsy();
      const results = payloadOf(search) as unknown as { id: string; name: string }[];
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]?.name).toBe("notes-mcp.txt");

      const read = await client.callTool({
        name: "files.read",
        arguments: { fileId: entry.id },
      });
      expect(read.isError).toBeFalsy();
      const payload = payloadOf(read);
      expect(payload.text).toContain("Ligne deux");
      expect(payload.truncated).toBe(false);
    } finally {
      await client.close();
      await transport.close();
    }
  });

  it("files.read refuse un jeton sans scope drive:read", async () => {
    const f = await fixtures(["docs:read"]);
    const actor = { userId: f.userId, orgId: f.orgId };

    const { entry } = await uploadFile(actor, {
      name: "prive.txt",
      contentType: "text/plain",
      body: Buffer.from("secret", "utf8"),
    });

    const { client, transport } = await connectClient(f.token);
    try {
      const read = await client.callTool({
        name: "files.read",
        arguments: { fileId: entry.id },
      });
      expect(read.isError).toBe(true);
    } finally {
      await client.close();
      await transport.close();
    }
  });

  it("isolation : un jeton d'une autre organisation ne voit aucun fichier", async () => {
    const owner = await fixtures(["drive:read"]);
    const stranger = await fixtures(["drive:read"]);

    const { entry } = await uploadFile(
      { userId: owner.userId, orgId: owner.orgId },
      { name: "confidentiel.txt", contentType: "text/plain", body: Buffer.from("top", "utf8") },
    );

    const { client, transport } = await connectClient(stranger.token);
    try {
      const search = await client.callTool({
        name: "files.search",
        arguments: { query: "confidentiel" },
      });
      expect(search.isError).toBeFalsy();
      expect(payloadOf(search) as unknown as unknown[]).toHaveLength(0);

      const read = await client.callTool({
        name: "files.read",
        arguments: { fileId: entry.id },
      });
      expect(read.isError).toBe(true);
    } finally {
      await client.close();
      await transport.close();
    }
  });

  it("docs.read : lit le texte d'un document autorisé, refuse sans scope", async () => {
    const f = await fixtures(["docs:read"]);
    const actor = { userId: f.userId, orgId: f.orgId };

    const { entry } = await createDocument(actor, { title: "Brief MCP" });
    await saveDocument(actor, entry.id, {
      content: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "Bonjour le monde" }],
          },
        ],
      },
      mode: "append",
    });

    const { client, transport } = await connectClient(f.token);
    try {
      const read = await client.callTool({
        name: "docs.read",
        arguments: { fileId: entry.id },
      });
      expect(read.isError).toBeFalsy();
      const payload = payloadOf(read);
      expect(payload.title).toBe("Brief MCP");
      expect(payload.text).toContain("Bonjour le monde");
    } finally {
      await client.close();
      await transport.close();
    }
  });

  it("docs.read refuse un jeton sans scope docs:read", async () => {
    const f = await fixtures(["drive:read"]);
    const actor = { userId: f.userId, orgId: f.orgId };
    const { entry } = await createDocument(actor, { title: "Sans accès" });

    const { client, transport } = await connectClient(f.token);
    try {
      const read = await client.callTool({
        name: "docs.read",
        arguments: { fileId: entry.id },
      });
      expect(read.isError).toBe(true);
    } finally {
      await client.close();
      await transport.close();
    }
  });
});

describe("serveur MCP — tâches (lecture et création par un agent)", () => {
  it("tasks.lists + tasks.create + tasks.list bout en bout", async () => {
    const f = await fixtures(["tasks:read", "tasks:write"]);
    const actor = { userId: f.userId, orgId: f.orgId };
    const list = await createTaskList(actor, { name: "Agent" });

    const { client, transport } = await connectClient(f.token);
    try {
      const lists = await client.callTool({ name: "tasks.lists", arguments: {} });
      expect(lists.isError).toBeFalsy();
      const listRows = payloadOf(lists) as unknown as { id: string; name: string }[];
      expect(listRows[0]?.name).toBe("Agent");

      const created = await client.callTool({
        name: "tasks.create",
        arguments: { listId: list.id, title: "Préparer le rapport" },
      });
      expect(created.isError).toBeFalsy();

      const all = await client.callTool({ name: "tasks.list", arguments: {} });
      const rows = payloadOf(all) as unknown as { title: string; listName: string }[];
      expect(
        rows.some((row) => row.title === "Préparer le rapport" && row.listName === "Agent"),
      ).toBe(true);
    } finally {
      await client.close();
      await transport.close();
    }
  });

  it("tasks.create refusé sans scope d'écriture (tasks:read seul)", async () => {
    const f = await fixtures(["tasks:read"]);
    const actor = { userId: f.userId, orgId: f.orgId };
    const list = await createTaskList(actor, { name: "Lecture seule" });

    const { client, transport } = await connectClient(f.token);
    try {
      const created = await client.callTool({
        name: "tasks.create",
        arguments: { listId: list.id, title: "Interdit" },
      });
      expect(created.isError).toBe(true);
    } finally {
      await client.close();
      await transport.close();
    }
  });
  it("calendar.create + calendar.list : crée et relit un événement", async () => {
    const f = await fixtures(["calendar:read", "calendar:write"]);
    const { client, transport } = await connectClient(f.token);
    try {
      const created = await client.callTool({
        name: "calendar.create",
        arguments: {
          title: "Agent : point produit",
          startsAt: "2026-04-01T09:00:00.000Z",
          endsAt: "2026-04-01T10:00:00.000Z",
        },
      });
      expect(created.isError).toBeFalsy();
      const event = payloadOf(created);
      expect(event.title).toBe("Agent : point produit");

      const list = await client.callTool({
        name: "calendar.list",
        arguments: { from: "2026-03-31T00:00:00.000Z", to: "2026-04-02T00:00:00.000Z" },
      });
      expect(list.isError).toBeFalsy();
      const events = payloadOf(list) as unknown as { title: string }[];
      expect(events.some((entry) => entry.title === "Agent : point produit")).toBe(true);
    } finally {
      await client.close();
      await transport.close();
    }
  });

  it("sheets.read : évalue les formules avant de répondre", async () => {
    const f = await fixtures(["sheets:read"]);
    const actor = { userId: f.userId, orgId: f.orgId };

    const { createSpreadsheet, getSpreadsheet, saveCells } = await import("@workspace/sheets");
    const { entry } = await createSpreadsheet(actor, { title: "Agent sheet" });
    const detail = await getSpreadsheet(actor, entry.id);
    const tabId = detail.tabs[0]?.id;
    if (!tabId) throw new Error("onglet manquant");
    await saveCells(actor, entry.id, {
      tabId,
      updates: [
        { row: 0, col: 0, value: "2" },
        { row: 1, col: 0, value: "3" },
        { row: 2, col: 0, value: "=SUM(A1:A2)" },
      ],
    });

    const { client, transport } = await connectClient(f.token);
    try {
      const result = await client.callTool({
        name: "sheets.read",
        arguments: { fileId: entry.id },
      });
      expect(result.isError).toBeFalsy();
      const payload = payloadOf(result);
      const rows = payload.rows as string[][];
      expect(rows[2]?.[0]).toBe("5");
    } finally {
      await client.close();
      await transport.close();
    }
  });

  it("chat.send + chat.list : écrit et relit un message", async () => {
    const f = await fixtures(["chat:read", "chat:write"]);
    const actor = { userId: f.userId, orgId: f.orgId };

    const { createChannel } = await import("@workspace/chat");
    const channel = await createChannel(actor, "agents");

    const { client, transport } = await connectClient(f.token);
    try {
      const sent = await client.callTool({
        name: "chat.send",
        arguments: { channelId: channel.id, body: "Bonjour depuis un agent" },
      });
      expect(sent.isError).toBeFalsy();

      const list = await client.callTool({ name: "chat.list", arguments: {} });
      expect(list.isError).toBeFalsy();
      const channels = payloadOf(list) as unknown as { name: string }[];
      expect(channels.some((entry) => entry.name === "agents")).toBe(true);
    } finally {
      await client.close();
      await transport.close();
    }
  });

  it("forms.list : liste les formulaires accessibles", async () => {
    const f = await fixtures(["forms:read"]);
    const actor = { userId: f.userId, orgId: f.orgId };

    const { createForm } = await import("@workspace/forms");
    await createForm(actor, { title: "Enquête agent" });

    const { client, transport } = await connectClient(f.token);
    try {
      const result = await client.callTool({ name: "forms.list", arguments: {} });
      expect(result.isError).toBeFalsy();
      const forms = payloadOf(result) as unknown as { title: string }[];
      expect(forms.some((entry) => entry.title === "Enquête agent")).toBe(true);
    } finally {
      await client.close();
      await transport.close();
    }
  });
});
