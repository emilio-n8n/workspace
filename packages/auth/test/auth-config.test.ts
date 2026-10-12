import { closeDb } from "@workspace/database";
import { afterAll, describe, expect, it } from "vitest";
import { auth } from "../src/auth";

/**
 * Garde-fous de configuration : la politique de session et de limitation de
 * débit est explicite dans `auth.ts` et ne doit pas dériver silencieusement
 * (changement de version de better-auth ou édition involontaire).
 */
afterAll(async () => {
  await closeDb();
});

describe("configuration better-auth — session et limitation de débit", () => {
  it("session : 7 jours, rafraîchie une fois par jour, sans cache cookie", () => {
    const session = auth.options.session;
    expect(session?.expiresIn).toBe(60 * 60 * 24 * 7);
    expect(session?.updateAge).toBe(60 * 60 * 24);
    expect(session?.cookieCache?.enabled).toBe(false);
  });

  it("sign-in/sign-up par e-mail : 3 essais / 30 s (plus strict que le garde global)", () => {
    const rules = auth.options.rateLimit?.customRules;
    expect(rules?.["/sign-in/email"]).toEqual({ window: 30, max: 3 });
    expect(rules?.["/sign-up/email"]).toEqual({ window: 30, max: 3 });

    const globalMax = auth.options.rateLimit?.max ?? 0;
    const globalWindow = auth.options.rateLimit?.window ?? 0;
    expect(globalMax).toBe(100);
    expect(globalWindow).toBe(60);
  });

  it("cookie de session : httpOnly et sameSite=lax", () => {
    const cookies = auth.options.advanced?.defaultCookieAttributes;
    expect(cookies?.httpOnly).toBe(true);
    expect(cookies?.sameSite).toBe("lax");
  });
});
