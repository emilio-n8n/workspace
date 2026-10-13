import { describe, expect, it } from "vitest";
import {
  describeView,
  groupTasks,
  type OrderableTask,
  sortTasks,
  TASK_GROUPS,
  TASK_SORTS,
} from "../src/organize.ts";

/**
 * Tri et regroupement — logique pure, testée sans base de données.
 * `now` est figé pour que les bornes de la semaine soient déterministes.
 */

const NOW = new Date("2026-10-13T12:00:00.000Z");
const HOUR = 3_600_000;
const DAY = 86_400_000;

let counter = 0;

function task(overrides: Partial<OrderableTask> = {}): OrderableTask {
  counter += 1;
  return {
    id: `task-${counter}`,
    title: `Tâche ${counter}`,
    status: "todo",
    priority: "medium",
    dueAt: null,
    createdAt: new Date(NOW.getTime() - counter * HOUR).toISOString(),
    ...overrides,
  };
}

function ids(rows: readonly OrderableTask[]): string[] {
  return rows.map((row) => row.id);
}

describe("tasks — tri (organize)", () => {
  it("place les tâches terminées en dernier, quel que soit l'ordre", () => {
    const pending = task({ title: "À faire" });
    const done = task({ title: "Terminée", status: "done", priority: "high" });

    for (const option of TASK_SORTS) {
      const rows = sortTasks([done, pending], option.id);
      expect(ids(rows)).toEqual([pending.id, done.id]);
    }
  });

  it("trie par échéance : retards d'abord, échéances absentes en dernier", () => {
    const later = task({ dueAt: new Date(NOW.getTime() + 5 * DAY).toISOString() });
    const none = task({ dueAt: null });
    const overdue = task({ dueAt: new Date(NOW.getTime() - 2 * DAY).toISOString() });
    const soon = task({ dueAt: new Date(NOW.getTime() + DAY).toISOString() });

    const rows = sortTasks([later, none, overdue, soon], "due");
    expect(ids(rows)).toEqual([overdue.id, soon.id, later.id, none.id]);
  });

  it("trie par priorité décroissante, puis par échéance", () => {
    const low = task({ priority: "low" });
    const highSoon = task({
      priority: "high",
      dueAt: new Date(NOW.getTime() + DAY).toISOString(),
    });
    const highLate = task({
      priority: "high",
      dueAt: new Date(NOW.getTime() + 5 * DAY).toISOString(),
    });

    const rows = sortTasks([low, highLate, highSoon], "priority");
    expect(ids(rows)).toEqual([highSoon.id, highLate.id, low.id]);
  });

  it("trie par ordre alphabétique français en respectant les accents", () => {
    const zebre = task({ title: "Zèbre" });
    const ecole = task({ title: "École" });
    const pomme = task({ title: "Pomme" });

    const rows = sortTasks([zebre, pomme, ecole], "alpha");
    expect(rows.map((row) => row.title)).toEqual(["École", "Pomme", "Zèbre"]);
  });

  it("trie par ajout récent, puis par échéance", () => {
    const older = task({ createdAt: new Date(NOW.getTime() - 10 * DAY).toISOString() });
    const newer = task({ createdAt: new Date(NOW.getTime() - HOUR).toISOString() });
    const newest = task({ createdAt: new Date(NOW.getTime()).toISOString() });

    const rows = sortTasks([older, newest, newer], "created");
    expect(ids(rows)).toEqual([newest.id, newer.id, older.id]);
  });

  it("conserve l'ordre reçu pour « manual » et ne modifie pas le tableau d'entrée", () => {
    const first = task({ priority: "low" });
    const second = task({ priority: "high" });
    const source = [first, second];

    const rows = sortTasks(source, "manual");
    expect(ids(rows)).toEqual([first.id, second.id]);
    expect(ids(source)).toEqual([first.id, second.id]);
  });

  it("traite une priorité inconnue comme moyenne", () => {
    const unknown = task({ priority: "inconnue" });
    const low = task({ priority: "low" });
    const high = task({ priority: "high" });

    const rows = sortTasks([unknown, high, low], "priority");
    expect(ids(rows)).toEqual([high.id, unknown.id, low.id]);
  });
});

