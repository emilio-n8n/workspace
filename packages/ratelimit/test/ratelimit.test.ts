import { describe, expect, it } from "vitest";
import { createRateLimiter } from "../src/index.ts";

describe("createRateLimiter — fenêtre fixe en mémoire", () => {
  it("autorise exactement `max` requêtes dans la fenêtre", () => {
    const limiter = createRateLimiter({ windowMs: 60_000, max: 3 });
    const now = 1_000;

    expect(limiter.check("ip:1", now)).toEqual({ allowed: true });
    expect(limiter.check("ip:1", now)).toEqual({ allowed: true });
    expect(limiter.check("ip:1", now)).toEqual({ allowed: true });
  });

  it("bloque au-delà du quota avec retryAfterSeconds arrondi au plafond", () => {
    const limiter = createRateLimiter({ windowMs: 10_000, max: 2 });

    // Fenêtre [0, 10 000[ : il reste 8 500 ms → 8,5 s arrondies à 9 s.
    const now = 1_500;
    expect(limiter.check("ip:1", now)).toEqual({ allowed: true });
    expect(limiter.check("ip:1", now)).toEqual({ allowed: true });
    expect(limiter.check("ip:1", now)).toEqual({ allowed: false, retryAfterSeconds: 9 });

    // Plus tard dans la même fenêtre, le délai restant diminue.
    expect(limiter.check("ip:1", 5_000)).toEqual({ allowed: false, retryAfterSeconds: 5 });
  });

  it("réinitialise le compteur à la fenêtre suivante", () => {
    const limiter = createRateLimiter({ windowMs: 1_000, max: 1 });

    expect(limiter.check("ip:1", 1_500)).toEqual({ allowed: true });
    // Dernier milliseconde de la fenêtre : au moins 1 s d'attente annoncée.
    expect(limiter.check("ip:1", 1_999)).toEqual({ allowed: false, retryAfterSeconds: 1 });
    // Nouvelle fenêtre [2 000, 3 000[ : le quota repart.
    expect(limiter.check("ip:1", 2_000)).toEqual({ allowed: true });
  });

  it("isole les clés les unes des autres", () => {
    const limiter = createRateLimiter({ windowMs: 60_000, max: 1 });

    expect(limiter.check("ip:1", 0)).toEqual({ allowed: true });
    expect(limiter.check("ip:1", 0)).toEqual({ allowed: false, retryAfterSeconds: 60 });
    // Le quota d'une autre IP n'est pas entamé.
    expect(limiter.check("ip:2", 0)).toEqual({ allowed: true });
  });

  it("élague les compteurs expirés quand la table dépasse 1 000 entrées", () => {
    const limiter = createRateLimiter({ windowMs: 1_000, max: 1 });

    // 1 500 IP distinctes dans la même fenêtre : la table dépasse le seuil.
    for (let i = 0; i < 1_500; i += 1) {
      expect(limiter.check(`ip:${i}`, 500)).toEqual({ allowed: true });
    }
    expect(limiter.size()).toBeGreaterThan(1_000);

    // Une fenêtre plus tard, les compteurs sont expirés : l'élagage paresseux
    // les supprime et la table redevient bornée.
    expect(limiter.check("ip:fresh", 3_000)).toEqual({ allowed: true });
    expect(limiter.size()).toBeLessThanOrEqual(1_000);
  });

  it("est déterministe avec un `now` injecté", () => {
    const sequence: Array<[string, number]> = [
      ["ip:1", 0],
      ["ip:1", 0],
      ["ip:1", 0],
      ["ip:2", 0],
      ["ip:1", 1_000],
    ];

    const run = () => {
      const limiter = createRateLimiter({ windowMs: 1_000, max: 2 });
      return sequence.map(([key, now]) => limiter.check(key, now));
    };

    const first = run();
    const second = run();
    expect(first).toEqual(second);
    expect(first).toEqual([
      { allowed: true },
      { allowed: true },
      { allowed: false, retryAfterSeconds: 1 },
      { allowed: true },
      { allowed: true },
    ]);
  });
});
