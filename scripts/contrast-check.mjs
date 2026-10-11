#!/usr/bin/env node
/**
 * Vérification de contraste « Papier & encre » — calculée, pas estimée.
 *
 * Convertit les valeurs OKLCH des tokens (clair ET sombre) en sRGB, puis
 * calcule le ratio de contraste WCAG 2.1 pour les paires de texte et
 * d'interface définies ci-dessous. Échoue (code 1) si une paire passe sous
 * son seuil. Utilisation : `pnpm check:design`.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const css = readFileSync(join(root, "packages/design-tokens/tokens.css"), "utf8");

/** Extrait les variables d'un bloc :root ou .dark. */
function extractBlock(selector) {
  const start = css.indexOf(selector);
  if (start === -1) throw new Error(`Bloc ${selector} introuvable.`);
  const open = css.indexOf("{", start);
  let depth = 0;
  let end = open;
  for (let index = open; index < css.length; index += 1) {
    if (css[index] === "{") depth += 1;
    if (css[index] === "}") {
      depth -= 1;
      if (depth === 0) {
        end = index;
        break;
      }
    }
  }
  const body = css.slice(open + 1, end);
  const vars = new Map();
  for (const match of body.matchAll(/--([a-z0-9-]+):\s*(oklch\([^)]*\));/g)) {
    vars.set(match[1], match[2]);
  }
  return vars;
}

/** OKLCH → sRGB (0-1), selon la conversion CSS Color 4. */
function oklchToRgb(value) {
  const match = /oklch\(\s*([\d.]+%?)\s+([\d.]+)\s+([\d.]+)\s*(?:\/\s*([\d.]+)%?)?\s*\)/.exec(
    value,
  );
  if (!match) throw new Error(`OKLCH invalide : ${value}`);
  const l = match[1].endsWith("%")
    ? Number.parseFloat(match[1]) / 100
    : Number.parseFloat(match[1]);
  const c = Number.parseFloat(match[2]);
  const h = (Number.parseFloat(match[3]) * Math.PI) / 180;
  const alpha = match[4] !== undefined ? Number.parseFloat(match[4]) / 100 : 1;

  const a = c * Math.cos(h);
  const b = c * Math.sin(h);

  const l_ = l + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = l - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = l - 0.0894841775 * a - 1.291485548 * b;

  const l3 = l_ ** 3;
  const m3 = m_ ** 3;
  const s3 = s_ ** 3;

  const r = 4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3;
  const g = -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3;
  const bl = -0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3;

  const encode = (channel) => {
    const v = Math.min(1, Math.max(0, channel));
    return v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
  };
  return { r: encode(r), g: encode(g), b: encode(bl), alpha };
}

function relativeLuminance({ r, g, b }) {
  const channel = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function composite(fg, bg) {
  if (fg.alpha >= 1) return fg;
  return {
    r: fg.r * fg.alpha + bg.r * (1 - fg.alpha),
    g: fg.g * fg.alpha + bg.g * (1 - fg.alpha),
    b: fg.b * fg.alpha + bg.b * (1 - fg.alpha),
    alpha: 1,
  };
}

function contrast(fgValue, bgValue) {
  const bg = oklchToRgb(bgValue);
  const fg = composite(oklchToRgb(fgValue), bg);
  const l1 = relativeLuminance(fg);
  const l2 = relativeLuminance(bg);
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

/** Paires vérifiées : [texte, fond, seuil WCAG, étiquette]. */
const PAIRS = [
  ["foreground", "background", 4.5, "Texte principal / fond"],
  ["foreground", "card", 4.5, "Texte principal / carte"],
  ["muted-foreground", "background", 4.5, "Texte atténué / fond"],
  ["muted-foreground", "card", 4.5, "Texte atténué / carte"],
  ["primary-foreground", "primary", 4.5, "Texte / bouton primaire"],
  ["accent-foreground", "accent", 4.5, "Texte / sélection"],
  ["attention-foreground", "attention", 4.5, "Texte / ambre"],
  ["destructive-foreground", "destructive", 4.5, "Texte / danger"],
  ["rail-foreground", "rail", 4.5, "Rail : icônes / fond"],
  ["rail-active-foreground", "rail-active", 4.5, "Rail : actif"],
  ["destructive", "background", 3, "Accent danger (UI) / fond"],
  ["attention", "background", 1.5, "Ambre (pastille) / fond"],
  ["primary", "background", 3, "Bouton primaire / fond"],
];

const light = extractBlock(":root {");
const dark = extractBlock(".dark {");

let failures = 0;
for (const [themeName, vars] of [
  ["clair", light],
  ["sombre", dark],
]) {
  console.log(`\n=== Thème ${themeName} ===`);
  for (const [fg, bg, min, label] of PAIRS) {
    const fgValue = vars.get(fg);
    const bgValue = vars.get(bg);
    if (!fgValue || !bgValue) {
      console.log(`  ?? ${label} : token manquant (${fg}/${bg})`);
      failures += 1;
      continue;
    }
    const ratio = contrast(fgValue, bgValue);
    const ok = ratio >= min;
    if (!ok) failures += 1;
    console.log(`  ${ok ? "OK " : "ÉCHEC"} ${label} — ${ratio.toFixed(2)}:1 (seuil ${min})`);
  }
}

if (failures > 0) {
  console.error(`\n${failures} paire(s) sous le seuil WCAG — corrigez les tokens.`);
  process.exit(1);
}
console.log("\nToutes les paires respectent leurs seuils WCAG.");
