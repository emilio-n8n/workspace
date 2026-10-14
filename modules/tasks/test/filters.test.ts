import { describe, expect, it } from "vitest";
import {
  activeFilters,
  DEFAULT_CRITERIA,
  describeFilterSummary,
  dueBucketOf,
  type FilterableTask,
  filterTasks,
  isFiltering,
  matchesQuery,
  normalizeQuery,
  type TaskFilterCriteria,
} from "../src/filters.ts";

/** Recherche et filtres combinés — aucune base requise. */

const NOW = new Date("2026-10-13T12:00:00.000Z");
const DAY = 86_400_000;
const HOUR = 3_600_000;

let counter = 0;

function task(overrides: Partial<FilterableTask> = {}): FilterableTask {
  counter += 1;
  return {
    id: `task-${counter}`,
    title: `Tâche ${counter}`,
    notes: null,
    status: "todo",
    dueAt: null,
    labels: [],
    ...overrides,
  };
}

function criteria(overrides: Partial<TaskFilterCriteria> = {}): TaskFilterCriteria {
  return { ...DEFAULT_CRITERIA, ...overrides };
}

function titles(rows: readonly FilterableTask[]): string[] {
  return rows.map((row) => row.title);
}

describe("tasks — recherche : texte", () => {
  it("normalise accents, casse et espaces", () => {
    expect(normalizeQuery("  École   Primaire ")).toBe("ecole primaire");
    expect(normalizeQuery("Ça")).toBe("ca");
  });

  it("cherche dans le titre et les notes", () => {
    const dossier = task({ title: "Relire le dossier", notes: "Vérifier la clause 4" });
    expect(matchesQuery(dossier, "dossier")).toBe(true);
    expect(matchesQuery(dossier, "clause")).toBe(true);
    expect(matchesQuery(dossier, "budget")).toBe(false);
  });

  it("ignore les accents trouvés des deux côtés", () => {
    const ecole = task({ title: "École primaire" });
    expect(matchesQuery(ecole, "ecole")).toBe(true);
    expect(matchesQuery(ecole, "école")).toBe(true);
  });

  it("exige tous les mots, dans n'importe quel ordre", () => {
    const row = task({ title: "Rapport client Alpha", notes: "Chiffres 2026" });
    expect(matchesQuery(row, "client rapport")).toBe(true);
    expect(matchesQuery(row, "client budget")).toBe(false);
    expect(matchesQuery(row, "2026")).toBe(true);
  });

  it("une recherche vide ne filtre rien", () => {
    const row = task();
    expect(matchesQuery(row, "")).toBe(true);
    expect(matchesQuery(row, "   ")).toBe(true);
  });
});

