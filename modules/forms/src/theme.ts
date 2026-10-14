/**
 * Thème d'un formulaire — une couleur d'accent choisie dans la palette des
 * tokens, jamais une couleur en dur.
 *
 * Chaque accent désigne un token `--color-app-*` (décliné clair et sombre
 * dans `packages/design-tokens/tokens.css`) ; le texte posé sur l'accent est
 * choisi par mesure de contraste (WCAG 2.1, voir `color.ts`), dans le thème
 * courant. Aucun hex n'apparaît ici : si la palette des tokens change, seul ce
 * tableau suit.
 */
import { type ContrastLevel, contrastLevel, contrastRatio } from "./color.ts";

/** Variables CSS posées sur le conteneur du formulaire (héritées par son contenu). */
export const FORM_ACCENT_VAR = "--forms-accent";
export const FORM_ACCENT_FOREGROUND_VAR = "--forms-accent-foreground";

/** Tokens de texte candidats sur un accent — le plus clair ou le plus sombre. */
export const TEXT_BACKGROUND_TOKEN = "var(--background)";
export const TEXT_FOREGROUND_TOKEN = "var(--foreground)";

/** Identifiants des accents proposés, dans l'ordre d'affichage. */
export const FORM_ACCENT_IDS = [
  "forms",
  "drive",
  "docs",
  "sheets",
  "calendar",
  "slides",
  "chat",
  "mail",
] as const;

export type FormAccentId = (typeof FORM_ACCENT_IDS)[number];

export type FormAccent = {
  id: FormAccentId;
  /** Nom affiché dans l'éditeur. */
  label: string;
  /** Token de la palette appliqué en CSS (clair et sombre gérés par le thème). */
  token: string;
  /** Valeurs OKLCH du token, thème clair puis sombre — pour mesurer le contraste. */
  oklch: { light: string; dark: string };
};

/** Contraste minimum exigé pour le texte courant (WCAG 2.1, niveau AA). */
export const MIN_TEXT_CONTRAST = 4.5;

const ACCENT_DATA: Record<
  FormAccentId,
  { label: string; token: string; oklch: { light: string; dark: string } }
> = {
  forms: {
    label: "Violet Forms",
    token: "var(--color-app-forms)",
    oklch: { light: "oklch(0.55 0.14 340)", dark: "oklch(0.72 0.13 340)" },
  },
  drive: {
    label: "Bleu Drive",
    token: "var(--color-app-drive)",
    oklch: { light: "oklch(0.6 0.12 160)", dark: "oklch(0.75 0.1 165)" },
  },
  docs: {
    label: "Indigo Docs",
    token: "var(--color-app-docs)",
    oklch: { light: "oklch(0.55 0.13 250)", dark: "oklch(0.72 0.12 250)" },
  },
  sheets: {
    label: "Vert Sheets",
    token: "var(--color-app-sheets)",
    oklch: { light: "oklch(0.58 0.13 145)", dark: "oklch(0.74 0.12 145)" },
  },
  calendar: {
    label: "Terre cuite",
    token: "var(--color-app-calendar)",
    oklch: { light: "oklch(0.58 0.15 25)", dark: "oklch(0.73 0.14 25)" },
  },
  slides: {
    label: "Jaune miel",
    token: "var(--color-app-slides)",
    oklch: { light: "oklch(0.7 0.14 65)", dark: "oklch(0.8 0.13 65)" },
  },
  chat: {
    label: "Turquoise Chat",
    token: "var(--color-app-chat)",
    oklch: { light: "oklch(0.6 0.11 190)", dark: "oklch(0.75 0.1 190)" },
  },
  mail: {
    label: "Bleu marine",
    token: "var(--color-app-mail)",
    oklch: { light: "oklch(0.55 0.1 220)", dark: "oklch(0.72 0.09 220)" },
  },
};

export const FORM_ACCENTS: readonly FormAccent[] = FORM_ACCENT_IDS.map((id) => ({
  id,
  ...ACCENT_DATA[id],
}));

export const DEFAULT_FORM_ACCENT_ID: FormAccentId = "forms";

/** Accent d'un identifiant, avec repli sur l'accent par défaut (jamais `null`). */
export function accentById(id: string | null | undefined): FormAccent {
  return FORM_ACCENTS.find((accent) => accent.id === id) ?? accentById(DEFAULT_FORM_ACCENT_ID);
}

