import { describe, expect, it } from "vitest";
import { formatRelativeDate, groupRecent } from "../src/dashboard/dates.ts";

const NOW = new Date(2026, 9, 17, 15, 0, 0).getTime();
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const MIN = 60_000;
const DAY = 24 * 60 * MIN;

describe("dates relatives du tableau de bord", () => {
  it("formule les écarts courts puis longs", () => {
    expect(formatRelativeDate(ago(10_000), NOW)).toBe("à l'instant");
    expect(formatRelativeDate(ago(5 * MIN), NOW)).toBe("il y a 5 min");
    expect(formatRelativeDate(ago(3 * 60 * MIN), NOW)).toBe("il y a 3 h");
    expect(formatRelativeDate(ago(DAY), NOW)).toBe("hier");
    expect(formatRelativeDate(ago(3 * DAY), NOW)).toBe("il y a 3 jours");
    expect(formatRelativeDate(ago(400 * DAY), NOW)).toBe("il y a un an");
    expect(formatRelativeDate("pas une date", NOW)).toBe("date inconnue");
  });

  it("regroupe par fraîcheur et range les dates illisibles dans « Plus tôt »", () => {
    const groups = groupRecent(
      [
        { id: "a", updatedAt: ago(MIN) },
        { id: "b", updatedAt: ago(2 * DAY) },
        { id: "c", updatedAt: "??" },
      ],
      NOW,
    );
    expect(groups.map((g) => [g.id, g.entries.map((e) => e.id)])).toEqual([
      ["today", ["a"]],
      ["week", ["b"]],
      ["earlier", ["c"]],
    ]);
  });
});
