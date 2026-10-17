import { randomUUID } from "node:crypto";
import { closeDb, schema as coreSchema, getDb } from "@workspace/database";
import type { Actor } from "@workspace/permissions";
import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CalendarError,
  createCalendar,
  createEvent,
  deleteEvent,
  ensurePrimaryCalendar,
  getEvent,
  listCalendars,
  listEvents,
  setAttendance,
  updateEvent,
} from "../src/index.ts";

const { user, organization, member, auditEvents } = coreSchema;

let counter = 0;
const tag = (prefix: string) => `${prefix}${++counter}_${randomUUID().slice(0, 8)}`;

type Fixtures = {
  orgId: string;
  otherOrgId: string;
  alice: string;
  bruno: string;
  actorAlice: Actor;
  actorBruno: Actor;
  actorChloe: Actor;
  emailAlice: string;
  emailBruno: string;
  emailChloe: string;
};

async function createFixtures(): Promise<Fixtures> {
  const db = getDb();
  const now = new Date();

  const orgId = tag("org");
  const otherOrgId = tag("org");
  await db.insert(organization).values([
    { id: orgId, name: tag("Org "), slug: orgId, createdAt: now },
    { id: otherOrgId, name: tag("Org "), slug: otherOrgId, createdAt: now },
  ]);

  const makeUser = async (name: string) => {
    const id = tag("usr");
    const email = `${id}@example.org`.toLowerCase();
    await db.insert(user).values({
      id,
      name,
      email,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    });
    return { id, email };
  };

  const alice = await makeUser("Alice");
  const bruno = await makeUser("Bruno");
  const chloe = await makeUser("Chloe");

  // Alice et Bruno sont membres de la même organisation ; Chloe est ailleurs.
  await db.insert(member).values([
    { id: tag("mem"), organizationId: orgId, userId: alice.id, role: "owner", createdAt: now },
    { id: tag("mem"), organizationId: orgId, userId: bruno.id, role: "member", createdAt: now },
    {
      id: tag("mem"),
      organizationId: otherOrgId,
      userId: chloe.id,
      role: "owner",
      createdAt: now,
    },
  ]);

  return {
    orgId,
    otherOrgId,
    alice: alice.id,
    bruno: bruno.id,
    emailAlice: alice.email,
    emailBruno: bruno.email,
    emailChloe: chloe.email,
    actorAlice: { userId: alice.id, orgId },
    actorBruno: { userId: bruno.id, orgId },
    actorChloe: { userId: chloe.id, orgId: otherOrgId },
  };
}

async function cleanup(f: Fixtures): Promise<void> {
  const db = getDb();
  await db.delete(auditEvents).where(eq(auditEvents.orgId, f.orgId));
  await db.delete(auditEvents).where(eq(auditEvents.orgId, f.otherOrgId));
  await db.delete(organization).where(eq(organization.id, f.orgId));
  await db.delete(organization).where(eq(organization.id, f.otherOrgId));
  for (const id of [f.alice, f.bruno, f.actorChloe.userId]) {
    await db.delete(user).where(eq(user.id, id));
  }
}

/** Nombre de lignes d'audit rattachées à une organisation. */
async function countAuditRows(orgId: string): Promise<number> {
  const [row] = await getDb()
    .select({ value: sql<number>`count(*)`.mapWith(Number) })
    .from(auditEvents)
    .where(eq(auditEvents.orgId, orgId));
  return row?.value ?? 0;
}

let f: Fixtures;

beforeEach(async () => {
  f = await createFixtures();
});

afterEach(async () => {
  await cleanup(f);
});

afterAll(async () => {
  await closeDb();
});

const FROM = "2026-03-01T00:00:00.000Z";
const TO = "2026-03-31T23:59:59.000Z";

function eventInput(title: string) {
  return {
    title,
    startsAt: "2026-03-10T09:00:00.000Z",
    endsAt: "2026-03-10T10:00:00.000Z",
  };
}

