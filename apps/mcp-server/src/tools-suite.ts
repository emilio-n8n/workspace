import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { TokenPrincipal } from "@workspace/auth";
import { createEvent as createCalendarEvent, listEvents } from "@workspace/calendar";
import { listChannels, sendMessage } from "@workspace/chat";
import { listCourses } from "@workspace/classroom";
import { listForms, listResponses } from "@workspace/forms";
import { listMessages as listMailMessages, sendMail } from "@workspace/mail";
import { cellKey, evaluateCells, formatValue, getSpreadsheet } from "@workspace/sheets";
import { getSite, getPage as getSitePage } from "@workspace/sites";
import { getPresentation } from "@workspace/slides";
import { z } from "zod";
import { requireScope, withAudit } from "./audit.ts";

const MAX_GRID_ROWS = 50;
const MAX_GRID_COLS = 20;

/**
 * Outils MCP de la suite complète (Calendar, Forms, Sheets, Slides, Chat,
 * Mail, Classroom, Sites) — mêmes services et permissions que les
 * applications (ADR-0006).
 */
export function registerSuiteTools(server: McpServer, principal: TokenPrincipal): void {
  const actor = { userId: principal.userId, orgId: principal.orgId };

  server.registerTool(
    "calendar.list",
    {
      title: "Lister les événements",
      description:
        "Événements visibles (agendas personnels, agendas d'organisation et invitations) dans une plage de dates ISO. Scope requis : calendar:read.",
      inputSchema: {
        from: z.string().min(1),
        to: z.string().min(1),
      },
    },
    async ({ from, to }) =>
      withAudit(principal, "calendar.list", async () => {
        requireScope(principal, "calendar:read");
        const events = await listEvents(actor, { from, to });
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                events.map((event) => ({
                  id: event.id,
                  calendar: event.calendarName,
                  title: event.title,
                  startsAt: event.startsAt,
                  endsAt: event.endsAt,
                  allDay: event.allDay,
                  location: event.location,
                  myStatus: event.myStatus,
                })),
                null,
                2,
              ),
            },
          ],
        };
      }),
  );

  server.registerTool(
    "calendar.create",
    {
      title: "Créer un événement",
      description:
        "Crée un événement dans l'agenda personnel (ou un agenda d'organisation via `calendarId`). Scope requis : calendar:write.",
      inputSchema: {
        title: z.string().min(1).max(255),
        startsAt: z.string().min(1),
        endsAt: z.string().min(1),
        description: z.string().max(5000).optional(),
        location: z.string().max(255).optional(),
      },
    },
    async ({ title, startsAt, endsAt, description, location }) =>
      withAudit(principal, "calendar.create", async () => {
        requireScope(principal, "calendar:write");
        const event = await createCalendarEvent(actor, {
          title,
          startsAt,
          endsAt,
          description: description ?? null,
          location: location ?? null,
        });
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  id: event.id,
                  title: event.title,
                  startsAt: event.startsAt,
                  calendar: event.calendarName,
                },
                null,
                2,
              ),
            },
          ],
        };
      }),
  );

  server.registerTool(
    "forms.list",
    {
      title: "Lister les formulaires",
      description:
        "Formulaires accessibles avec statut et nombre de réponses. Scope requis : forms:read.",
      inputSchema: {},
    },
    async () =>
      withAudit(principal, "forms.list", async () => {
        requireScope(principal, "forms:read");
        const forms = await listForms(actor);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(forms, null, 2) }],
        };
      }),
  );

  server.registerTool(
    "forms.responses",
    {
      title: "Lire les réponses d'un formulaire",
      description:
        "Réponses d'un formulaire accessible en écriture (réservé aux éditeurs), avec les intitulés de questions. Scope requis : forms:read.",
      inputSchema: {
        fileId: z.string().uuid(),
        limit: z.number().int().min(1).max(200).optional(),
      },
    },
    async ({ fileId, limit }) =>
      withAudit(principal, "forms.responses", async () => {
        requireScope(principal, "forms:read");
        const { questions, responses } = await listResponses(actor, fileId);
        const output = responses.slice(0, limit ?? 50).map((response) => ({
          submittedAt: response.submittedAt,
          answers: Object.fromEntries(
            questions.map((question) => [question.label, response.answers[question.id] ?? null]),
          ),
        }));
        return {
          content: [{ type: "text" as const, text: JSON.stringify(output, null, 2) }],
        };
      }),
  );

  server.registerTool(
    "sheets.read",
    {
      title: "Lire une feuille de calcul",
      description:
        "Valeurs calculées d'un onglet (formules évaluées, 50 lignes × 20 colonnes max). Scope requis : sheets:read.",
      inputSchema: {
        fileId: z.string().uuid(),
        tab: z.string().max(120).optional(),
      },
    },
    async ({ fileId, tab }) =>
      withAudit(principal, "sheets.read", async () => {
        requireScope(principal, "sheets:read");
        const detail = await getSpreadsheet(actor, fileId);
        const target = tab ? detail.tabs.find((entry) => entry.name === tab) : detail.tabs[0];
        if (!target) {
          return {
            content: [{ type: "text" as const, text: "Onglet introuvable." }],
            isError: true,
          };
        }

        const map: Record<string, string> = {};
        let maxRow = 0;
        let maxCol = 0;
        for (const cell of detail.cells) {
          if (cell.tabId !== target.id) continue;
          map[cellKey(cell.row, cell.col)] = cell.value;
          maxRow = Math.max(maxRow, cell.row);
          maxCol = Math.max(maxCol, cell.col);
        }
        const evaluated = evaluateCells(map);

        const rows: string[][] = [];
        const rowCount = Math.min(maxRow + 1, MAX_GRID_ROWS);
        const colCount = Math.min(maxCol + 1, MAX_GRID_COLS);
        for (let row = 0; row < rowCount; row += 1) {
          const values: string[] = [];
          for (let col = 0; col < colCount; col += 1) {
            const value = evaluated.get(cellKey(row, col));
            values.push(value ? formatValue(value) : "");
          }
          rows.push(values);
        }

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  title: detail.title,
                  tab: target.name,
                  rows,
                  truncated: maxRow + 1 > rowCount || maxCol + 1 > colCount,
                },
                null,
                2,
              ),
            },
          ],
        };
      }),
  );

  server.registerTool(
    "slides.read",
    {
      title: "Lire une présentation",
      description:
        "Plan d'une présentation : titres, notes et textes des diapositives. Scope requis : slides:read.",
      inputSchema: {
        fileId: z.string().uuid(),
      },
    },
    async ({ fileId }) =>
      withAudit(principal, "slides.read", async () => {
        requireScope(principal, "slides:read");
        const presentation = await getPresentation(actor, fileId);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  title: presentation.title,
                  slides: presentation.slides.map((slide) => ({
                    position: slide.position,
                    title: slide.title,
                    notes: slide.notes,
                    texts: slide.elements
                      .filter((element) => element.kind === "text" && element.text.length > 0)
                      .map((element) => element.text),
                  })),
                },
                null,
                2,
              ),
            },
          ],
        };
      }),
  );

  server.registerTool(
    "chat.list",
    {
      title: "Lister les conversations",
      description:
        "Canaux et discussions directes de l'utilisateur avec compteurs de non-lus. Scope requis : chat:read.",
      inputSchema: {},
    },
    async () =>
      withAudit(principal, "chat.list", async () => {
        requireScope(principal, "chat:read");
        const channels = await listChannels(actor);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(channels, null, 2) }],
        };
      }),
  );

  server.registerTool(
    "chat.send",
    {
      title: "Envoyer un message",
      description:
        "Envoie un message dans une conversation dont l'utilisateur est membre. Scope requis : chat:write.",
      inputSchema: {
        channelId: z.string().uuid(),
        body: z.string().min(1).max(4000),
      },
    },
    async ({ channelId, body }) =>
      withAudit(principal, "chat.send", async () => {
        requireScope(principal, "chat:write");
        const message = await sendMessage(actor, channelId, body);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ id: message.id, createdAt: message.createdAt }, null, 2),
            },
          ],
        };
      }),
  );

  server.registerTool(
    "mail.list",
    {
      title: "Lister les messages",
      description:
        "Messages d'un dossier (inbox, sent, drafts, trash) avec aperçu et erreur d'envoi éventuelle. Scope requis : mail:read.",
      inputSchema: {
        folder: z.enum(["inbox", "sent", "drafts", "trash"]).optional(),
      },
    },
    async ({ folder }) =>
      withAudit(principal, "mail.list", async () => {
        requireScope(principal, "mail:read");
        const messages = await listMailMessages(actor, { folder: folder ?? "inbox" });
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                messages.slice(0, 100).map((message) => ({
                  id: message.id,
                  from: message.fromAddress,
                  to: message.toAddresses,
                  subject: message.subject,
                  snippet: message.snippet,
                  read: message.read,
                  starred: message.starred,
                  sendError: message.sendError,
                  createdAt: message.createdAt,
                })),
                null,
                2,
              ),
            },
          ],
        };
      }),
  );

  server.registerTool(
    "mail.send",
    {
      title: "Envoyer un message",
      description:
        "Envoie un e-mail depuis la boîte de l'utilisateur (SMTP de l'instance). Le message est conservé dans « Envoyés » avec l'erreur éventuelle. Scope requis : mail:write.",
      inputSchema: {
        to: z.array(z.string().max(255)).min(1).max(20),
        subject: z.string().max(500),
        body: z.string().max(100_000),
      },
    },
    async ({ to, subject, body }) =>
      withAudit(principal, "mail.send", async () => {
        requireScope(principal, "mail:write");
        const result = await sendMail(actor, { to, cc: [], subject, body });
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ id: result.id, sendError: result.sendError }, null, 2),
            },
          ],
        };
      }),
  );

  server.registerTool(
    "classroom.list",
    {
      title: "Lister les cours",
      description:
        "Cours dont l'utilisateur est membre (enseignant ou élève) avec nombre d'élèves et de devoirs. Scope requis : classroom:read.",
      inputSchema: {},
    },
    async () =>
      withAudit(principal, "classroom.list", async () => {
        requireScope(principal, "classroom:read");
        const courses = await listCourses(actor);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(courses, null, 2) }],
        };
      }),
  );

  server.registerTool(
    "sites.read",
    {
      title: "Lire un site interne",
      description:
        "Pages d'un site et contenu Markdown d'une page (`pageSlug` optionnel, première page par défaut). Scope requis : sites:read.",
      inputSchema: {
        fileId: z.string().uuid(),
        pageSlug: z.string().max(80).optional(),
      },
    },
    async ({ fileId, pageSlug }) =>
      withAudit(principal, "sites.read", async () => {
        requireScope(principal, "sites:read");
        const site = await getSite(actor, fileId);
        const pageView = pageSlug
          ? site.pages.find((page) => page.slug === pageSlug)
          : site.pages[0];
        if (!pageView) {
          return {
            content: [{ type: "text" as const, text: "Page introuvable." }],
            isError: true,
          };
        }
        const page = await getSitePage(actor, fileId, pageView.id);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  title: site.title,
                  pages: site.pages.map((entry) => ({ slug: entry.slug, title: entry.title })),
                  page: { slug: page.slug, title: page.title, markdown: page.content },
                },
                null,
                2,
              ),
            },
          ],
        };
      }),
  );
}
