import { describe, expect, it } from "vitest";
import {
  ATTACHMENTS_DRAFT_NOTICE,
  AUTOSAVE_DELAY_MS,
  autosaveLabel,
  type DraftContent,
  formatClock,
  hasDraftContent,
  shouldAutosave,
} from "../src/ui/autosave.ts";
import {
  addressesToChips,
  chipRemoveLabel,
  chipsToAddresses,
  countRecipients,
  inputToChips,
  isValidRecipient,
  MAX_RECIPIENT_CHIPS,
  normalizeRecipient,
  parseRecipientInput,
  type RecipientChip,
  removeLastChip,
} from "../src/ui/recipients.ts";
import {
  quoteOriginal,
  replyAllCopies,
  replyAllRecipients,
  replySubject,
} from "../src/ui/reply.ts";

const emptyDraft: DraftContent = { to: [], cc: [], bcc: [], subject: "", body: "" };

function draft(partial: Partial<DraftContent>): DraftContent {
  return { ...emptyDraft, ...partial };
}

describe("composition — destinataires en puces", () => {
  it("découpe une saisie collée sur tous les séparateurs", () => {
    expect(parseRecipientInput(" a@x.org , b@x.org; c@x.org\n d@x.org  ")).toEqual([
      "a@x.org",
      "b@x.org",
      "c@x.org",
      "d@x.org",
    ]);
    expect(parseRecipientInput("   ")).toEqual([]);
  });

  it("reconnaît une adresse valide et refuse les formes incomplètes", () => {
    expect(isValidRecipient("prenom.nom@exemple.org")).toBe(true);
    expect(isValidRecipient(" P@X.FR ")).toBe(true);
    expect(isValidRecipient("pas-un-email")).toBe(false);
    expect(isValidRecipient("sans@point")).toBe(false);
    expect(isValidRecipient("deux mots@x.org")).toBe(false);
    expect(isValidRecipient("")).toBe(false);
  });

  it("transforme la saisie en puces et normalise les adresses", () => {
    const result = inputToChips("Alice@Exemple.ORG, bruno@exemple.org", []);
    expect(result.rest).toBe("");
    expect(result.chips.map((chip) => chip.value)).toEqual([
      "alice@exemple.org",
      "bruno@exemple.org",
    ]);
    expect(result.chips[0]?.label).toBe("Alice@Exemple.ORG");
  });

  it("absorbe les doublons sans jamais les perdre en double", () => {
    const existing: RecipientChip[] = [{ value: "a@x.org", label: "a@x.org" }];
    expect(inputToChips("A@X.ORG, a@x.org", existing).chips).toHaveLength(1);
    expect(inputToChips("b@x.org, b@x.org, c@x.org", []).chips).toHaveLength(2);
  });

  it("rend les adresses invalides au champ au lieu de les jeter", () => {
    const result = inputToChips("bon@x.org, cassee, autre@x.org", []);
    expect(result.rest).toBe("cassee");
    expect(result.chips.map((chip) => chip.value)).toEqual(["bon@x.org", "autre@x.org"]);
  });

  it("refuse au-delà de la borne et renvoie l'excédent dans le champ", () => {
    const existing: RecipientChip[] = Array.from({ length: MAX_RECIPIENT_CHIPS }, (_, index) => ({
      value: `p${index}@x.org`,
      label: `p${index}@x.org`,
    }));
    const result = inputToChips("nouveau@x.org", existing);
    expect(result.chips).toHaveLength(MAX_RECIPIENT_CHIPS);
    expect(result.rest).toBe("nouveau@x.org");
  });

  it("compte les destinataires distincts sur les trois champs", () => {
    const lists = {
      to: [{ value: "a@x.org", label: "a@x.org" }],
      cc: [{ value: "b@x.org", label: "b@x.org" }],
      bcc: [{ value: "a@x.org", label: "a@x.org" }],
    };
    expect(countRecipients(lists)).toBe(2);
    // La saisie en cours compte aussi, sinon la borne se contourne.
    expect(countRecipients(lists, "c@x.org, cassee")).toBe(3);
  });

  it("convertit puces et adresses dans les deux sens", () => {
    const chips = addressesToChips(["A@X.org", " b@x.org "]);
    expect(chipsToAddresses(chips)).toEqual(["a@x.org", "b@x.org"]);
    expect(addressesToChips(undefined)).toEqual([]);
    expect(normalizeRecipient("  Mixte@Exemple.ORG ")).toBe("mixte@exemple.org");
  });

  it("retire la dernière puce sur Effacement dans un champ vide", () => {
    const chips = addressesToChips(["a@x.org", "b@x.org"]);
    expect(chipsToAddresses(removeLastChip(chips))).toEqual(["a@x.org"]);
    expect(removeLastChip([])).toEqual([]);
  });

  it("nomme les boutons de retrait par champ", () => {
    const chip: RecipientChip = { value: "a@x.org", label: "a@x.org" };
    expect(chipRemoveLabel(chip, "to")).toBe("Retirer a@x.org (destinataire)");
    expect(chipRemoveLabel(chip, "bcc")).toBe("Retirer a@x.org (copie cachée)");
  });
});

