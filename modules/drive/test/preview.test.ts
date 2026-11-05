import { describe, expect, it } from "vitest";
import { isInlinePreviewSafe } from "../src/preview.ts";

describe("isInlinePreviewSafe", () => {
  it("autorise les images bitmap, le PDF, le texte brut et les médias", () => {
    expect(isInlinePreviewSafe("image/png")).toBe(true);
    expect(isInlinePreviewSafe("image/jpeg")).toBe(true);
    expect(isInlinePreviewSafe("application/pdf")).toBe(true);
    expect(isInlinePreviewSafe("text/plain")).toBe(true);
    expect(isInlinePreviewSafe("text/markdown")).toBe(true);
    expect(isInlinePreviewSafe("application/json")).toBe(true);
    expect(isInlinePreviewSafe("video/mp4")).toBe(true);
    expect(isInlinePreviewSafe("audio/mpeg")).toBe(true);
  });

  it("refuse HTML, SVG et les types inconnus", () => {
    expect(isInlinePreviewSafe("text/html")).toBe(false);
    expect(isInlinePreviewSafe("image/svg+xml")).toBe(false);
    expect(isInlinePreviewSafe("application/octet-stream")).toBe(false);
    expect(isInlinePreviewSafe(null)).toBe(false);
  });
});
