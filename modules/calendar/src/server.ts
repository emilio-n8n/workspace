import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { requireActor } from "@workspace/auth";
import { getAppUrls } from "@workspace/config";
import { z } from "zod";
import {
  createCalendar,
  createEvent,
  deleteEvent,
  ensurePrimaryCalendar,
  listCalendars,
  listEvents,
  setAttendance,
  updateEvent,
} from "./index.ts";

export type { CalendarView as CalendarOption, EventView, Recurrence } from "./index.ts";

const RECURRENCE_VALUES = ["none", "daily", "weekly", "monthly"] as const;

const eventFields = z.object({
  calendarId: z.string().uuid().nullish(),
  title: z.string().trim().min(1).max(255),
  description: z.string().max(5000).nullish(),
  location: z.string().max(255).nullish(),
  startsAt: z.string().min(1),
  endsAt: z.string().min(1),
  allDay: z.boolean().optional(),
  attendees: z.array(z.string().trim().min(1).max(255)).max(50).optional(),
  recurrence: z.enum(RECURRENCE_VALUES).optional(),
  recurrenceInterval: z.number().int().min(1).max(52).optional(),
  recurrenceUntil: z.string().min(1).nullish(),
});

export const listCalendarsFn = createServerFn({ method: "GET" }).handler(async () => {
  const { actor } = await requireActor(getRequest().headers);
  return listCalendars(actor);
});

export const listEventsFn = createServerFn({ method: "GET" })
  .validator((input: unknown) =>
    z.object({ from: z.string().min(1), to: z.string().min(1) }).parse(input),
  )
  .handler(async ({ data }) => {
    const { actor } = await requireActor(getRequest().headers);
    return listEvents(actor, { from: data.from, to: data.to });
  });

export const createEventFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => eventFields.parse(input))
  .handler(async ({ data }) => {
    const { actor } = await requireActor(getRequest().headers);
    return createEvent(actor, data);
  });

export const updateEventFn = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z
      .object({
        eventId: z.string().uuid(),
        patch: z.object({
          title: z.string().trim().min(1).max(255).optional(),
          description: z.string().max(5000).nullish(),
          location: z.string().max(255).nullish(),
          startsAt: z.string().min(1).optional(),
          endsAt: z.string().min(1).optional(),
          allDay: z.boolean().optional(),
          recurrence: z.enum(RECURRENCE_VALUES).optional(),
          recurrenceInterval: z.number().int().min(1).max(52).optional(),
          recurrenceUntil: z.string().min(1).nullish(),
        }),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { actor } = await requireActor(getRequest().headers);
    return updateEvent(actor, data.eventId, data.patch);
  });

export const deleteEventFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ eventId: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const { actor } = await requireActor(getRequest().headers);
    await deleteEvent(actor, data.eventId);
    return { ok: true };
  });

export const setAttendanceFn = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z.object({ eventId: z.string().uuid(), status: z.enum(["accepted", "declined"]) }).parse(input),
  )
  .handler(async ({ data }) => {
    const { actor } = await requireActor(getRequest().headers);
    return setAttendance(actor, data.eventId, data.status);
  });

/**
 * Garantit l'agenda personnel par défaut (idempotent : `ON CONFLICT DO NOTHING`).
 * Remplace l'ancien `createCalendarFn("Mon agenda")` côté client, qui partait en
 * course quand deux chargements se chevauchaient (double effet en mode strict,
 * changement de plage) et violait `calendars_org_owner_name_uidx`.
 */
export const ensurePrimaryCalendarFn = createServerFn({ method: "POST" }).handler(async () => {
  const { actor } = await requireActor(getRequest().headers);
  return { id: await ensurePrimaryCalendar(actor) };
});

export const createCalendarFn = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z
      .object({ name: z.string().trim().min(1).max(120), shared: z.boolean().default(false) })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { actor } = await requireActor(getRequest().headers);
    return createCalendar(actor, { name: data.name, shared: data.shared });
  });

/**
 * URL de l'application Meet, pour composer les liens de visioconférence des
 * événements (les salles sont des liens à portée d'organisation : tout membre
 * de l'organisation peut les rejoindre).
 */
export const getMeetUrlFn = createServerFn({ method: "GET" }).handler(
  async () => getAppUrls().meet,
);