describe("composition — réponse et citation", () => {
  it("n'empile jamais les préfixes Re:", () => {
    expect(replySubject("Bonjour")).toBe("Re: Bonjour");
    expect(replySubject("Re: Bonjour")).toBe("Re: Bonjour");
    expect(replySubject("re : Bonjour")).toBe("re : Bonjour");
    expect(replySubject("RE:  Bonjour")).toBe("RE:  Bonjour");
    expect(replySubject("  ")).toBe("Re:");
  });

  it("cite le message d'origine avec attribution", () => {
    const quoted = quoteOriginal({
      fromName: "Alice",
      fromAddress: "alice@exemple.org",
      body: "Première ligne\n\nDeuxième ligne",
    });
    expect(quoted).toBe("\n\n— Alice a écrit :\n> Première ligne\n>\n> Deuxième ligne");
  });

  it("retombe sur l'adresse quand l'expéditeur n'a pas de nom", () => {
    expect(quoteOriginal({ fromAddress: "alice@exemple.org", body: " salut " })).toContain(
      "— alice@exemple.org a écrit :",
    );
  });

  it("répond à tous sans se compter deux fois", () => {
    const recipients = replyAllRecipients({
      fromAddress: "Alice@exemple.org",
      toAddresses: ["moi@exemple.org", "bruno@exemple.org"],
      ccAddresses: ["chloe@exemple.org"],
      responder: "moi@exemple.org",
    });
    expect(recipients).toEqual(["alice@exemple.org", "bruno@exemple.org", "chloe@exemple.org"]);
    expect(
      replyAllCopies({
        ccAddresses: ["Chloe@exemple.org", "chloe@exemple.org"],
        responder: "moi@exemple.org",
      }),
    ).toEqual(["chloe@exemple.org"]);
  });
});

describe("composition — brouillon automatique", () => {
  it("attend une pause de frappe avant d'enregistrer", () => {
    expect(AUTOSAVE_DELAY_MS).toBeGreaterThanOrEqual(1000);
    expect(AUTOSAVE_DELAY_MS).toBeLessThanOrEqual(3000);
  });

  it("n'enregistre jamais un compositeur vide", () => {
    expect(hasDraftContent(emptyDraft)).toBe(false);
    expect(hasDraftContent(draft({ subject: "   " }))).toBe(false);
    expect(hasDraftContent(draft({ body: "brouillon" }))).toBe(true);
    expect(hasDraftContent(draft({ to: ["a@x.org"] }))).toBe(true);
  });

  it("ne décide rien tant que la saisie n'a pas changé", () => {
    const base = {
      draft: draft({ subject: "Objet" }),
      saving: false,
      lastSavedAt: null,
      now: 10_000,
    };
    expect(shouldAutosave({ ...base, dirty: false })).toBe(false);
    expect(shouldAutosave({ ...base, dirty: true })).toBe(true);
    expect(shouldAutosave({ ...base, dirty: true, saving: true })).toBe(false);
  });

  it("espace les enregistrements et attend la fin des téléversements", () => {
    const base = {
      draft: draft({ subject: "Objet" }),
      dirty: true,
      saving: false,
      now: 10_000,
    };
    expect(shouldAutosave({ ...base, lastSavedAt: 9_000 })).toBe(false);
    expect(shouldAutosave({ ...base, lastSavedAt: 9_000, uploading: true })).toBe(false);
    expect(shouldAutosave({ ...base, lastSavedAt: 1_000 })).toBe(true);
  });

  it("dit à l'utilisateur où en est le brouillon", () => {
    expect(autosaveLabel("idle", null)).toBeNull();
    expect(autosaveLabel("pending", null)).toContain("Enregistrement");
    const saved = new Date(2026, 0, 2, 14, 5);
    expect(formatClock(saved)).toBe("14:05");
    expect(autosaveLabel("saved", saved)).toBe("Brouillon enregistré à 14:05");
    expect(autosaveLabel("error", null)).toContain("Enregistrer en brouillon");
  });

  it("prévient que les pièces jointes voyagent avec l'envoi", () => {
    expect(ATTACHMENTS_DRAFT_NOTICE).toContain("pièces jointes");
  });
});