describe("calendar — agendas", () => {
  it("crée l'agenda personnel une seule fois", async () => {
    const first = await ensurePrimaryCalendar(f.actorAlice);
    const second = await ensurePrimaryCalendar(f.actorAlice);
    expect(second).toBe(first);
  });

  it("l'agenda par défaut reste unique sous appels concurrents", async () => {
    const ids = await Promise.all(
      Array.from({ length: 6 }, () => ensurePrimaryCalendar(f.actorBruno)),
    );
    expect(new Set(ids).size).toBe(1);
    const mine = (await listCalendars(f.actorBruno)).filter((c) => c.name === "Mon agenda");
    expect(mine).toHaveLength(1);
  });

  it("refuse deux agendas partagés de même nom dans l'organisation", async () => {
    await createCalendar(f.actorAlice, { name: "Direction", shared: true });
    await expect(
      createCalendar(f.actorBruno, { name: "Direction", shared: true }),
    ).rejects.toMatchObject({ code: "conflict" });
  });

  it("crée un agenda partagé visible par les autres membres", async () => {
    const shared = await createCalendar(f.actorAlice, { name: "Équipe", shared: true });
    expect(shared.isOrg).toBe(true);

    const brunoCalendars = await listCalendars(f.actorBruno);
    expect(brunoCalendars.some((calendar) => calendar.id === shared.id)).toBe(true);
  });

  it("refuse deux agendas personnels de même nom", async () => {
    await createCalendar(f.actorAlice, { name: "Projets" });
    await expect(createCalendar(f.actorAlice, { name: "Projets" })).rejects.toMatchObject({
      code: "conflict",
      message: "Un agenda porte déjà ce nom.",
    });

    // Le même nom reste possible pour un autre propriétaire.
    const bruno = await createCalendar(f.actorBruno, { name: "Projets" });
    expect(bruno.name).toBe("Projets");
  });
});

