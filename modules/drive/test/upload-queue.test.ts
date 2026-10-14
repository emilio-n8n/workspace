import { describe, expect, it } from "vitest";
import {
  clearFinishedUploads,
  enqueueUploads,
  failedUploadCount,
  markUploaded,
  markUploadFailed,
  markUploading,
  pendingUploadIds,
  retryLabel,
  type UploadItem,
  uploadSummary,
} from "../src/ui/upload-queue.ts";

function file(id: string, extra: Partial<UploadItem> = {}): UploadItem {
  return { id, name: `${id}.txt`, status: "pending", ...extra };
}

describe("upload-queue — mise en file", () => {
  it("ajoute les fichiers en attente", () => {
    const state = enqueueUploads([], [file("a"), file("b")]);
    expect(state.map((item) => item.id)).toEqual(["a", "b"]);
    expect(state.every((item) => item.status === "pending")).toBe(true);
  });

  it("conserve l'ordre des fichiers déjà présents", () => {
    const first = enqueueUploads([], [file("a"), file("b")]);
    const second = enqueueUploads(first, [file("c")]);
    expect(second.map((item) => item.id)).toEqual(["a", "b", "c"]);
  });

  it("remet un fichier déjà connu dans la file à zéro", () => {
    const withError = markUploadFailed(enqueueUploads([], [file("a")]), "a", "Trop volumineux");
    const again = enqueueUploads(withError, [file("b")]);
    const retried = enqueueUploads(again, [file("a")]);

    expect(retried.find((item) => item.id === "a")).toMatchObject({
      status: "pending",
      message: undefined,
    });
  });

  it("n'ajoute rien si la liste est vide", () => {
    expect(enqueueUploads([], [])).toEqual([]);
  });
});

describe("upload-queue — cycle de vie d'un envoi", () => {
  it("passe de l'attente à l'envoi puis à l'envoi terminé", () => {
    let state = enqueueUploads([], [file("a"), file("b")]);
    state = markUploading(state, ["a"]);
    expect(state.find((item) => item.id === "a")?.status).toBe("uploading");
    expect(state.find((item) => item.id === "b")?.status).toBe("pending");

    state = markUploaded(state, "a");
    expect(state.find((item) => item.id === "a")).toMatchObject({
      status: "done",
      message: undefined,
    });
  });

  it("efface l'erreur d'un fichier qui repart", () => {
    let state = markUploadFailed(enqueueUploads([], [file("a")]), "a", "Coupure");
    expect(state[0]?.status).toBe("error");
    state = markUploading(state, ["a"]);
    expect(state[0]?.message).toBeUndefined();
  });

  it("relève un échec avec son message", () => {
    const state = markUploadFailed(enqueueUploads([], [file("a")]), "a", "Quota atteint.");
    expect(state[0]).toMatchObject({ status: "error", message: "Quota atteint." });
  });

  it("remplace un message vide par le message par défaut", () => {
    const state = markUploadFailed(enqueueUploads([], [file("a")]), "a", "   ");
    expect(state[0]?.message).toBe("Échec de l'envoi.");
  });

  it("ne touche pas aux autres fichiers", () => {
    const state = markUploadFailed(enqueueUploads([], [file("a"), file("b")]), "a", "Refusé");
    expect(state[1]).toMatchObject({ status: "pending", message: undefined });
  });

  it("ne modifie pas l'état reçu", () => {
    const source = enqueueUploads([], [file("a")]);
    markUploaded(source, "a");
    expect(source[0]?.status).toBe("pending");
  });
});

describe("upload-queue — ce qu'il reste à faire", () => {
  it("recense les fichiers à relancer (attente et échec)", () => {
    let state = enqueueUploads([], [file("a"), file("b"), file("c")]);
    state = markUploaded(state, "a");
    state = markUploaded(state, "b");
    state = markUploadFailed(state, "c", "Refusé");
    expect(pendingUploadIds(state)).toEqual(["c"]);
  });

  it("recense aussi les fichiers encore en attente", () => {
    const state = enqueueUploads([], [file("a"), file("b")]);
    expect(pendingUploadIds(state)).toEqual(["a", "b"]);
  });

  it("compte les échecs séparément", () => {
    let state = enqueueUploads([], [file("a"), file("b"), file("c")]);
    state = markUploadFailed(state, "a", "Refusé");
    state = markUploadFailed(state, "c", "Refusé");
    expect(failedUploadCount(state)).toBe(2);
    expect(failedUploadCount([])).toBe(0);
  });

  it("ne garde à l'écran que les fichiers non terminés", () => {
    let state = enqueueUploads([], [file("a"), file("b")]);
    state = markUploaded(state, "a");
    expect(clearFinishedUploads(state).map((item) => item.id)).toEqual(["b"]);
    expect(clearFinishedUploads([])).toEqual([]);
  });

  it("accorde le libellé de reprise", () => {
    expect(retryLabel(1)).toBe("Réessayer l'envoi");
    expect(retryLabel(3)).toBe("Réessayer les 3 envois");
  });
});

describe("upload-queue — compte rendu", () => {
  it("reste muet sans fichier", () => {
    expect(uploadSummary([])).toBe("");
  });

  it("annonce les envois terminés", () => {
    let state = enqueueUploads([], [file("a"), file("b"), file("c")]);
    state = markUploaded(state, "a");
    state = markUploaded(state, "b");
    state = markUploaded(state, "c");
    expect(uploadSummary(state)).toBe("3 fichiers envoyés.");
  });

  it("accorde le singulier", () => {
    const state = markUploaded(enqueueUploads([], [file("a")]), "a");
    expect(uploadSummary(state)).toBe("1 fichier envoyé.");
  });

  it("mêle succès et échecs", () => {
    let state = enqueueUploads([], [file("a"), file("b"), file("c"), file("d")]);
    state = markUploaded(state, "a");
    state = markUploaded(state, "b");
    state = markUploadFailed(state, "c", "Trop volumineux");
    expect(uploadSummary(state)).toBe("2 fichiers envoyés, 1 en échec.");
  });

  it("compte les fichiers encore en attente", () => {
    expect(uploadSummary(enqueueUploads([], [file("a"), file("b")]))).toBe(
      "2 fichiers en attente.",
    );
  });
});
