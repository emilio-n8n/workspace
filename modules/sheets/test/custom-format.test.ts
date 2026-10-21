import { describe, expect, it } from "vitest";
import { formatCustom, isValidCustomFormat, splitSections } from "../src/custom-format.ts";

const fmt = (value: number, pattern: string) => formatCustom(String(value), pattern, value).text;
const G = "\u202f";

describe("formats personnalisés", () => {
  it("chiffres, décimales et milliers", () => {
    expect(fmt(1234.5, "0.00")).toBe("1234,50");
    expect(fmt(1234.5, "#,##0.00")).toBe(`1${G}234,50`);
    expect(fmt(1234567, "#,##0")).toBe(`1${G}234${G}567`);
    expect(fmt(0.5, "#.##")).toBe(",5");
    expect(fmt(7, "000")).toBe("007");
    expect(fmt(2.71838, "0.###")).toBe("2,718");
  });

  it("codes saisis à la française", () => {
    expect(fmt(1234.5, "# ##0,00 €")).toBe(`1${G}234,50 €`);
    expect(fmt(2.5, "0,0")).toBe("2,5");
  });

  it("pourcentage, échelle et scientifique", () => {
    expect(fmt(0.256, "0.0%")).toBe("25,6%");
    expect(fmt(1500000, '#,##0,," M"')).toBe("2 M");
    expect(fmt(12345, "0.00E+00")).toBe("1,23E+04");
    expect(fmt(0.00012, "0.0E+00")).toBe("1,2E-04");
  });

  it("sections positif ; négatif ; zéro ; texte et couleurs", () => {
    expect(fmt(-5, "0")).toBe("-5");
    expect(fmt(-5, "0;(0)")).toBe("(5)");
    expect(fmt(0, '0;-0;"néant"')).toBe("néant");
    const red = formatCustom("-12", "#,##0;[Rouge]-#,##0", -12);
    expect(red).toEqual({ text: "-12", tone: "negative" });
    expect(formatCustom("abc", '0;0;0;"« "@" »"', null).text).toBe("« abc »");
    expect(formatCustom("abc", "0.00", null).text).toBe("abc");
  });

  it("littéraux, unités et monnaie", () => {
    expect(fmt(12, '0" kg"')).toBe("12 kg");
    expect(fmt(9.5, "$#,##0.00")).toBe("$9,50");
    expect(fmt(4, "\\#0")).toBe("#4");
  });

  it("dates et heures depuis un numéro de série", () => {
    // 45658 = 01/01/2025 (mercredi).
    expect(fmt(45658, "dd/mm/yyyy")).toBe("01/01/2025");
    expect(fmt(45658, "jj/mm/aaaa")).toBe("01/01/2025");
    expect(fmt(45658, "dddd d mmmm yyyy")).toBe("mercredi 1 janvier 2025");
    expect(fmt(45658, "mmm yy")).toBe("jan 25");
    expect(fmt(45658.75, "hh:mm")).toBe("18:00");
    expect(fmt(45658.5 + 90 / 86400, "h:mm:ss")).toBe("12:01:30");
    expect(fmt(45658.75, "h:mm AM/PM")).toBe("6:00 PM");
  });

  it("validation et découpe", () => {
    expect(splitSections('0;"a;b";0')).toEqual(["0", '"a;b"', "0"]);
    expect(isValidCustomFormat("0.00")).toBe(true);
    expect(isValidCustomFormat("")).toBe(false);
    expect(isValidCustomFormat("0;0;0;0;0")).toBe(false);
    expect(isValidCustomFormat("x".repeat(65))).toBe(false);
    expect(isValidCustomFormat(42)).toBe(false);
  });
});
