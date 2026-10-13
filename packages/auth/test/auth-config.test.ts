import { closeDb } from "@workspace/database";
import { afterAll, describe, expect, it } from "vitest";
import { auth, authRateLimitOptions } from "../src/auth";

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

  it("rate-limit : strict en production, permissif hors production (NAT partagé)", () => {
    const prod = authRateLimitOptions(true);
    expect(prod.customRules["/sign-in/email"]).toEqual({ window: 30, max: 3 });
    expect(prod.customRules["/sign-up/email"]).toEqual({ window: 30, max: 3 });
    expect(prod.max).toBe(100);
    expect(prod.window).toBe(60);

    // Les CI et les réseaux partagés ne doivent pas bloquer les inscriptions.
    const dev = authRateLimitOptions(false);
    expect(dev.customRules["/sign-up/email"].max).toBeGreaterThanOrEqual(100);
    expect(dev.max).toBeGreaterThanOrEqual(1000);
  });

  it("cookie de session : httpOnly et sameSite=lax", () => {
    const cookies = auth.options.advanced?.defaultCookieAttributes;
    expect(cookies?.httpOnly).toBe(true);
    expect(cookies?.sameSite).toBe("lax");
  });
});