describe("tasks — filtres : critères combinés", () => {
  const rows = [
    task({
      title: "En retard",
      status: "todo",
      dueAt: new Date(NOW.getTime() - DAY).toISOString(),
    }),
    task({
      title: "Aujourd'hui",
      status: "in_progress",
      dueAt: new Date(NOW.getTime() + 2 * HOUR).toISOString(),
    }),
    task({
      title: "Cette semaine",
      status: "todo",
      dueAt: new Date(NOW.getTime() + 3 * DAY).toISOString(),
    }),
    task({ title: "Sans échéance", status: "done", dueAt: null }),
    task({ title: "Étiquetée", status: "todo", labels: [{ id: "l1", name: "Urgent" }] }),
  ];

  it("sans critère, tout passe", () => {
    expect(filterTasks(rows, criteria())).toHaveLength(rows.length);
    expect(isFiltering(DEFAULT_CRITERIA)).toBe(false);
  });

  it("filtre par état", () => {
    expect(titles(filterTasks(rows, criteria({ status: "todo" })))).toEqual([
      "En retard",
      "Cette semaine",
      "Étiquetée",
    ]);
    expect(titles(filterTasks(rows, criteria({ status: "done" })))).toEqual(["Sans échéance"]);
  });

  it("filtre par échéance, jamais les terminées en retard", () => {
    expect(titles(filterTasks(rows, criteria({ due: "overdue" }), NOW))).toEqual(["En retard"]);
    expect(titles(filterTasks(rows, criteria({ due: "today" }), NOW))).toEqual(["Aujourd'hui"]);
    expect(titles(filterTasks(rows, criteria({ due: "week" }), NOW))).toEqual([
      "Aujourd'hui",
      "Cette semaine",
    ]);
    expect(titles(filterTasks(rows, criteria({ due: "none" }), NOW))).toEqual([
      "Sans échéance",
      "Étiquetée",
    ]);
  });

  it("combine état et échéance", () => {
    expect(titles(filterTasks(rows, criteria({ status: "todo", due: "overdue" }), NOW))).toEqual([
      "En retard",
    ]);
    expect(filterTasks(rows, criteria({ status: "done", due: "overdue" }), NOW)).toHaveLength(0);
  });

  it("filtre par étiquettes, en ET", () => {
    const labelled = [
      task({ title: "Deux étiquettes", labels: [{ id: "l1" }, { id: "l2" }] }),
      task({ title: "Une étiquette", labels: [{ id: "l1" }] }),
      task({ title: "Autre", labels: [{ id: "l2" }] }),
      task({ title: "Aucune", labels: [] }),
    ];

    expect(titles(filterTasks(labelled, criteria({ labelIds: ["l1"] })))).toEqual([
      "Deux étiquettes",
      "Une étiquette",
    ]);
    expect(titles(filterTasks(labelled, criteria({ labelIds: ["l1", "l2"] })))).toEqual([
      "Deux étiquettes",
    ]);
    expect(titles(filterTasks(labelled, criteria({ labelIds: ["l3"] })))).toEqual([]);
  });

  it("combine texte, état, échéance et étiquettes", () => {
    expect(
      titles(
        filterTasks(
          rows,
          criteria({ query: "cette", status: "todo", due: "week", labelIds: [] }),
          NOW,
        ),
      ),
    ).toEqual(["Cette semaine"]);
    expect(
      filterTasks(rows, criteria({ query: "cette", status: "done", due: "week" }), NOW),
    ).toHaveLength(0);
  });

  it("conserve l'ordre d'entrée", () => {
    const filtered = filterTasks(rows, criteria({ status: "todo" }), NOW);
    expect(filtered.map((row) => row.id)).toEqual(
      rows.filter((row) => row.status === "todo").map((row) => row.id),
    );
  });
});

describe("tasks — filtres : panneaux d'échéance", () => {
  it("classe today, week, later, none et overdue", () => {
    expect(dueBucketOf(task({ dueAt: new Date(NOW.getTime() - HOUR).toISOString() }), NOW)).toBe(
      "overdue",
    );
    expect(dueBucketOf(task({ dueAt: new Date(NOW.getTime() + HOUR).toISOString() }), NOW)).toBe(
      "today",
    );
    expect(dueBucketOf(task({ dueAt: new Date(NOW.getTime() + 3 * DAY).toISOString() }), NOW)).toBe(
      "week",
    );
    expect(
      dueBucketOf(task({ dueAt: new Date(NOW.getTime() + 20 * DAY).toISOString() }), NOW),
    ).toBe("later");
    expect(dueBucketOf(task({ dueAt: null }), NOW)).toBe("none");
  });
});

describe("tasks — filtres : puces et annonces", () => {
  it("liste les filtres actifs avec les noms d'étiquettes", () => {
    const names = new Map([["l1", "Urgent"]]);
    expect(activeFilters(criteria(), names)).toEqual([]);
    expect(
      activeFilters(criteria({ query: "rapport", status: "todo", labelIds: ["l1", "l2"] }), names),
    ).toEqual([
      { id: "query", label: "« rapport »" },
      { id: "status", label: "À faire" },
      { id: "label:l1", label: "Urgent" },
      { id: "label:l2", label: "Étiquette" },
    ]);
    expect(activeFilters(criteria({ due: "overdue" }))).toEqual([
      { id: "due", label: "En retard" },
    ]);
  });

  it("résume la vue pour lecteur d'écran", () => {
    expect(describeFilterSummary({ shown: 5, total: 5, criteria: criteria() })).toBe(
      "5 tâches affichées.",
    );
    expect(
      describeFilterSummary({ shown: 2, total: 9, criteria: criteria({ status: "done" }) }),
    ).toBe("2 tâches affichées sur 9 — terminées.");
    expect(
      describeFilterSummary({ shown: 1, total: 9, criteria: criteria({ due: "today" }) }),
    ).toBe("1 tâche affichée sur 9 — échéance : aujourd'hui.");
  });

  it("signale dès qu'un critère est posé", () => {
    expect(isFiltering(criteria({ query: " " }))).toBe(false);
    expect(isFiltering(criteria({ query: "a" }))).toBe(true);
    expect(isFiltering(criteria({ labelIds: ["l1"] }))).toBe(true);
  });
});
