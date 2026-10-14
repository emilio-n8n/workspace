import { schema as core } from "@workspace/database";
import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Schéma du module Calendar — voir docs/modules/calendar.md.
 * Un agenda appartient à une personne (`owner_id`) ou à l'organisation
 * (`owner_id` nul : visible de tous les membres). Les événements portent des
 * invités avec leur réponse (invité / accepté / refusé).
 *
 * Récurrence simple : la série est portée par la ligne (`recurrence` +
 * `recurrence_until`) et développée en occurrences à la lecture. Il n'existe
 * pas de dérogation par occurrence : modifier ou supprimer la ligne affecte
 * toute la série.
 */

export const calendars = pgTable(
  "calendars",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    orgId: text("org_id")
      .notNull()
      .references(() => core.organization.id, { onDelete: "cascade" }),
    ownerId: text("owner_id").references(() => core.user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("calendars_org_idx").on(table.orgId),
    index("calendars_owner_idx").on(table.ownerId),
    uniqueIndex("calendars_org_owner_name_uidx").on(table.orgId, table.ownerId, table.name),
  ],
);

export const calendarEvents = pgTable(
  "calendar_events",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    orgId: text("org_id")
      .notNull()
      .references(() => core.organization.id, { onDelete: "cascade" }),
    calendarId: uuid("calendar_id")
      .notNull()
      .references(() => calendars.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),
    location: text("location"),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    allDay: boolean("all_day").notNull().default(false),
    /**
     * Récurrence de la série : `none` | `daily` | `weekly` | `monthly`.
     * La première occurrence est la ligne elle-même (startsAt/endsAt).
     */
    recurrence: text("recurrence").notNull().default("none"),
    /**
     * Intervalle entre deux occurrences, en unités de `recurrence` : `1` =
     * toutes les semaines, `3` = toutes les trois semaines. Borné à 52 pour
     * éviter une série qui ne produit aucune occurrence visible.
     */
    recurrenceInterval: integer("recurrence_interval").notNull().default(1),
    /** Dernière date (incluse) à laquelle une occurrence peut démarrer. */
    recurrenceUntil: timestamp("recurrence_until", { withTimezone: true }),
    createdBy: text("created_by")
      .notNull()
      .references(() => core.user.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("calendar_events_calendar_idx").on(table.calendarId),
    index("calendar_events_org_range_idx").on(table.orgId, table.startsAt),
  ],
);

export const calendarAttendees = pgTable(
  "calendar_attendees",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    eventId: uuid("event_id")
      .notNull()
      .references(() => calendarEvents.id, { onDelete: "cascade" }),
    userId: text("user_id").references(() => core.user.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    status: text("status").notNull().default("invited"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("calendar_attendees_event_email_uidx").on(table.eventId, table.email),
    index("calendar_attendees_user_idx").on(table.userId),
    // Recherche des invitations par adresse (avant rattachement au user_id).
    index("calendar_attendees_email_idx").on(table.email),
  ],
);

export type CalendarRow = typeof calendars.$inferSelect;
export type CalendarEventRow = typeof calendarEvents.$inferSelect;
export type CalendarAttendeeRow = typeof calendarAttendees.$inferSelect;
