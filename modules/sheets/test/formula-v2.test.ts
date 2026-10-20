import { describe, expect, it } from "vitest";
import {
  activeFunctionCall,
  dateToSerial,
  evaluateCells,
  FORMULA_FUNCTIONS,
  findFormulaFunction,
  formatValue,
  formatWithPattern,
  formulaTokenAtEnd,
  matchesCriterion,
  parseCellLiteral,
  shiftFormula,
  suggestFunctions,
} from "../src/formula.ts";

const NOW = () => new Date(2026, 9, 20, 14, 30, 0);

function value(cells: Record<string, string>, key = "Z1"): string {
  const evaluated = evaluateCells(cells, { now: NOW });
  const cell = evaluated.get(key);
  return cell ? formatValue(cell) : "";
}

const f = (formula: string, cells: Record<string, string> = {}) => value({ ...cells, Z1: formula });

describe("formules v2 — opérateurs Excel", () => {
  it("comparaisons, concaténation, puissance et pourcentage", () => {
    expect(f("=2>1")).toBe("VRAI");
    expect(f("=2<>2")).toBe("FAUX");
    expect(f('="a"="A"')).toBe("VRAI");
    expect(f('="Total : "&10')).toBe("Total : 10");
    expect(f("=2^10")).toBe("1024");
    expect(f("=-2^2")).toBe("4");
    expect(f("=50%")).toBe("0.5");
    expect(f("=200*10%")).toBe("20");
    expect(f("=1+2*3^2")).toBe("19");
    expect(f("=1+2&3")).toBe("33");
  });

  it("références absolues et mixtes", () => {
    expect(f("=$A$1+A$2+$A3", { A1: "1", A2: "2", A3: "3" })).toBe("6");
  });

  it("colonnes entières bornées aux lignes utilisées", () => {
    expect(f("=SUM(A:A)", { A1: "1", A2: "2", A40: "3" })).toBe("6");
    expect(f("=COUNTA(A:B)", { A1: "x", B3: "y" })).toBe("2");
  });

  it("saisies françaises : virgule décimale, pourcentage, milliers, booléens", () => {
    expect(f("=A1*2", { A1: "3,5" })).toBe("7");
    expect(f("=A1*100", { A1: "12%" })).toBe("12");
    expect(f("=A1+1", { A1: "1 000" })).toBe("1001");
    expect(value({ A1: "vrai" }, "A1")).toBe("VRAI");
    expect(parseCellLiteral("12 34")).toBeNull();
    expect(parseCellLiteral("-1,25e2")).toBe(-125);
  });

  it("chaînes avec guillemets doublés", () => {
    expect(f('="Il dit ""oui"""')).toBe('Il dit "oui"');
  });
});

describe("formules v2 — noms français et séparateur ;", () => {
  it("SOMME, MOYENNE, SI, ET/OU avec ;", () => {
    const cells = { A1: "4", A2: "6", A3: "texte" };
    expect(f("=SOMME(A1:A3)", cells)).toBe("10");
    expect(f("=MOYENNE(A1;A2)", cells)).toBe("5");
    expect(f('=SI(A1>5;"grand";"petit")', cells)).toBe("petit");
    expect(f("=SI(ET(A1>1;A2<10);1;0)", cells)).toBe("1");
    expect(f("=OU(FAUX;VRAI)")).toBe("VRAI");
    expect(f("=NON(VRAI)")).toBe("FAUX");
    expect(f("=SI(FAUX;1)")).toBe("FAUX");
  });

  it("SI n'évalue que la branche retenue", () => {
    expect(f("=SI(VRAI;1;1/0)")).toBe("1");
    expect(f('=SIERREUR(1/0;"div")')).toBe("div");
    expect(f('=SI.NON.DISP(RECHERCHEV(9;A1:B2;2;FAUX);"absent")', { A1: "1", B1: "x" })).toBe(
      "absent",
    );
  });

  it("SI.CONDITIONS", () => {
    expect(f('=SI.CONDITIONS(A1>10;"A";A1>5;"B";VRAI;"C")', { A1: "7" })).toBe("B");
  });
});