describe("calendar — événements", () => {
  it("crée un événement dans l'agenda personnel et le liste par plage", async () => {
    const event = await createEvent(f.actorAlice, eventInput("Point produit"));
    expect(event.calendarName).toBe("Mon agenda");
    expect(event.myStatus).toBeNull();

    const list = await listEvents(f.actorAlice, { from: FROM, to: TO });
    expect(list).toHaveLength(1);
    expect(list[0]?.title).toBe("Point produit");

    // L'agenda personnel d'Alice n'est pas visible par Bruno.
    const brunoList = await listEvents(f.actorBruno, { from: FROM, to: TO });
    expect(brunoList).toHaveLength(0);
  });

  it("refuse une fin avant le début", async () => {
    await expect(
      createEvent(f.actorAlice, {
        title: "Invalide",
        startsAt: "2026-03-10T10:00:00.000Z",
        endsAt: "2026-03-10T09:00:00.000Z",
      }),
    ).rejects.toThrow(CalendarError);
  });

  it("un invité voit l'événement, reçoit le lien utilisateur et peut répondre", async () => {
    const created = await createEvent(f.actorAlice, {
      ...eventInput("Revue"),
      attendees: [f.emailBruno],
    });
    expect(created.attendees).toHaveLength(1);
    expect(created.attendees[0]?.userId).toBe(f.bruno);
    expect(created.attendees[0]?.status).toBe("invited");

    const brunoList = await listEvents(f.actorBruno, { from: FROM, to: TO });
    expect(brunoList).toHaveLength(1);
    expect(brunoList[0]?.myStatus).toBe("invited");

    const accepted = await setAttendance(f.actorBruno, created.id, "accepted");
    expect(accepted.myStatus).toBe("accepted");
  });

  it("un invité extérieur reste sans compte lié", async () => {
    const created = await createEvent(f.actorAlice, {
      ...eventInput("Externe"),
      attendees: ["personne@ailleurs.example"],
    });
    expect(created.attendees[0]?.userId).toBeNull();
  });

  it("ne révèle pas à un invité d'une autre organisation l'événement (cloisonnement)", async () => {
    const created = await createEvent(f.actorAlice, {
      ...eventInput("Confidentiel"),
      attendees: [f.emailChloe],
    });
    expect(created.attendees[0]?.email).toBe(f.emailChloe);
    expect(created.attendees[0]?.userId).toBeNull(); // Chloe n'est pas membre de l'organisation d'Alice.

    const chloeList = await listEvents(f.actorChloe, { from: FROM, to: TO });
    expect(chloeList).toHaveLength(0);

    await expect(getEvent(f.actorChloe, created.id)).rejects.toThrow(CalendarError);
    await expect(setAttendance(f.actorChloe, created.id, "accepted")).rejects.toThrow(
      CalendarError,
    );

    // La tentative refusée n'a rien écrit : le statut reste « invité ».
    const aliceView = await getEvent(f.actorAlice, created.id);
    expect(aliceView.attendees[0]?.status).toBe("invited");
  });

  it("applique un intervalle semi-ouvert aux bornes de la plage", async () => {
    const created = await createEvent(f.actorAlice, eventInput("Bordures")); // 09:00 → 10:00

    // Un événement qui se termine exactement au début de la plage est exclu.
    const afterEnd = await listEvents(f.actorAlice, {
      from: "2026-03-10T10:00:00.000Z",
      to: "2026-03-11T00:00:00.000Z",
    });
    expect(afterEnd).toHaveLength(0);

    // Un événement qui commence exactement à la fin de la plage est exclu.
    const beforeStart = await listEvents(f.actorAlice, {
      from: "2026-03-10T00:00:00.000Z",
      to: "2026-03-10T09:00:00.000Z",
    });
    expect(beforeStart).toHaveLength(0);

    // Recouvrement partiel : l'événement reste visible.
    const overlap = await listEvents(f.actorAlice, {
      from: "2026-03-10T09:30:00.000Z",
      to: "2026-03-10T09:45:00.000Z",
    });
    expect(overlap.map((event) => event.id)).toEqual([created.id]);
  });

  it("refuse les plages de plus de 366 jours", async () => {
    // Exactement 366 jours : accepté.
    const exactly = await listEvents(f.actorAlice, {
      from: "2026-01-01T00:00:00.000Z",
      to: "2027-01-02T00:00:00.000Z",
    });
    expect(exactly).toHaveLength(0);

    // 367 jours : refusé (garde-fou anti-DoS).
    await expect(
      listEvents(f.actorAlice, {
        from: "2026-01-01T00:00:00.000Z",
        to: "2027-01-03T00:00:00.000Z",
      }),
    ).rejects.toThrow(CalendarError);
  });

  it("stocke les événements journée entière en instants DATE seule (UTC)", async () => {
    const created = await createEvent(f.actorAlice, {
      title: "Journée entière",
      startsAt: "2026-03-10T00:00:00.000Z",
      endsAt: "2026-03-11T00:00:00.000Z",
      allDay: true,
    });
    expect(created.allDay).toBe(true);
    expect(created.startsAt).toBe("2026-03-10T00:00:00.000Z");
    expect(created.endsAt).toBe("2026-03-11T00:00:00.000Z");

    // Une heure résiduelle est ramenée au minuit UTC du jour choisi.
    const normalized = await createEvent(f.actorAlice, {
      title: "Congé",
      startsAt: "2026-03-10T13:45:00.000Z",
      endsAt: "2026-03-10T14:30:00.000Z",
      allDay: true,
    });
    expect(normalized.startsAt).toBe("2026-03-10T00:00:00.000Z");
    expect(normalized.endsAt).toBe("2026-03-11T00:00:00.000Z");
  });

  it("fusionne un patch d'une seule borne avec la plage existante", async () => {
    const created = await createEvent(f.actorAlice, eventInput("Partiel"));

    const endOnly = await updateEvent(f.actorAlice, created.id, {
      endsAt: "2026-03-10T11:00:00.000Z",
    });
    expect(endOnly.startsAt).toBe("2026-03-10T09:00:00.000Z");
    expect(endOnly.endsAt).toBe("2026-03-10T11:00:00.000Z");

    const startOnly = await updateEvent(f.actorAlice, created.id, {
      startsAt: "2026-03-10T08:30:00.000Z",
    });
    expect(startOnly.startsAt).toBe("2026-03-10T08:30:00.000Z");
    expect(startOnly.endsAt).toBe("2026-03-10T11:00:00.000Z");

    // Plage résultante invalide : refusée sans écriture partielle.
    await expect(
      updateEvent(f.actorAlice, created.id, { startsAt: "2026-03-10T12:00:00.000Z" }),
    ).rejects.toThrow(CalendarError);
    const unchanged = await getEvent(f.actorAlice, created.id);
    expect(unchanged.startsAt).toBe("2026-03-10T08:30:00.000Z");
    expect(unchanged.endsAt).toBe("2026-03-10T11:00:00.000Z");
  });

  it("refuse de modifier les invités ou l'agenda d'un événement", async () => {
    const created = await createEvent(f.actorAlice, eventInput("Fixes"));

    await expect(
      updateEvent(f.actorAlice, created.id, { attendees: [f.emailBruno] }),
    ).rejects.toThrow("Les invités ne sont pas modifiables après création.");
    await expect(
      updateEvent(f.actorAlice, created.id, { calendarId: created.calendarId }),
    ).rejects.toThrow(CalendarError);

    // Le reste des champs demeure modifiable.
    const renamed = await updateEvent(f.actorAlice, created.id, { title: "Fixes 2" });
    expect(renamed.title).toBe("Fixes 2");
  });

  it("un membre ne peut pas modifier l'événement personnel d'un autre", async () => {
    const created = await createEvent(f.actorAlice, eventInput("Privé"));
    await expect(updateEvent(f.actorBruno, created.id, { title: "Détournement" })).rejects.toThrow(
      CalendarError,
    );
    await expect(deleteEvent(f.actorBruno, created.id)).rejects.toThrow(CalendarError);
  });

  it("un agenda partagé est modifiable par les membres, sans franchir l'organisation", async () => {
    const shared = await createCalendar(f.actorAlice, { name: "Équipe", shared: true });
    const created = await createEvent(f.actorAlice, {
      ...eventInput("Réunion d'équipe"),
      calendarId: shared.id,
    });

    const updated = await updateEvent(f.actorBruno, created.id, { location: "Salle 2" });
    expect(updated.location).toBe("Salle 2");

    await expect(getEvent(f.actorChloe, created.id)).rejects.toThrow(CalendarError);
    const chloeList = await listEvents(f.actorChloe, { from: FROM, to: TO });
    expect(chloeList).toHaveLength(0);
  });

  it("refuse une réponse de quelqu'un qui n'est pas invité", async () => {
    const created = await createEvent(f.actorAlice, eventInput("Sans invité"));
    await expect(setAttendance(f.actorBruno, created.id, "accepted")).rejects.toThrow(
      CalendarError,
    );
  });
});

