import { describe, expect, it } from "vitest";
import {
  addMinutes,
  DEFAULT_DURATION_MINUTES,
  defaultQuickDraft,
  minutesToTime,
  nextHalfHour,
  nextQuarterHour,
  parseQuickInput,
  parseTimeInput,
  quickDraftRange,
  splitEmails,
  toDateInput,
  toTimeInput,
  validateQuickDraft,
} from "../src/ui/quick-create.ts";

/** Mardi 13 octobre 2026, 09:07 locale. */
const NOW = new Date(2026, 9, 13, 9, 7, 30);

describe("création rapide — brouillon par défaut", () => {
  it("arrondit le départ à la demi-heure suivante et dure une heure", () => {
    const draft = defaultQuickDraft(new Date(2026, 9, 14), NOW);
    expect(draft.date).toBe("2026-10-14");
    expect(draft.title).toBe("");
    expect(draft.startTime).toBe("09:30");
    expect(draft.endTime).toBe("10:30");
    expect(draft.allDay).toBe(false);
  });

  it("laisse une heure déjà ronde inchangée", () => {
    expect(nextHalfHour(new Date(2026, 9, 13, 9, 0))).toEqual(new Date(2026, 9, 13, 9, 0));
    expect(nextHalfHour(new Date(2026, 9, 13, 9, 31))).toEqual(new Date(2026, 9, 13, 10, 0));
    expect(nextQuarterHour(new Date(2026, 9, 13, 9, 7))).toEqual(new Date(2026, 9, 13, 9, 15));
    expect(nextQuarterHour(new Date(2026, 9, 13, 9, 45))).toEqual(new Date(2026, 9, 13, 9, 45));
  });

  it("ajoute des minutes sans muter la date d'origine", () => {
    const start = new Date(2026, 9, 13, 9, 0);
    const end = addMinutes(start, 90);
    expect(end).toEqual(new Date(2026, 9, 13, 10, 30));
    expect(start).toEqual(new Date(2026, 9, 13, 9, 0));
  });

  it("formate dates et heures en local", () => {
    expect(toDateInput(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
    expect(toTimeInput(new Date(2026, 9, 13, 8, 5))).toBe("08:05");
    expect(minutesToTime(9 * 60 + 5)).toBe("09:05");
    expect(minutesToTime(0)).toBe("00:00");
    expect(minutesToTime(-30)).toBe("23:30");
  });
});

describe("création rapide — validation", () => {
  const base = defaultQuickDraft(new Date(2026, 9, 14), NOW);

  it("accepte un brouillon complet", () => {
    expect(
      validateQuickDraft({
        ...base,
        title: "Point d'équipe",
        startTime: "09:00",
        endTime: "10:00",
      }),
    ).toBeNull();
  });

  it("refuse un titre vide ou fait d'espaces", () => {
    expect(validateQuickDraft({ ...base, title: "" })).toBe("Donnez un titre à l'événement.");
    expect(validateQuickDraft({ ...base, title: "   " })).toBe("Donnez un titre à l'événement.");
  });

  it("refuse une date ou une heure invalide", () => {
    expect(validateQuickDraft({ ...base, title: "X", date: "2026-02-30" })).toBe(
      "Choisissez une date valide.",
    );
    expect(validateQuickDraft({ ...base, title: "X", startTime: "9h" })).toBe(
      "Les heures doivent être au format hh:mm.",
    );
    expect(validateQuickDraft({ ...base, title: "X", startTime: "25:00" })).toBe(
      "Les heures doivent être au format hh:mm.",
    );
  });

  it("refuse une fin qui ne dépasse pas le début", () => {
    expect(validateQuickDraft({ ...base, title: "X", startTime: "10:00", endTime: "10:00" })).toBe(
      "La fin doit être après le début.",
    );
    expect(validateQuickDraft({ ...base, title: "X", startTime: "11:00", endTime: "10:00" })).toBe(
      "La fin doit être après le début.",
    );
    // Une minute suffit.
    expect(validateQuickDraft({ ...base, title: "X", startTime: "10:00", endTime: "10:01" })).toBe(
      null,
    );
  });

  it("n'exige pas d'heures pour une journée entière", () => {
    expect(
      validateQuickDraft({ ...base, title: "Congé", allDay: true, date: "2026-10-14" }),
    ).toBeNull();
    expect(validateQuickDraft({ ...base, title: "Congé", allDay: true, date: "14/10/2026" })).toBe(
      "Choisissez une date valide.",
    );
  });

  it("lit les heures au format hh:mm", () => {
    expect(parseTimeInput("09:30")).toBe(570);
    expect(parseTimeInput("9:5")).toBeNull();
    expect(parseTimeInput("24:00")).toBeNull();
    expect(parseTimeInput("abc")).toBeNull();
  });
});

describe("création rapide — plage envoyée au service", () => {
  it("construit un événement horaire en heure locale", () => {
    const range = quickDraftRange({
      title: "Point",
      date: "2026-10-14",
      startTime: "09:00",
      endTime: "10:00",
      allDay: false,
    });
    expect(range.allDay).toBe(false);
    expect(range.startsAt).toBe(new Date(2026, 9, 14, 9, 0).toISOString());
    expect(range.endsAt).toBe(new Date(2026, 9, 14, 10, 0).toISOString());
  });

  it("ramène une journée entière aux minuits UTC du jour et du lendemain", () => {
    const range = quickDraftRange({
      title: "Congé",
      date: "2026-10-14",
      startTime: "09:00",
      endTime: "10:00",
      allDay: true,
    });
    expect(range.allDay).toBe(true);
    expect(range.startsAt).toBe("2026-10-14T00:00:00.000Z");
    expect(range.endsAt).toBe("2026-10-15T00:00:00.000Z");
  });

  it("respecte le changement d'heure (heure d'hiver)", () => {
    // Le 25 octobre 2026, l'Europe passe à l'heure d'hiver.
    const range = quickDraftRange({
      title: "Nuit",
      date: "2026-10-25",
      startTime: "02:30",
      endTime: "03:30",
      allDay: false,
    });
    expect(range.startsAt).toBe(new Date(2026, 9, 25, 2, 30).toISOString());
    expect(range.endsAt).toBe(new Date(2026, 9, 25, 3, 30).toISOString());
  });
});

describe("création rapide — liste d'invités", () => {
  it("sépare sur la virgule, le point-virgule et l'espace", () => {
    expect(splitEmails("alice@exemple.org, bruno@exemple.org")).toEqual([
      "alice@exemple.org",
      "bruno@exemple.org",
    ]);
    expect(splitEmails(" alice@exemple.org ;  bruno@exemple.org ")).toEqual([
      "alice@exemple.org",
      "bruno@exemple.org",
    ]);
  });

  it("ignore les entrées vides", () => {
    expect(splitEmails("  ,  ; ")).toEqual([]);
    expect(splitEmails("")).toEqual([]);
  });
});

describe("création rapide — analyse du langage naturel", () => {
  it("lit un titre nu sans date ni heure", () => {
    const draft = parseQuickInput("Revue de sprint", NOW);
    expect(draft.title).toBe("Revue de sprint");
    expect(draft.date).toBe("2026-10-13");
    expect(draft.startTime).toBe("09:30"); // prochaine demi-heure
    expect(draft.endTime).toBe("10:30");
  });

  it("lit un titre avec une heure seule", () => {
    const draft = parseQuickInput("Point d'équipe 9h", NOW);
    expect(draft.title).toBe("Point d'équipe");
    expect(draft.startTime).toBe("09:00");
    expect(draft.endTime).toBe("10:00");
    expect(draft.date).toBe("2026-10-13");
  });

  it("lit une plage d'heures", () => {
    const draft = parseQuickInput("Revue 14:30 à 15:30", NOW);
    expect(draft.title).toBe("Revue");
    expect(draft.startTime).toBe("14:30");
    expect(draft.endTime).toBe("15:30");
  });

  it("lit les mots-clés de date", () => {
    expect(parseQuickInput("Atelier demain 9h", NOW)).toMatchObject({
      title: "Atelier",
      date: "2026-10-14",
      startTime: "09:00",
    });
    expect(parseQuickInput("Atelier aujourd'hui 9h", NOW)).toMatchObject({
      title: "Atelier",
      date: "2026-10-13",
    });
    expect(parseQuickInput("Atelier après-demain 9h", NOW)).toMatchObject({
      title: "Atelier",
      date: "2026-10-15",
    });
    expect(parseQuickInput("Atelier apres-demain 9h", NOW)).toMatchObject({
      title: "Atelier",
      date: "2026-10-15",
    });
  });

  it("lit un jour de semaine nommé, aujourd'hui compris", () => {
    // NOW est un mardi : « mardi » désigne le jour même.
    const draft = parseQuickInput("Cours mardi 8h30", NOW);
    expect(draft.title).toBe("Cours");
    expect(draft.date).toBe("2026-10-13");
    expect(draft.startTime).toBe("08:30");
    // Un autre jour désigne la prochaine occurrence.
    expect(parseQuickInput("Cours vendredi 8h", NOW).date).toBe("2026-10-16");
    expect(parseQuickInput("Cours dimanche 8h", NOW).date).toBe("2026-10-18");
  });

  it("comprend « prochain » comme la semaine suivante", () => {
    // Mardi 13 : le lundi de la semaine prochaine est le 19, pas le 26.
    expect(parseQuickInput("Cours lundi prochain 8h", NOW).date).toBe("2026-10-19");
    // Mardi 13 : « mardi prochain » saute au mardi suivant, le 20.
    expect(parseQuickInput("Cours mardi prochain 8h", NOW).date).toBe("2026-10-20");
    expect(parseQuickInput("Cours vendredi prochain 8h", NOW).date).toBe("2026-10-23");
  });

  it("lit une date numérique jj/mm et jj/mm/aaaa", () => {
    expect(parseQuickInput("Atelier 13/10 9h-11h", NOW)).toMatchObject({
      title: "Atelier",
      date: "2026-10-13",
      startTime: "09:00",
      endTime: "11:00",
    });
    expect(parseQuickInput("Atelier 5/11/2027 9h", NOW)).toMatchObject({
      title: "Atelier",
      date: "2027-11-05",
    });
  });

  it("lit une date numérique déjà passée sur l'année suivante", () => {
    expect(parseQuickInput("Atelier 1/3 9h", NOW).date).toBe("2027-03-01");
    expect(parseQuickInput("Atelier 1/12 9h", NOW).date).toBe("2026-12-01");
  });

  it("considère une seconde heure éloignée comme du bruit, pas comme une fin", () => {
    const draft = parseQuickInput("Stand-up 9h puis rétro 17h", NOW);
    expect(draft.title).toBe("Stand-up puis rétro"); // les deux heures quittent le titre
    expect(draft.startTime).toBe("09:00");
    expect(draft.endTime).toBe("10:00"); // durée par défaut, 17h n'est pas une fin
  });

  it("ne prend pas un nombre seul pour une heure", () => {
    const draft = parseQuickInput("Sprint 42 revue", NOW);
    expect(draft.title).toBe("Sprint 42 revue");
    expect(draft.startTime).toBe("09:30");
  });

  it("garde un titre vide quand la saisie n'est qu'une date", () => {
    const draft = parseQuickInput("demain", NOW);
    expect(draft.title).toBe("");
    expect(draft.date).toBe("2026-10-14");
    expect(validateQuickDraft(draft)).toBe("Donnez un titre à l'événement.");
  });

  it("nettoie les espaces laissés par les extraits retirés", () => {
    const draft = parseQuickInput("   Revue    demain    9h   ", NOW);
    expect(draft.title).toBe("Revue");
  });

  it("accepte les accents et la casse des mots-clés", () => {
    expect(parseQuickInput("Revue DEMAIN 9H", NOW).date).toBe("2026-10-14");
    expect(parseQuickInput("Revue aujourd’hui 9h", NOW).title).toBe("Revue");
    expect(parseQuickInput("Revue aujourd'hui 9h", NOW).date).toBe("2026-10-13");
  });

  it("utilise la durée par défaut quand une seule heure est donnée", () => {
    const draft = parseQuickInput("Revue 23h", NOW);
    expect(draft.startTime).toBe("23:00");
    expect(draft.endTime).toBe("00:00"); // minuit, borne de la journée
    expect(DEFAULT_DURATION_MINUTES).toBe(60);
  });
});
