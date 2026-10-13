/**
 * Raccourcis clavier de Mail — résolution pure (testée sans navigateur) et
 * écoute globale. Modèle volontairement proche de Gmail : les lettres
 * déplacent la sélection dans la liste et agissent sur le message courant, la
 * souris reste toujours disponible.
 */
import { useEffect, useRef } from "react";

/** Actions déclenchées au clavier — une entrée par geste utile. */
export type MailAction =
  | "next" // j / ↓ : message suivant
  | "previous" // k / ↑ : message précédent
  | "first" // g : premier message
  | "last" // G : dernier message
  | "open" // Entrée / o : ouvrir la sélection
  | "compose" // n : nouveau message
  | "reply" // r : répondre
  | "archive" // e : archiver
  | "trash" // Suppr : mettre à la corbeille
  | "star" // s : suivre / ne plus suivre
  | "close" // Échap : fermer la lecture
  | "search" // / : aller à la recherche
  | "help"; // ? : aide des raccourcis

export type ShortcutKey = {
  key: string;
  shiftKey?: boolean;
};

/** Table unique des raccourcis, servie aussi par l'aide affichée à l'écran. */
export const SHORTCUTS: { action: MailAction; keys: ShortcutKey[]; label: string }[] = [
  { action: "next", keys: [{ key: "j" }, { key: "ArrowDown" }], label: "Message suivant" },
  { action: "previous", keys: [{ key: "k" }, { key: "ArrowUp" }], label: "Message précédent" },
  { action: "first", keys: [{ key: "g" }], label: "Premier message" },
  { action: "last", keys: [{ key: "G", shiftKey: true }], label: "Dernier message" },
  { action: "open", keys: [{ key: "Enter" }, { key: "o" }], label: "Ouvrir le message" },
  { action: "compose", keys: [{ key: "n" }], label: "Écrire un message" },
  { action: "reply", keys: [{ key: "r" }], label: "Répondre" },
  { action: "archive", keys: [{ key: "e" }], label: "Archiver" },
  { action: "trash", keys: [{ key: "Delete" }], label: "Mettre à la corbeille" },
  { action: "star", keys: [{ key: "s" }], label: "Suivre / ne plus suivre" },
  { action: "close", keys: [{ key: "Escape" }], label: "Fermer le message" },
  { action: "search", keys: [{ key: "/" }], label: "Rechercher" },
  { action: "help", keys: [{ key: "?", shiftKey: true }], label: "Aide des raccourcis" },
];

/** Rend les raccourcis pour l'aide affichée à l'écran (« j ou ↓ »). */
export function formatShortcutKeys(keys: ShortcutKey[]): string {
  return keys
    .map((entry) => {
      const glyph = entry.key === "ArrowDown" ? "↓" : entry.key === "ArrowUp" ? "↑" : entry.key;
      return entry.shiftKey ? `⇧ ${glyph}` : glyph;
    })
    .join(" ou ");
}

/** Balises dans lesquelles le clavier appartient à l'utilisateur, pas à Mail. */
const TYPING_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);
const TYPING_ROLES = new Set(["textbox", "searchbox", "combobox", "listbox"]);

/**
 * Reconnu structurellement (et non par `instanceof`) pour rester testable hors
 * navigateur : seuls les attributs importent.
 */
function isTypingTarget(target: unknown): boolean {
  if (typeof target !== "object" || target === null) return false;
  const element = target as {
    tagName?: unknown;
    isContentEditable?: unknown;
    getAttribute?: (name: string) => string | null;
  };
  if (element.isContentEditable === true) return true;
  if (typeof element.tagName === "string" && TYPING_TAGS.has(element.tagName)) return true;
  if (typeof element.getAttribute === "function") {
    const role = element.getAttribute("role");
    if (typeof role === "string" && TYPING_ROLES.has(role)) return true;
  }
  return false;
}

export type ShortcutEvent = {
  key: string;
  shiftKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
};

export type ShortcutOptions = {
  /** Un dialogue modal est ouvert : Mail ne intercepte plus rien. */
  modalOpen?: boolean;
};

/**
 * Traduit un évènement clavier en action Mail, ou `null` si la touche ne
 * concerne pas l'application. Tolérant par construction : Échap reste toujours
 * écouté (y compris dans un champ), les combinaisons (⌘, Ctrl, Alt) sont
 * laissées au système et aux lecteurs d'écran.
 */
export function resolveShortcut(
  event: ShortcutEvent,
  target: unknown,
  options: ShortcutOptions = {},
): MailAction | null {
  if (event.metaKey || event.ctrlKey || event.altKey) return null;
  // Échap ferme toujours : c'est le seul geste actif pendant la saisie.
  if (event.key === "Escape") return options.modalOpen ? null : "close";
  if (options.modalOpen) return null;
  if (isTypingTarget(target)) return null;

  for (const shortcut of SHORTCUTS) {
    for (const candidate of shortcut.keys) {
      const shift = candidate.shiftKey ?? false;
      if (candidate.key === event.key && shift === event.shiftKey) return shortcut.action;
    }
  }
  return null;
}

/**
 * Déplace la sélection dans une liste de `length` éléments.
 * `current` vaut -1 quand rien n'est sélectionné ; `null` signale une liste
 * vide (aucun déplacement possible).
 */
export function stepIndex(current: number, direction: 1 | -1, length: number): number | null {
  if (length <= 0) return null;
  if (current < 0) return direction === 1 ? 0 : length - 1;
  const next = current + direction;
  if (next < 0) return 0;
  if (next >= length) return length - 1;
  return next;
}

/** Borne une sélection à une liste (utile après un rafraîchissement). */
export function clampIndex(value: number, length: number): number {
  if (length <= 0) return -1;
  return Math.min(Math.max(value, 0), length - 1);
}

/**
 * Branche les raccourcis sur la fenêtre. Les évènements dont la cible est un
 * champ de saisie, un dialogue modal ouvert ou une combinaison système sont
 * ignorés (voir `resolveShortcut`). Le gestionnaire est conservé dans une
 * réf : le branchement ne dépend pas de l'identité de la fonction appelante.
 */
export function useMailShortcuts(
  handler: (action: MailAction, event: KeyboardEvent) => void,
  options: ShortcutOptions & { enabled?: boolean } = {},
): void {
  const { modalOpen = false, enabled = true } = options;
  const latest = useRef(handler);
  latest.current = handler;

  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const action = resolveShortcut(event, event.target, { modalOpen });
      if (action === null) return;
      event.preventDefault();
      latest.current(action, event);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [modalOpen, enabled]);
}
