import type { Node as PmNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { type Editor, Extension } from "@tiptap/react";
import {
  collectTextSlices,
  findMatches,
  type SearchMatch,
  type WalkableNode,
} from "../search-text.ts";

/**
 * Surlignage des occurrences de la recherche.
 *
 * Plugin ProseMirror sans effet sur le document : il ne produit que des
 * décorations de vue. Aucune transaction de document, donc pas d'entrée dans
 * l'historique, pas de sauvegarde automatique, et rien à synchroniser en
 * collaboration — les autres collaborateurs voient leurs propres surlignages.
 *
 * La requête voyage dans une méta de transaction : changer de requête ne
 * modifie pas le document, ProseMirror recalcule malgré tout les décorations,
 * et le pont clavier reste hors du circuit d'édition.
 */

/** Méta de transaction portant la recherche courante. */
export const searchMetaKey = "workspace.search";

export const searchPluginKey = new PluginKey<SearchValue>("workspaceSearch");

/** État de recherche tenu par le plugin. */
export type SearchValue = {
  /** Requête normalisée (casse et accents déjà repliés par `findMatches`). */
  query: string;
  /** Occurrence active : c'est elle qui porte la décoration marquée. */
  activeIndex: number;
};

/** Recherche vide : aucune décoration. */
export const EMPTY_SEARCH: SearchValue = { query: "", activeIndex: 0 };

/** Extensions Tiptap à ajouter à l'éditeur, qu'il soit local ou collaboratif. */
export const SearchHighlight = Extension.create({
  name: "workspaceSearch",

  addProseMirrorPlugins() {
    return [
      new Plugin<SearchValue>({
        key: searchPluginKey,
        state: {
          init: () => EMPTY_SEARCH,
          apply: (transaction, value) => {
            // Une méta absente conserve l'état : transactions de frappe,
            // annulations, et passthrough de la collaboration.
            const next = transaction.getMeta(searchMetaKey);
            return (next as SearchValue | undefined) ?? value;
          },
        },
        props: {
          decorations: (state) => {
            const value = searchPluginKey.getState(state);
            if (!value || value.query.length === 0) return DecorationSet.empty;
            return highlightMatches(state.doc, value);
          },
        },
      }),
    ];
  },
});

/**
 * Occurrences d'une requête explicite, dans le document courant.
 *
 * Unique point de contact avec ProseMirror : `collectTextSlices` reste pure et
 * se teste avec de simples doubles de nœuds.
 */
export function matchesIn(editor: Editor, query: string): SearchMatch[] {
  if (query.length === 0) return [];
  return findMatches(collectTextSlices(editor.state.doc as unknown as WalkableNode), query);
}

/** Surlignages de toutes les occurrences, l'active étant distinguée. */
export function highlightMatches(doc: PmNode, value: SearchValue): DecorationSet {
  const matches = findMatches(collectTextSlices(doc as unknown as WalkableNode), value.query);
  const active = Math.min(Math.max(value.activeIndex, 0), matches.length - 1);
  return DecorationSet.create(
    doc,
    matches.map((match: SearchMatch, index: number) =>
      Decoration.inline(match.from, match.to, {
        class:
          index === active
            ? "workspace-search-hit workspace-search-hit-active"
            : "workspace-search-hit",
      }),
    ),
  );
}

/**
 * Publie une recherche dans l'éditeur. La transaction ne contient qu'une méta :
 * le document n'est pas touché, aucun déclencheur d'autosave n'a lieu.
 */
export function setSearch(editor: Editor, value: SearchValue): void {
  editor.view.dispatch(editor.state.tr.setMeta(searchMetaKey, value));
}
