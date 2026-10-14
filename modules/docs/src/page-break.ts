import { Node } from "@tiptap/core";

/**
 * Nœud « saut de page » : un bloc atomique, inséré par la barre d'outils
 * (groupe Insérer). À l'écran il apparaît comme un repère discret ; à
 * l'impression et à l'export PDF il force le passage à la page suivante
 * (la règle `break-after` vit dans la feuille du contenu de l'éditeur).
 *
 * Le nœud est sans contenu et sélectionnable : la touche Suppr le retire
 * comme n'importe quel autre bloc.
 */
export const PageBreak = Node.create({
  name: "pageBreak",
  group: "block",
  atom: true,
  selectable: true,

  parseHTML() {
    return [{ tag: "div[data-page-break]" }];
  },

  renderHTML() {
    return ["div", { "data-page-break": "true", class: "workspace-page-break" }];
  },
});
