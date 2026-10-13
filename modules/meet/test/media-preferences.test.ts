import { describe, expect, it } from "vitest";
import {
  captureConstraints,
  DEFAULT_MEDIA_PREFERENCES,
  DEVICE_ID_KEY,
  formatDeviceLabel,
  loadMediaPreferences,
  MEDIA_PREFERENCES_KEY,
  type MediaPreferences,
  type MediaPreferencesStorage,
  mediaKindLabel,
  normalizeDevices,
  resolveDevice,
  resolveDeviceId,
  sanitizeMediaPreferences,
  saveMediaPreferences,
  toggledMedia,
  withDevice,
} from "../src/media-preferences.ts";

/** Stockage local simulé (le hook n'est pas testable en environnement node). */
function fakeStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    storage: {
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => {
        map.set(key, value);
      },
    } satisfies MediaPreferencesStorage,
  };
}

const prefs = (overrides: Partial<MediaPreferences> = {}): MediaPreferences => ({
  ...DEFAULT_MEDIA_PREFERENCES,
  ...overrides,
});

const saved = (): MediaPreferences =>
  prefs({ microphoneOn: false, cameraOn: false, cameraDeviceId: "cam-1" });

describe("meet — préférences d'entrée", () => {
  it("retient les valeurs par défaut au premier chargement", () => {
    const { storage } = fakeStorage();
    expect(loadMediaPreferences(storage)).toEqual(DEFAULT_MEDIA_PREFERENCES);
    expect(loadMediaPreferences(null)).toEqual(DEFAULT_MEDIA_PREFERENCES);
  });

  it("relit des préférences enregistrées", () => {
    const saved = prefs({ microphoneOn: false, cameraDeviceId: "cam-2" });
    const { storage } = fakeStorage({
      [MEDIA_PREFERENCES_KEY]: JSON.stringify(saved),
    });
    expect(loadMediaPreferences(storage)).toEqual(saved);
  });

  it("ignore un stockage illisible au lieu de planter", () => {
    const hostile = {
      getItem: () => {
        throw new Error("navigation privée");
      },
      setItem: () => {
        throw new Error("navigation privée");
      },
    } satisfies MediaPreferencesStorage;
    expect(loadMediaPreferences(hostile)).toEqual(DEFAULT_MEDIA_PREFERENCES);
    expect(() => saveMediaPreferences(hostile, saved())).not.toThrow();
  });

  it("retombe sur les défauts si le JSON est corrompu", () => {
    const { storage } = fakeStorage({ [MEDIA_PREFERENCES_KEY]: "{pas du json" });
    expect(loadMediaPreferences(storage)).toEqual(DEFAULT_MEDIA_PREFERENCES);
  });

  it("nettoie les valeurs persistées douteuses", () => {
    expect(
      sanitizeMediaPreferences({
        microphoneOn: "false",
        cameraOn: 7,
        microphoneDeviceId: "  ",
        cameraDeviceId: "cam-9",
        speakerDeviceId: 12,
      }),
    ).toEqual({
      microphoneOn: false,
      cameraOn: true,
      microphoneDeviceId: null,
      cameraDeviceId: "cam-9",
      speakerDeviceId: null,
    });
    expect(sanitizeMediaPreferences(null)).toEqual(DEFAULT_MEDIA_PREFERENCES);
    expect(sanitizeMediaPreferences("micro")).toEqual(DEFAULT_MEDIA_PREFERENCES);
  });

  it("bascule chaque état sans muter l'objet reçu", () => {
    const origin = prefs();
    const muted = toggledMedia(origin, "microphone");
    const off = toggledMedia(origin, "camera");
    expect(muted.microphoneOn).toBe(false);
    expect(muted.cameraOn).toBe(true);
    expect(off.cameraOn).toBe(false);
    expect(off.microphoneOn).toBe(true);
    // L'objet d'origine est intact : les rendus React restent cohérents.
    expect(origin).toEqual(DEFAULT_MEDIA_PREFERENCES);
  });

  it("enregistre un changement de périphérique pour son type", () => {
    expect(withDevice(prefs(), "speaker", "hp-1").speakerDeviceId).toBe("hp-1");
    expect(withDevice(prefs(), "camera", "  ").cameraDeviceId).toBeNull();
    expect(withDevice(prefs(), "microphone", "mic-3").microphoneDeviceId).toBe("mic-3");
  });

  it("sauvegarde puis relit un aller-retour complet", () => {
    const { map, storage } = fakeStorage();
    const target = prefs({ microphoneOn: false, cameraDeviceId: "cam-1" });
    saveMediaPreferences(storage, target);
    expect(map.get(MEDIA_PREFERENCES_KEY)).toBe(JSON.stringify(target));
    expect(loadMediaPreferences(storage)).toEqual(target);
  });
});

