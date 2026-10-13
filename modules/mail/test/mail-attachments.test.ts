import { describe, expect, it } from "vitest";
import {
  ATTACHMENT_BUDGET_BYTES,
  attachmentStatusLabel,
  budgetLabel,
  budgetUsage,
  type ComposerAttachment,
  extractAttachmentName,
  formatFileSize,
  hasFailedUpload,
  isAttachmentTooLarge,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENT_SLOTS,
  oversizedMessage,
  progressBarProps,
  readProgress,
  readyAttachments,
  remainingSlots,
  tooManyMessage,
  usedBytes,
} from "../src/ui/attachments.ts";

function attachment(partial: Partial<ComposerAttachment> & { name: string }): ComposerAttachment {
  return {
    key: partial.name,
    sizeBytes: 1024,
    contentType: "text/plain",
    phase: "ready",
    loadedBytes: 1024,
    ...partial,
  };
}

describe("pièces jointes — extraction du nom", () => {
  it("ne garde que le dernier segment d'un chemin", () => {
    expect(extractAttachmentName("C:\\fakepath\\rapport.pdf")).toBe("rapport.pdf");
    expect(extractAttachmentName("/tmp/dossier/note finale.txt")).toBe("note finale.txt");
    expect(extractAttachmentName("dossier\\sous-dossier\\image.png")).toBe("image.png");
  });

  it("nettoie les espaces, les retours à la ligne et les points de fin", () => {
    expect(extractAttachmentName("  rapport\n  final .pdf  ")).toBe("rapport final .pdf");
    expect(extractAttachmentName("photo...")).toBe("photo");
    expect(extractAttachmentName("\tnotes\t")).toBe("notes");
  });

  it("renvoie une chaîne vide quand il ne reste rien d'exploitable", () => {
    expect(extractAttachmentName("")).toBe("");
    expect(extractAttachmentName("   ")).toBe("");
    expect(extractAttachmentName("C:\\fakepath\\")).toBe("");
    expect(extractAttachmentName("...")).toBe("");
  });

  it("tronque en conservant l'extension", () => {
    const long = `${"a".repeat(300)}.pdf`;
    const name = extractAttachmentName(long, 255);
    expect(name).toHaveLength(255);
    expect(name.endsWith(".pdf")).toBe(true);
  });
});

describe("pièces jointes — bornes et jauge", () => {
  it("formate les tailles en unités françaises", () => {
    expect(formatFileSize(0)).toBe("0 o");
    expect(formatFileSize(512)).toBe("512 o");
    expect(formatFileSize(2048)).toBe("2.0 Ko");
    expect(formatFileSize(5 * 1024 * 1024)).toBe("5.0 Mo");
  });

  it("applique la borne par fichier", () => {
    expect(isAttachmentTooLarge(MAX_ATTACHMENT_BYTES)).toBe(false);
    expect(isAttachmentTooLarge(MAX_ATTACHMENT_BYTES + 1)).toBe(true);
    expect(oversizedMessage("film.mp4")).toBe(
      `« film.mp4 » dépasse ${formatFileSize(MAX_ATTACHMENT_BYTES)}.`,
    );
  });

  it("compte les emplacements restants et refuse le surplus", () => {
    expect(remainingSlots([])).toBe(MAX_ATTACHMENT_SLOTS);
    const filled = Array.from({ length: MAX_ATTACHMENT_SLOTS }, (_, index) =>
      attachment({ name: `f${index}.txt` }),
    );
    expect(remainingSlots(filled)).toBe(0);
    expect(tooManyMessage(7, 2)).toBe(
      "5 pièces jointes au maximum (2 emplacements restants pour 7 fichiers).",
    );
    expect(tooManyMessage(2, 1)).toBe(
      "5 pièces jointes au maximum (1 emplacement restant pour 2 fichiers).",
    );
  });

  it("expose une jauge d'occupation de l'enveloppe", () => {
    expect(ATTACHMENT_BUDGET_BYTES).toBe(MAX_ATTACHMENT_SLOTS * MAX_ATTACHMENT_BYTES);
    expect(budgetUsage([])).toBe(0);
    const files = [
      attachment({ name: "a", sizeBytes: MAX_ATTACHMENT_BYTES }),
      attachment({ name: "b", sizeBytes: MAX_ATTACHMENT_BYTES }),
    ];
    expect(budgetUsage(files)).toBeCloseTo(0.4);
    expect(usedBytes(files)).toBe(2 * MAX_ATTACHMENT_BYTES);
    expect(budgetLabel(files)).toBe("2 fichiers · 20.0 Mo sur 50.0 Mo");
  });

  it("rend les barres de progression accessibles", () => {
    const bar = progressBarProps(0.42, "Avancement de a.txt");
    expect(bar).toEqual({
      role: "progressbar",
      "aria-label": "Avancement de a.txt",
      "aria-valuemin": 0,
      "aria-valuemax": 100,
      "aria-valuenow": 42,
    });
    expect(progressBarProps(2, "x")["aria-valuenow"]).toBe(100);
    expect(progressBarProps(-1, "x")["aria-valuenow"]).toBe(0);
  });

  it("suit la progression de lecture d'un fichier", () => {
    expect(readProgress(attachment({ name: "a", phase: "reading", loadedBytes: 256 }))).toBe(0.25);
    expect(readProgress(attachment({ name: "a", phase: "reading", loadedBytes: 2048 }))).toBe(1);
    expect(readProgress(attachment({ name: "a", phase: "ready" }))).toBe(1);
    expect(readProgress(attachment({ name: "a", phase: "error", loadedBytes: 0 }))).toBe(0);
  });
});

describe("pièces jointes — cycle de vie et reprise", () => {
  const token = {
    storageKey: "mail/org/id",
    filename: "a.txt",
    contentType: "text/plain",
    sizeBytes: 3,
  };

  it("ne considère prêtes que les pièces jointes téléversées", () => {
    const list = [
      attachment({ name: "a", token }),
      attachment({ name: "b", phase: "reading", loadedBytes: 0 }),
      attachment({ name: "c", phase: "uploading", loadedBytes: 512 }),
      attachment({ name: "d", phase: "error", error: "Échec" }),
    ];
    expect(readyAttachments(list).map((item) => item.name)).toEqual(["a"]);
    expect(hasFailedUpload(list)).toBe(true);
    expect(hasFailedUpload([attachment({ name: "a", token })])).toBe(false);
  });

  it("décrit chaque état en français", () => {
    expect(attachmentStatusLabel(attachment({ name: "a", phase: "reading", loadedBytes: 0 }))).toBe(
      "Lecture du fichier",
    );
    expect(
      attachmentStatusLabel(attachment({ name: "a", phase: "uploading", loadedBytes: 512 })),
    ).toBe("Téléversement");
    expect(attachmentStatusLabel(attachment({ name: "a", token }))).toBe("Prêt à être envoyé");
    expect(
      attachmentStatusLabel(
        attachment({ name: "a", phase: "error", error: "Lecture de « a » impossible" }),
      ),
    ).toBe("Lecture de « a » impossible");
  });
});