describe("calendar — récurrences", () => {
  it("développe une récurrence quotidienne dans la plage, aux bons jours", async () => {
    const created = await createEvent(f.actorAlice, {
      title: "Quotidien",
      startsAt: "2026-03-10T09:00:00.000Z",
      endsAt: "2026-03-10T10:00:00.000Z",
      recurrence: "daily",
      recurrenceUntil: "2026-03-14T23:59:59.000Z",
    });

    const list = await listEvents(f.actorAlice, { from: FROM, to: TO });
    expect(list.map((event) => event.startsAt)).toEqual([
      "2026-03-10T09:00:00.000Z",
      "2026-03-11T09:00:00.000Z",
      "2026-03-12T09:00:00.000Z",
      "2026-03-13T09:00:00.000Z",
      "2026-03-14T09:00:00.000Z",
    ]);
    expect(list.map((event) => event.endsAt)).toEqual([
      "2026-03-10T10:00:00.000Z",
      "2026-03-11T10:00:00.000Z",
      "2026-03-12T10:00:00.000Z",
      "2026-03-13T10:00:00.000Z",
      "2026-03-14T10:00:00.000Z",
    ]);
    // Chaque occurrence porte l'identifiant de la série (détail/clic intacts).
    expect(list.every((event) => event.id === created.id)).toBe(true);
    expect(list.every((event) => event.recurring && event.recurrence === "daily")).toBe(true);

    // Sous-plage lointaine : la première occurrence est trouvée par
    // arithmétique directe, sans énumérer les jours précédents.
    const sub = await listEvents(f.actorAlice, {
      from: "2026-03-12T00:00:00.000Z",
      to: "2026-03-13T00:00:00.000Z",
    });
    expect(sub.map((event) => event.startsAt)).toEqual(["2026-03-12T09:00:00.000Z"]);
  });

  it("développe une récurrence hebdomadaire à cheval sur deux mois", async () => {
    await createEvent(f.actorAlice, {
      title: "Hebdo",
      startsAt: "2026-03-28T14:00:00.000Z",
      endsAt: "2026-03-28T15:00:00.000Z",
      recurrence: "weekly",
      recurrenceUntil: "2026-04-30T23:59:59.000Z",
    });

    const list = await listEvents(f.actorAlice, {
      from: FROM,
      to: "2026-05-01T00:00:00.000Z",
    });
    expect(list.map((event) => event.startsAt)).toEqual([
      "2026-03-28T14:00:00.000Z",
      "2026-04-04T14:00:00.000Z",
      "2026-04-11T14:00:00.000Z",
      "2026-04-18T14:00:00.000Z",
      "2026-04-25T14:00:00.000Z",
    ]);
  });

  it("conserve le jour du mois (mensuel) et borne à la fin du mois", async () => {
    await createEvent(f.actorAlice, {
      title: "Mensuel",
      startsAt: "2026-01-31T10:00:00.000Z",
      endsAt: "2026-01-31T11:00:00.000Z",
      recurrence: "monthly",
      recurrenceUntil: "2026-05-31T23:59:59.000Z",
    });

    // Décision documentée : le 31 est BORNÉ (clampé) au dernier jour du mois
    // cible (février 2026 → 28), puis le jour d'origine (31) est réutilisé.
    const list = await listEvents(f.actorAlice, {
      from: "2026-01-01T00:00:00.000Z",
      to: "2026-06-30T00:00:00.000Z",
    });
    expect(list.map((event) => event.startsAt)).toEqual([
      "2026-01-31T10:00:00.000Z",
      "2026-02-28T10:00:00.000Z",
      "2026-03-31T10:00:00.000Z",
      "2026-04-30T10:00:00.000Z",
      "2026-05-31T10:00:00.000Z",
    ]);
  });

  it("respecte la fin de répétition et la valide", async () => {
    await createEvent(f.actorAlice, {
      ...eventInput("Bornée"),
      recurrence: "daily",
      recurrenceUntil: "2026-03-12T09:00:00.000Z",
    });

    const list = await listEvents(f.actorAlice, { from: FROM, to: TO });
    expect(list.map((event) => event.startsAt)).toEqual([
      "2026-03-10T09:00:00.000Z",
      "2026-03-11T09:00:00.000Z",
      "2026-03-12T09:00:00.000Z",
    ]);

    // Fin obligatoire dès qu'une répétition est choisie.
    await expect(
      createEvent(f.actorAlice, { ...eventInput("Sans fin"), recurrence: "weekly" }),
    ).rejects.toThrow("La date de fin de répétition est requise.");

    // Fin ≥ début.
    await expect(
      createEvent(f.actorAlice, {
        ...eventInput("Antérieure"),
        recurrence: "daily",
        recurrenceUntil: "2026-03-09T00:00:00.000Z",
      }),
    ).rejects.toThrow("La fin de répétition doit suivre le début.");

    // Fin ≤ début + 2 ans.
    await expect(
      createEvent(f.actorAlice, {
        ...eventInput("Trop longue"),
        recurrence: "daily",
        recurrenceUntil: "2029-01-01T00:00:00.000Z",
      }),
    ).rejects.toThrow("La répétition ne peut pas dépasser 2 ans.");
  });

  it("plafonne à 100 occurrences par événement et par requête", async () => {
    await createEvent(f.actorAlice, {
      title: "Plafond",
      startsAt: "2026-01-01T09:00:00.000Z",
      endsAt: "2026-01-01T10:00:00.000Z",
      recurrence: "daily",
      recurrenceUntil: "2026-12-31T23:59:59.000Z",
    });

    const list = await listEvents(f.actorAlice, {
      from: "2026-01-01T00:00:00.000Z",
      to: "2026-12-31T23:59:59.000Z",
    });
    expect(list).toHaveLength(100);
    expect(list[0]?.startsAt).toBe("2026-01-01T09:00:00.000Z");
    expect(list.at(-1)?.startsAt).toBe("2026-04-10T09:00:00.000Z");
  });

  it("applique un intervalle de deux semaines et le compte", async () => {
    const created = await createEvent(f.actorAlice, {
      title: "Toutes les deux semaines",
      startsAt: "2026-03-10T09:00:00.000Z",
      endsAt: "2026-03-10T10:00:00.000Z",
      recurrence: "weekly",
      recurrenceInterval: 2,
      recurrenceUntil: "2026-04-14T23:59:59.000Z",
    });
    expect(created.recurrenceInterval).toBe(2);

    const list = await listEvents(f.actorAlice, { from: FROM, to: "2026-05-01T00:00:00.000Z" });
    expect(list.map((event) => event.startsAt)).toEqual([
      "2026-03-10T09:00:00.000Z",
      "2026-03-24T09:00:00.000Z",
      "2026-04-07T09:00:00.000Z",
    ]);
  });

  it("applique un intervalle mensuel, avec bornage au dernier jour du mois", async () => {
    await createEvent(f.actorAlice, {
      title: "Tous les deux mois",
      startsAt: "2026-01-31T10:00:00.000Z",
      endsAt: "2026-01-31T11:00:00.000Z",
      recurrence: "monthly",
      recurrenceInterval: 2,
      recurrenceUntil: "2026-05-31T23:59:59.000Z",
    });

    const list = await listEvents(f.actorAlice, {
      from: "2026-01-01T00:00:00.000Z",
      to: "2026-06-30T00:00:00.000Z",
    });
    expect(list.map((event) => event.startsAt)).toEqual([
      "2026-01-31T10:00:00.000Z",
      "2026-03-31T10:00:00.000Z", // février est sauté
      "2026-05-31T10:00:00.000Z",
    ]);
  });

  it("ramène l'intervalle à 1 sans répétition et refuse un intervalle invalide", async () => {
    const simple = await createEvent(f.actorAlice, {
      ...eventInput("Sans répétition"),
      recurrence: "none",
      recurrenceInterval: 4,
    });
    expect(simple.recurrence).toBe("none");
    expect(simple.recurrenceInterval).toBe(1);

    await expect(
      createEvent(f.actorAlice, {
        ...eventInput("Intervalle invalide"),
        recurrence: "daily",
        recurrenceUntil: "2026-03-14T23:59:59.000Z",
        recurrenceInterval: 0,
      }),
    ).rejects.toThrow("L'intervalle de répétition doit être un nombre entier entre 1 et 52.");

    // Modifier l'intervalle modifie toute la série.
    const serie = await createEvent(f.actorAlice, {
      ...eventInput("Série"),
      recurrence: "daily",
      recurrenceInterval: 1,
      recurrenceUntil: "2026-03-20T23:59:59.000Z",
    });
    await updateEvent(f.actorAlice, serie.id, { recurrenceInterval: 3 });
    const list = await listEvents(f.actorAlice, { from: FROM, to: TO });
    expect(list.filter((event) => event.id === serie.id).map((event) => event.startsAt)).toEqual([
      "2026-03-10T09:00:00.000Z",
      "2026-03-13T09:00:00.000Z",
      "2026-03-16T09:00:00.000Z",
      "2026-03-19T09:00:00.000Z",
    ]);
  });

  it("laisse un événement simple intact et modifie toute la série", async () => {
    const simple = await createEvent(f.actorAlice, eventInput("Simple"));
    expect(simple.recurring).toBe(false);
    expect(simple.recurrence).toBe("none");
    expect(simple.recurrenceUntil).toBeNull();

    const recurring = await createEvent(f.actorAlice, {
      ...eventInput("Série"),
      recurrence: "daily",
      recurrenceUntil: "2026-03-14T23:59:59.000Z",
    });

    // Modifier la série change toutes ses occurrences (titre + fin raccourcie).
    await updateEvent(f.actorAlice, recurring.id, {
      title: "Série modifiée",
      recurrenceUntil: "2026-03-12T23:59:59.000Z",
    });

    const list = await listEvents(f.actorAlice, { from: FROM, to: TO });
    const simpleView = list.find((event) => event.id === simple.id);
    expect(simpleView?.recurring).toBe(false);
    expect(simpleView?.recurrence).toBe("none");

    const expanded = list.filter((event) => event.id === recurring.id);
    expect(expanded).toHaveLength(3); // 10, 11, 12 mars
    expect(expanded.every((event) => event.title === "Série modifiée")).toBe(true);
    expect(expanded.every((event) => event.recurring)).toBe(true);
    expect(expanded.at(-1)?.startsAt).toBe("2026-03-12T09:00:00.000Z");

    // Revenir à « aucune » replie la série sur une seule occurrence.
    const collapsed = await updateEvent(f.actorAlice, recurring.id, { recurrence: "none" });
    expect(collapsed.recurring).toBe(false);
    expect(collapsed.recurrenceUntil).toBeNull();
    const after = await listEvents(f.actorAlice, { from: FROM, to: TO });
    expect(after.filter((event) => event.id === recurring.id)).toHaveLength(1);
  });
});