describe("formules v2 — maths et statistiques", () => {
  it("arrondis", () => {
    expect(f("=ARRONDI(2.675;2)")).toBe("2.68");
    expect(f("=ROUND(-1.5;0)")).toBe("-2");
    expect(f("=ARRONDI.SUP(1.21;1)")).toBe("1.3");
    expect(f("=ARRONDI.INF(-1.29;1)")).toBe("-1.2");
    expect(f("=ENT(-1.5)")).toBe("-2");
    expect(f("=TRONQUE(-1.59;1)")).toBe("-1.5");
    expect(f("=PLAFOND(23;5)")).toBe("25");
    expect(f("=PLANCHER(23;5)")).toBe("20");
  });

  it("fonctions numériques", () => {
    expect(f("=ABS(-3)")).toBe("3");
    expect(f("=RACINE(16)")).toBe("4");
    expect(f("=RACINE(-1)")).toBe("#NUM!");
    expect(f("=PUISSANCE(2;3)")).toBe("8");
    expect(f("=MOD(-3;2)")).toBe("1");
    expect(f("=MOD(1;0)")).toBe("#DIV/0");
    expect(f("=LOG(100)")).toBe("2");
    expect(f("=LN(EXP(2))")).toBe("2");
    expect(f("=SIGNE(-4)")).toBe("-1");
    expect(f("=ARRONDI(PI();4)")).toBe("3.1416");
  });

  it("produit, médiane, écart type, k-ièmes valeurs", () => {
    const cells = { A1: "2", A2: "4", A3: "4", A4: "4", A5: "5", A6: "5", A7: "7", A8: "9" };
    expect(f("=PRODUIT(A1:A2)", cells)).toBe("8");
    expect(f("=MEDIANE(A1:A8)", cells)).toBe("4.5");
    expect(f("=ARRONDI(ECARTYPE(A1:A8);4)", cells)).toBe("2.1381");
    expect(f("=GRANDE.VALEUR(A1:A8;2)", cells)).toBe("7");
    expect(f("=PETITE.VALEUR(A1:A8;1)", cells)).toBe("2");
    expect(f("=GRANDE.VALEUR(A1:A8;20)", cells)).toBe("#NUM!");
  });

  it("NB, NBVAL, NB.VIDE", () => {
    const cells = { A1: "1", A2: "x", A4: "VRAI" };
    expect(f("=NB(A1:A4)", cells)).toBe("1");
    expect(f("=NBVAL(A1:A4)", cells)).toBe("3");
    expect(f("=NB.VIDE(A1:A4)", cells)).toBe("1");
  });
});

describe("formules v2 — conditions", () => {
  const sales = {
    A1: "Nord",
    B1: "100",
    A2: "Sud",
    B2: "250",
    A3: "Nord",
    B3: "50",
    A4: "Est",
    B4: "300",
  };

  it("SOMME.SI, NB.SI, MOYENNE.SI", () => {
    expect(f('=SOMME.SI(A1:A4;"Nord";B1:B4)', sales)).toBe("150");
    expect(f('=SUMIF(B1:B4;">100")', sales)).toBe("550");
    expect(f('=NB.SI(A1:A4;"N*")', sales)).toBe("2");
    expect(f('=NB.SI(A1:A4;"<>Nord")', sales)).toBe("2");
    expect(f('=MOYENNE.SI(A1:A4;"Nord";B1:B4)', sales)).toBe("75");
  });

  it("SOMME.SI.ENS et NB.SI.ENS", () => {
    expect(f('=SOMME.SI.ENS(B1:B4;A1:A4;"Nord";B1:B4;">60")', sales)).toBe("100");
    expect(f('=NB.SI.ENS(A1:A4;"Nord";B1:B4;"<100")', sales)).toBe("1");
  });

  it("critères", () => {
    expect(matchesCriterion(5, ">=5")).toBe(true);
    expect(matchesCriterion("abc", "a?c")).toBe(true);
    expect(matchesCriterion(null, "")).toBe(true);
    expect(matchesCriterion("x", ">5")).toBe(false);
    expect(matchesCriterion(3, 3)).toBe(true);
  });

  it("SOMMEPROD", () => {
    expect(f("=SOMMEPROD(A1:A2;B1:B2)", { A1: "2", A2: "3", B1: "4", B2: "5" })).toBe("23");
  });
});

