import { randomUUID } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { issueApiToken, type WorkspaceScope } from "@workspace/auth";
import { closeDb, getDb, schema } from "@workspace/database";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

const { user, organization, apiTokens, auditEvents } = schema;

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
  await db.delete(user).where(eq(user.id, f.userId));
  await db.delete(organization).where(eq(organization.id, f.orgId));
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

let fixtures: Fixtures;

beforeEach(async () => {
  fixtures = await createFixtures(["drive:read"]);
});

afterEach(async () => {
  await cleanup(fixtures);
});

afterAll(async () => {
  await closeDb();
});

describe("serveur MCP — intégration réelle (stdio)", () => {
  it("liste les outils et répond à me.whoami avec le bon principal", async () => {
    const { client, transport } = await connectClient(fixtures.token);
    try {
      const tools = await client.listTools();
      const names = tools.tools.map((tool) => tool.name).sort();
      expect(names).toEqual(["audit.recent", "me.whoami"]);

      const whoami = await client.callTool({ name: "me.whoami", arguments: {} });
      expect(whoami.isError).toBeFalsy();
      const text = Array.isArray(whoami.content) ? whoami.content[0] : undefined;
      const payload = JSON.parse(String((text as { type: string; text: string }).text)) as {
        organizationId: string;
        scopes: string[];
        user: { email: string };
      };
      expect(payload.organizationId).toBe(fixtures.orgId);
      expect(payload.scopes).toEqual(["drive:read"]);
      expect(payload.user.email).toBe(`${fixtures.userId}@example.org`);
    } finally {
      await client.close();
      await transport.close();
    }
  });

  it("refuse audit.recent sans le scope audit:read et journalise le refus", async () => {
    const { client, transport } = await connectClient(fixtures.token);
    try {
      const result = await client.callTool({ name: "audit.recent", arguments: {} });
      expect(result.isError).toBe(true);

      const db = getDb();
      const events = await db
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.orgId, fixtures.orgId));
      const denied = events.find((event) => event.action === "mcp.audit.recent");
      expect(denied?.result).toBe("denied");
    } finally {
      await client.close();
      await transport.close();
    }
  });

  it("autorise audit.recent avec le scope audit:read et journalise le succès", async () => {
    await cleanup(fixtures);
    fixtures = await createFixtures(["audit:read"]);

    const { client, transport } = await connectClient(fixtures.token);
    try {
      const result = await client.callTool({ name: "audit.recent", arguments: { limit: 5 } });
      expect(result.isError).toBeFalsy();

      const db = getDb();
      const events = await db
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.orgId, fixtures.orgId));
      const success = events.find(
        (event) => event.action === "mcp.audit.recent" && event.result === "success",
      );
      expect(success).toBeTruthy();
    } finally {
      await client.close();
      await transport.close();
    }
  });
});
