import { describe, expect, it } from "vitest";
import {
  moveSubtaskIds,
  nextSubtaskPosition,
  parentStatusAfterSubtaskChange,
  progressLabel,
  SUBTASKS_MAX,
  type SubtaskLike,
  sortSubtasks,
  subtaskProgress,
} from "../src/subtasks.ts";

/** Sous-tâches — progression, ordre et règle de la tâche parente. */

let counter = 0;

function subtask(overrides: Partial<SubtaskLike> = {}): SubtaskLike {
  counter += 1;
  return {
    id: `sub-${counter}`,
    title: `Sous-tâche ${counter}`,
    isDone: false,
    position: counter - 1,
    ...overrides,
  };
}

function ids(rows: readonly SubtaskLike[]): string[] {
  return rows.map((row) => row.id);
}

describe("tasks — sous-tâches : ordre", () => {
  it("trie par position, l'identifiant en départage", () => {
    const first = subtask({ position: 0 });
    const second = subtask({ position: 1 });
    const third = subtask({ position: 1 });
    // Même position : l'identifiant (uuidv7, ordonné) tranche.
    expect(ids(sortSubtasks([third, first, second]))).toEqual([first.id, second.id, third.id]);
  });

  it("place la prochaine sous-tâche en fin de liste, sans trou", () => {
    expect(nextSubtaskPosition([])).toBe(0);
    expect(nextSubtaskPosition([subtask({ position: 0 }), subtask({ position: 2 })])).toBe(3);
  });

  it("décale d'un cran et refuse les bornes", () => {
    const a = subtask({ position: 0 });
    const b = subtask({ position: 1 });
    const c = subtask({ position: 2 });
    const list = [a, b, c];

    expect(moveSubtaskIds(ids(list), 2, 0)).toEqual([c.id, a.id, b.id]);
    expect(moveSubtaskIds(ids(list), 0, 2)).toEqual([b.id, c.id, a.id]);
    expect(moveSubtaskIds(ids(list), 1, 1)).toEqual([a.id, b.id, c.id]);

    expect(moveSubtaskIds(ids(list), 0, 3)).toBeNull();
    expect(moveSubtaskIds(ids(list), -1, 1)).toBeNull();
    expect(moveSubtaskIds(ids(list), 1.5, 2)).toBeNull();
  });

  it("ne modifie pas le tableau d'entrée", () => {
    const rows = [subtask({ position: 0 }), subtask({ position: 1 })];
    const source = ids(rows);
    moveSubtaskIds(source, 0, 1);
    expect(source).toEqual(ids(rows));
  });
});

describe("tasks — sous-tâches : progression", () => {
  it("compte les faites, détecte l'achèvement et libelle en français", () => {
    const none = subtaskProgress([]);
    expect(none).toEqual({ done: 0, total: 0, complete: false });
    expect(progressLabel(none)).toBe("Aucune sous-tâche");

    const one = subtaskProgress([subtask({ isDone: true })]);
    expect(one.complete).toBe(true);
    expect(progressLabel(one)).toBe("1 sous-tâche terminée sur 1");

    const partial = subtaskProgress([subtask({ isDone: true }), subtask(), subtask()]);
    expect(partial).toEqual({ done: 1, total: 3, complete: false });
    expect(progressLabel(partial)).toBe("1 sous-tâche terminée sur 3");

    const all = subtaskProgress([subtask({ isDone: true }), subtask({ isDone: true })]);
    expect(all.complete).toBe(true);
    expect(progressLabel(all)).toBe("2 sous-tâches terminées sur 2");
  });

  it("laisse la borne de sous-tâches cohérente avec le message d'erreur", () => {
    expect(SUBTASKS_MAX).toBeGreaterThan(1);
    expect(Number.isInteger(SUBTASKS_MAX)).toBe(true);
  });
});

describe("tasks — sous-tâches : synchronisation du parent", () => {
  const rows = [subtask({ isDone: true }), subtask({ isDone: true })];

  it("termine la tâche parente quand tout est fait", () => {
    const next = parentStatusAfterSubtaskChange({ parentStatus: "todo", subtasks: rows });
    expect(next).toEqual({ status: "done", changed: true });
  });

  it("rouvre la tâche parente quand une sous-tâche est décochée", () => {
    const next = parentStatusAfterSubtaskChange({
      parentStatus: "done",
      subtasks: [...rows, subtask({ isDone: false })],
    });
    expect(next).toEqual({ status: "todo", changed: true });
  });

  it("ne touche pas au parent quand rien ne change", () => {
    expect(
      parentStatusAfterSubtaskChange({
        parentStatus: "todo",
        subtasks: [subtask({ isDone: true }), subtask()],
      }),
    ).toEqual({ status: "todo", changed: false });
    expect(parentStatusAfterSubtaskChange({ parentStatus: "todo", subtasks: [] })).toEqual({
      status: "todo",
      changed: false,
    });
    // Une tâche volontairement terminée sans sous-tâche le reste.
    expect(parentStatusAfterSubtaskChange({ parentStatus: "done", subtasks: [subtask()] })).toEqual(
      { status: "todo", changed: true },
    );
  });
});