describe("meet — périphériques", () => {
  it("nomme un périphérique que le navigateur n'a pas encore identifié", () => {
    expect(formatDeviceLabel("camera", "", 0)).toBe("Caméra 1");
    expect(formatDeviceLabel("microphone", "", 2)).toBe("Micro 3");
    expect(formatDeviceLabel("speaker", "", 0)).toBe("Sortie audio 1");
    expect(formatDeviceLabel("camera", "  Webcam HD  ", 0)).toBe("Webcam HD");
  });

  it("traduit les types du navigateur en types sémantiques", () => {
    const list = normalizeDevices([
      { deviceId: "c1", kind: "videoinput", label: "Webcam", groupId: "" },
      { deviceId: "m1", kind: "audioinput", label: "", groupId: "" },
      { deviceId: "s1", kind: "audiooutput", label: "Haut-parleurs", groupId: "" },
    ] as MediaDeviceInfo[]);
    expect(list).toEqual([
      { deviceId: "c1", kind: "camera", label: "Webcam" },
      { deviceId: "m1", kind: "microphone", label: "Micro 1" },
      { deviceId: "s1", kind: "speaker", label: "Haut-parleurs" },
    ]);
  });

  it("numérote les libellés manquants par type", () => {
    const list = normalizeDevices([
      { deviceId: "c1", kind: "videoinput", label: "", groupId: "" },
      { deviceId: "c2", kind: "videoinput", label: "", groupId: "" },
      { deviceId: "m1", kind: "audioinput", label: "", groupId: "" },
    ] as MediaDeviceInfo[]);
    expect(list.map((device) => device.label)).toEqual(["Caméra 1", "Caméra 2", "Micro 1"]);
  });

  it("conserve le choix enregistré quand le périphérique existe encore", () => {
    const list = normalizeDevices([
      { deviceId: "c1", kind: "videoinput", label: "Webcam", groupId: "" },
      { deviceId: "c2", kind: "videoinput", label: "Caméra USB", groupId: "" },
    ] as MediaDeviceInfo[]);
    expect(resolveDeviceId("camera", list, "c2")).toBe("c2");
    expect(resolveDevice("camera", list, "c2")).toEqual({
      deviceId: "c2",
      kind: "camera",
      label: "Caméra USB",
    });
  });

  it("retombe sur le premier périphérique si le choix a disparu", () => {
    const list = normalizeDevices([
      { deviceId: "m1", kind: "audioinput", label: "Micro USB", groupId: "" },
    ] as MediaDeviceInfo[]);
    expect(resolveDeviceId("microphone", list, "m-absente")).toBe("m1");
    expect(resolveDeviceId("microphone", list, null)).toBe("m1");
    expect(resolveDeviceId("speaker", list, null)).toBeNull();
    expect(resolveDevice("speaker", list, null)).toBeNull();
  });

  it("construit les contraintes de capture adaptées au type", () => {
    expect(captureConstraints("microphone", "m1")).toEqual({
      deviceId: { exact: "m1" },
      echoCancellation: true,
      noiseSuppression: true,
    });
    expect(captureConstraints("camera", null)).toEqual({
      width: { ideal: 1280 },
      height: { ideal: 720 },
    });
  });

  it("expose des libellés et des clés cohérents par type", () => {
    expect(mediaKindLabel("camera")).toBe("Caméra");
    expect(mediaKindLabel("microphone")).toBe("Micro");
    expect(mediaKindLabel("speaker")).toBe("Sortie audio");
    expect(DEVICE_ID_KEY.speaker).toBe("speakerDeviceId");
  });
});