describe("formules v2 — texte", () => {
  it("fonctions de texte", () => {
    expect(f('=CONCATENER("a";1;VRAI)')).toBe("a1VRAI");
    expect(f('=JOINDRE.TEXTE(", ";VRAI;A1:A3)', { A1: "x", A3: "z" })).toBe("x, z");
    expect(f('=NBCAR("Été")')).toBe("3");
    expect(f('=GAUCHE("Bonjour";3)')).toBe("Bon");
    expect(f('=DROITE("Bonjour";4)')).toBe("jour");
    expect(f('=STXT("Bonjour";4;2)')).toBe("jo");
    expect(f('=MAJUSCULE("été")')).toBe("ÉTÉ");
    expect(f('=NOMPROPRE("jean-paul dupont")')).toBe("Jean-Paul Dupont");
    expect(f('=SUPPRESPACE("  a   b ")')).toBe("a b");
    expect(f('=SUBSTITUE("a-b-c";"-";"+")')).toBe("a+b+c");
    expect(f('=SUBSTITUE("a-b-c";"-";"+";2)')).toBe("a-b+c");
    expect(f('=REMPLACER("abcdef";2;3;"X")')).toBe("aXef");
    expect(f('=TROUVE("o";"Bonjour")')).toBe("2");
    expect(f('=CHERCHE("JOUR";"Bonjour")')).toBe("4");
    expect(f('=TROUVE("z";"Bonjour")')).toBe("#ERREUR");
    expect(f('=CNUM("12,5")')).toBe("12.5");
    expect(f('=REPT("ab";3)')).toBe("ababab");
    expect(f('=EXACT("a";"A")')).toBe("FAUX");
  });

  it("TEXTE avec motifs courants", () => {
    expect(formatWithPattern(1234.5, "# ##0,00").replace(/[\u00a0\u202f]/g, " ")).toBe("1 234,50");
    expect(formatWithPattern(0.256, "0%")).toMatch(/^26\s%$/);
    expect(formatWithPattern(dateToSerial(2026, 10, 20), "jj/mm/aaaa")).toBe("20/10/2026");
  });
});

describe("formules v2 — dates", () => {
  it("numéros de série compatibles Excel", () => {
    expect(dateToSerial(2026, 1, 1)).toBe(46023);
    expect(f("=DATE(2026;10;20)")).toBe(String(dateToSerial(2026, 10, 20)));
    expect(f("=ANNEE(DATE(2026;10;20))")).toBe("2026");
    expect(f("=MOIS(DATE(2026;10;20))")).toBe("10");
    expect(f("=JOUR(DATE(2026;10;20))")).toBe("20");
    expect(f("=JOURSEM(DATE(2026;10;20);2)")).toBe("2");
    expect(f("=JOURS(DATE(2026;12;25);DATE(2026;10;20))")).toBe("66");
    expect(f("=JOUR(MOIS.DECALER(DATE(2026;1;31);1))")).toBe("28");
    expect(f("=JOUR(FIN.MOIS(DATE(2024;2;10);0))")).toBe("29");
  });

  it("AUJOURDHUI et MAINTENANT suivent l'horloge", () => {
    expect(f("=AUJOURDHUI()")).toBe(String(dateToSerial(2026, 10, 20)));
    expect(Number(f("=MAINTENANT()"))).toBeCloseTo(dateToSerial(2026, 10, 20) + 14.5 / 24, 6);
  });
});

describe("formules v2 — recherche", () => {
  const table = {
    A1: "Pomme",
    B1: "1.2",
    A2: "Poire",
    B2: "2.5",
    A3: "Prune",
    B3: "3",
  };

  it("RECHERCHEV exacte et approchée", () => {
    expect(f('=RECHERCHEV("Poire";A1:B3;2;FAUX)', table)).toBe("2.5");
    expect(f('=RECHERCHEV("Kiwi";A1:B3;2;FAUX)', table)).toBe("#N/A");
    expect(f('=RECHERCHEV("Poire";A1:B3;3;FAUX)', table)).toBe("#REF!");
    expect(
      f("=RECHERCHEV(15;D1:E3;2)", { D1: "0", E1: "F", D2: "10", E2: "B", D3: "20", E3: "A" }),
    ).toBe("B");
  });

  it("RECHERCHEH, RECHERCHEX, EQUIV, INDEX, CHOISIR", () => {
    expect(
      f("=RECHERCHEH(2;A1:C2;2;FAUX)", { A1: "1", B1: "2", C1: "3", A2: "a", B2: "b", C2: "c" }),
    ).toBe("b");
    expect(f('=RECHERCHEX("Prune";A1:A3;B1:B3)', table)).toBe("3");
    expect(f('=RECHERCHEX("Kiwi";A1:A3;B1:B3;"aucun")', table)).toBe("aucun");
    expect(f('=EQUIV("Prune";A1:A3;0)', table)).toBe("3");
    expect(f('=INDEX(A1:B3;EQUIV("Poire";A1:A3;0);2)', table)).toBe("2.5");
    expect(f("=INDEX(A1:B3;9;1)", table)).toBe("#REF!");
    expect(f('=CHOISIR(2;"a";"b";"c")')).toBe("b");
    expect(f("=LIGNES(A1:B3)+COLONNES(A1:B3)")).toBe("5");
    expect(f("=LIGNE(C7)*100+COLONNE(C7)")).toBe("703");
  });
});