describe("calendar — audit", () => {
  it("journalise l'agenda et le cycle de vie de l'événement", async () => {
    const calendar = await createCalendar(f.actorAlice, { name: "Audit" });
    const event = await createEvent(f.actorAlice, {
      ...eventInput("Audit"),
      calendarId: calendar.id,
    });
    await updateEvent(f.actorAlice, event.id, { title: "Audit modifié" });
    await deleteEvent(f.actorAlice, event.id);

    const rows = await getDb().select().from(auditEvents).where(eq(auditEvents.orgId, f.orgId));
    const byAction = new Map(rows.map((row) => [row.action, row]));

    expect(byAction.get("calendar.calendar.create")).toMatchObject({
      actorUserId: f.actorAlice.userId,
      resourceType: "calendar",
      resourceId: calendar.id,
      result: "success",
    });
    for (const action of [
      "calendar.event.create",
      "calendar.event.update",
      "calendar.event.delete",
    ]) {
      expect(byAction.get(action)).toMatchObject({
        actorUserId: f.actorAlice.userId,
        resourceType: "calendar_event",
        resourceId: event.id,
        result: "success",
      });
    }
  });

  it("ne journalise pas la réponse d'un invité (non notable)", async () => {
    const created = await createEvent(f.actorAlice, {
      ...eventInput("Réponse invitée"),
      attendees: [f.emailBruno],
    });

    const before = await countAuditRows(f.orgId);
    await setAttendance(f.actorBruno, created.id, "accepted");
    expect(await countAuditRows(f.orgId)).toBe(before);
  });
});
