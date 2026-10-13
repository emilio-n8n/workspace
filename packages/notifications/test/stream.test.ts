import { describe, expect, it, vi } from "vitest";
import { publishNotification, subscribeToNotifications } from "../src/index.ts";

/**
 * Bus temps réel (SSE en mémoire) : unitaire, sans base de données.
 * Le filtrage par couple (organisation, utilisateur) est le seul rempart
 * côté diffusion — il doit être strict.
 */
describe("notifications — bus temps réel", () => {
  it("ne notifie que les abonnés du couple (organisation, utilisateur)", () => {
    const alice = vi.fn();
    const bruno = vi.fn();
    const autreOrg = vi.fn();
    const offAlice = subscribeToNotifications({ orgId: "org-a", userId: "usr-alice" }, alice);
    const offBruno = subscribeToNotifications({ orgId: "org-a", userId: "usr-bruno" }, bruno);
    const offAutreOrg = subscribeToNotifications({ orgId: "org-b", userId: "usr-alice" }, autreOrg);

    const event = {
      orgId: "org-a",
      userId: "usr-alice",
      kind: "share" as const,
      title: "Nouveau partage",
      href: null,
    };
    publishNotification(event);

    expect(alice).toHaveBeenCalledOnce();
    expect(alice).toHaveBeenCalledWith(event);
    // Même organisation mais autre utilisateur : pas notifié.
    expect(bruno).not.toHaveBeenCalled();
    // Même utilisateur mais autre organisation : pas notifié.
    expect(autreOrg).not.toHaveBeenCalled();

    offAlice();
    offBruno();
    offAutreOrg();
  });

  it("retire le listener au désabonnement (publier ensuite ne déclenche rien)", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToNotifications({ orgId: "org-a", userId: "usr-alice" }, listener);

    unsubscribe();
    unsubscribe(); // Idempotent : un second appel ne casse rien.
    publishNotification({
      orgId: "org-a",
      userId: "usr-alice",
      kind: "system",
      title: "Après désabonnement",
      href: null,
    });

    expect(listener).not.toHaveBeenCalled();
  });
});