/** Identifiant d'accent recevable, ou l'identifiant par défaut. */
export function normalizeAccentId(id: string | null | undefined): FormAccentId {
  return accentById(id).id;
}

/** Libellé d'un accent, ou « Accent inconnu » (l'éditeur n'affiche jamais l'id brut). */
export function accentLabel(id: string | null | undefined): string {
  return accentById(id).label;
}

export function contrastLevelFor(ratio: number): ContrastLevel {
  return contrastLevel(ratio);
}

/** Vrai si le contraste atteint le niveau AA pour le texte courant. */
export function isAccessibleContrast(ratio: number): boolean {
  return ratio >= MIN_TEXT_CONTRAST;
}

export type AccentForeground = {
  /** Token posé en CSS sur le conteneur du formulaire. */
  token: string;
  /** Ratio mesuré, dans le thème courant. */
  ratio: number;
  level: ContrastLevel;
};

/**
 * Texte le plus lisible sur un accent : le fond le plus clair ou l'encre,
 * selon le ratio mesuré. Les deux candidats sont des tokens ; aucun repli en
 * dur — un token illisible est simplement ignoré.
 */
export function accentForeground(
  accentOklch: string,
  options: { background: string; foreground: string },
): AccentForeground {
  const candidates = [
    { token: TEXT_BACKGROUND_TOKEN, value: options.background },
    { token: TEXT_FOREGROUND_TOKEN, value: options.foreground },
  ];
  let best: AccentForeground | null = null;
  for (const candidate of candidates) {
    let ratio: number;
    try {
      ratio = contrastRatio(candidate.value, accentOklch);
    } catch {
      continue;
    }
    if (best === null || ratio > best.ratio) {
      best = { token: candidate.token, ratio, level: contrastLevel(ratio) };
    }
  }
  // Sans token lisible (mesure impossible) : le fond clair est le choix le
  // plus sûr pour un accent sombre, le plus courant des deux.
  return best ?? { token: TEXT_BACKGROUND_TOKEN, ratio: 1, level: "insuffisant" };
}

export type ResolvedAccent = {
  accent: FormAccent;
  dark: boolean;
  foreground: AccentForeground;
};

/**
 * Mesure l'accent dans le thème courant, à partir des tokens réellement
 * posés sur le conteneur (clair ou sombre). Utilisé par l'éditeur pour
 * afficher le ratio, et par la page publique pour poser ses variables.
 */
export function resolveFormTheme(root: HTMLElement): ResolvedAccent {
  const dark =
    root.classList.contains("dark") ||
    (typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches);
  const style = getComputedStyle(root);
  const background = style.getPropertyValue("--background").trim();
  const foreground = style.getPropertyValue("--foreground").trim();
  const accent = accentById(
    (root.dataset.formsAccent as string | undefined) ?? DEFAULT_FORM_ACCENT_ID,
  );
  return {
    accent,
    dark,
    foreground: accentForeground(accent.oklch[dark ? "dark" : "light"], { background, foreground }),
  };
}

/**
 * Pose les variables d'accent sur le conteneur d'un formulaire (page publique
 * ou aperçu). Retourne l'identifiant appliqué. Les variables héritent à tout
 * le contenu du conteneur : aucun effet en dehors.
 */
export function applyFormTheme(
  accentId: string | null | undefined,
  root: HTMLElement,
): FormAccentId {
  const accent = accentById(accentId);
  root.dataset.formsAccent = accent.id;
  root.style.setProperty(FORM_ACCENT_VAR, accent.token);
  const { foreground } = resolveFormTheme(root);
  root.style.setProperty(FORM_ACCENT_FOREGROUND_VAR, foreground.token);
  return accent.id;
}

/** Contraste mesuré d'un accent dans un thème donné (pour les tests et l'éditeur). */
export function accentContrastInTheme(
  accent: FormAccent,
  options: {
    background: string;
    foreground: string;
    dark: boolean;
  },
): AccentForeground {
  return accentForeground(accent.oklch[options.dark ? "dark" : "light"], {
    background: options.background,
    foreground: options.foreground,
  });
}