describe("formules v2 — information et erreurs", () => {
  it("ESTVIDE, ESTNUM, ESTTEXTE, ESTERREUR, ESTNA", () => {
    expect(f("=ESTVIDE(A1)")).toBe("VRAI");
    expect(f("=ESTNUM(A1)", { A1: "3" })).toBe("VRAI");
    expect(f("=ESTTEXTE(A1)", { A1: "x" })).toBe("VRAI");
    expect(f("=ESTERREUR(1/0)")).toBe("VRAI");
    expect(f("=ESTNA(NA())")).toBe("VRAI");
  });

  it("codes d'erreur", () => {
    expect(f("=NEXISTEPAS(1)")).toBe("#NOM?");
    expect(f("=SI(1)")).toBe("#ERREUR");
    expect(f("=A1+1", { A1: "=1/0" })).toBe("#DIV/0");
    expect(f("=SIERREUR(A1;0)", { A1: "=B1", B1: "=A1" })).toBe("#CYCLE");
  });
});

describe("formules v2 — recopie et aide à la saisie", () => {
  it("décale les références relatives et garde les absolues", () => {
    expect(shiftFormula("=A1+B2", 1, 1)).toBe("=B2+C3");
    expect(shiftFormula("=$A$1+A$1+$A1", 2, 3)).toBe("=$A$1+D$1+$A3");
    expect(shiftFormula("=SOMME(A1:A3)", 0, 1)).toBe("=SOMME(B1:B3)");
    expect(shiftFormula('="A1"&A1', 1, 0)).toBe('="A1"&A2');
    expect(shiftFormula("=A1", -1, 0)).toBe("=#REF!");
    expect(shiftFormula("=LOG10(A1)", 1, 0)).toBe("=LOG10(A2)");
    expect(shiftFormula("42", 1, 1)).toBe("42");
  });

  it("repère la fonction en cours de saisie et la fonction active", () => {
    expect(formulaTokenAtEnd("=SOM")).toBe("SOM");
    expect(formulaTokenAtEnd("=A1+nb.s")).toBe("NB.S");
    expect(formulaTokenAtEnd("=A1")).toBeNull();
    expect(formulaTokenAtEnd('="SOM')).toBeNull();
    expect(formulaTokenAtEnd("texte")).toBeNull();
    expect(activeFunctionCall("=SI(A1>2;")?.fr).toBe("SI");
    expect(activeFunctionCall("=SOMME(A1:A3)")).toBeNull();
    expect(activeFunctionCall("=SI(ET(A1;B1);")?.fr).toBe("SI");
  });

  it("suggère les fonctions, noms français d'abord", () => {
    const suggestions = suggestFunctions("SO");
    expect(suggestions[0]?.fr).toBe("SOMME");
    expect(suggestions.map((fn) => fn.fr)).toContain("SOMMEPROD");
    expect(suggestFunctions("VLO")[0]?.name).toBe("VLOOKUP");
    expect(findFormulaFunction("avg")?.fr).toBe("MOYENNE");
  });

  it("catalogue : au moins 90 fonctions, noms uniques, syntaxe documentée", () => {
    expect(FORMULA_FUNCTIONS.length).toBeGreaterThanOrEqual(90);
    const names = new Set(FORMULA_FUNCTIONS.map((fn) => fn.name));
    expect(names.size).toBe(FORMULA_FUNCTIONS.length);
    for (const fn of FORMULA_FUNCTIONS) {
      expect(fn.syntax.startsWith(`${fn.fr}(`)).toBe(true);
      expect(fn.description.length).toBeGreaterThan(5);
    }
  });
});