describe("tasks — regroupement (organize)", () => {
  it("regroupe par échéance avec les bornes françaises et omet les groupes vides", () => {
    const overdue = task({ dueAt: new Date(NOW.getTime() - HOUR).toISOString() });
    const today = task({ dueAt: new Date(NOW.getTime() + 2 * HOUR).toISOString() });
    const thisWeek = task({ dueAt: new Date(NOW.getTime() + 3 * DAY).toISOString() });
    const later = task({ dueAt: new Date(NOW.getTime() + 20 * DAY).toISOString() });
    const none = task({ dueAt: null });

    const groups = groupTasks([later, none, today, overdue, thisWeek], "due", NOW);
    expect(groups.map((group) => group.id)).toEqual(["overdue", "today", "week", "later", "none"]);
    expect(groups.map((group) => group.label)).toEqual([
      "En retard",
      "Aujourd'hui",
      "Cette semaine",
      "Plus tard",
      "Sans échéance",
    ]);
    expect(ids(groups[0]?.tasks ?? [])).toEqual([overdue.id]);
    expect(ids(groups[2]?.tasks ?? [])).toEqual([thisWeek.id]);
  });

  it("isole toujours les tâches terminées dans un dernier groupe", () => {
    const doneOverdue = task({
      status: "done",
      dueAt: new Date(NOW.getTime() - 3 * DAY).toISOString(),
    });
    const pending = task({ dueAt: new Date(NOW.getTime() - DAY).toISOString() });

    const groups = groupTasks([doneOverdue, pending], "due", NOW);
    expect(groups.map((group) => group.id)).toEqual(["overdue", "done"]);
    expect(groups.at(-1)?.label).toBe("Terminées");
    expect(ids(groups[1]?.tasks ?? [])).toEqual([doneOverdue.id]);
  });

  it("regroupe par priorité décroissante", () => {
    const low = task({ priority: "low" });
    const high = task({ priority: "high" });
    const medium = task({ priority: "medium" });

    const groups = groupTasks([low, medium, high], "priority", NOW);
    expect(groups.map((group) => group.id)).toEqual(["high", "medium", "low"]);
    // Les libellés sont en français : jamais les identifiants techniques.
    expect(groups.map((group) => group.label)).toEqual([
      "Priorité haute",
      "Priorité moyenne",
      "Priorité basse",
    ]);
    expect(ids(groups[0]?.tasks ?? [])).toEqual([high.id]);
  });

  it("regroupe par liste, par ordre alphabétique, avec un groupe de repli", () => {
    const alpha = task({ listName: "Alpha" });
    const zulu = task({ listName: "Zulu" });
    const orphan = task({ listName: "" });

    const groups = groupTasks([zulu, orphan, alpha], "list", NOW);
    expect(groups.map((group) => group.label)).toEqual(["Alpha", "Zulu", "Autres listes"]);
    expect(ids(groups[0]?.tasks ?? [])).toEqual([alpha.id]);
  });

  it("laisse le choix des regroupements cohérent avec les identifiants gérés", () => {
    const managed = new Set(["none", "due", "priority", "list"]);
    expect(TASK_GROUPS.map((option) => option.id).every((id) => managed.has(id))).toBe(true);
  });
});

describe("tasks — annonces (organize)", () => {
  it("résume la vue en français, au singulier comme au pluriel", () => {
    expect(describeView({ total: 1, shown: 1, sort: "due", group: "none" })).toBe(
      "1 tâche affichée, tri : échéance.",
    );
    expect(describeView({ total: 9, shown: 4, sort: "priority", group: "due" })).toBe(
      "4 tâches affichées sur 9, tri : priorité, regroupement : par échéance.",
    );
    expect(describeView({ total: 9, shown: 9, sort: "manual", group: "list" })).toBe(
      "9 tâches affichées, regroupement : par liste.",
    );
  });
});
