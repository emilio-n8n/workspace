# Refonte parité « Slides » — remettre toutes les apps au niveau

Statut : en cours (2026-10-15). Modèle de référence : la refonte **Slides**
(`modules/slides/src/ui/slides-editor.tsx`, `slide-canvas.tsx`,
`slide-filmstrip.tsx`) — l'éditeur doit se comporter comme un vrai outil
(Google Slides / PowerPoint web), pas comme un assemblage de panneaux.

## Le modèle Slides (résultat à reproduire)

1. **Barre d'outils unique et propre** : une seule rangée compacte, boutons
   `ghost`, groupes séparés par de fins séparateurs
   (`<span aria-hidden className="mx-1 h-4 w-px shrink-0 bg-border" />`),
   défilement horizontal si manque de place, hauteur ~`h-10`. Jamais de pavés
   de boutons empilés, jamais deux rangées de contrôles.
2. **Contexte d'abord** : les contrôles liés à une sélection n'apparaissent que
   lorsqu'ils s'appliquent (élément, texte, image, forme, plusieurs éléments →
   compteur + actions de lot). Les actions rares vont dans un **menu « ⋯ »**
   (`Menu` de `@workspace/ui`) ou un **dialogue centré**.
3. **Aucun panneau permanent de mise en forme** : les réglages vivent dans la
   barre, un menu, ou un dialogue. (Slides : le panneau droit a été supprimé
   complètement.)
4. **Édition en place** : clic = sélection ; taper/Entrée/2-clic = édition
   directement sur le contenu ; Échap sort. Pas d'édition via un panneau.
5. **Panneaux secondaires fermables et réouvrables** : tout panneau (Plan,
   Historique, listes, notes…) a une fermeture visible (croix) et un moyen
   évident de le rouvrir depuis la barre/l'en-tête. Barres latérales
   repliables.
6. **Adaptatif au viewport** : l'éditeur occupe toute la hauteur/largeur
   disponibles (`h-full min-h-0`), la page ne scrolle pas ; seules les zones
   internes scrollent. À petite largeur, les commandes se replient (menus) au
   lieu de casser la mise en page.
7. **Dialogues centrés** (déjà corrigé dans le primitif `Dialog` — ne pas
   surcharger `dialog.tsx`) : `max-h` + défilement interne pour les contenus
   longs.
8. **Historique fiable** : `Ctrl+Z` / `Ctrl+Shift+Z` / `Ctrl+Y` là où il y a
   de l'édition ; pas de toast d'annulation flottant parasite (Slides l'a
   remplacé par une pile de snapshots).
9. **Style** : tokens sémantiques uniquement (`bg-card`, `text-muted-foreground`,
   `border-border`…), FR, dark mode OK, aucune esthétique « IA générique »
   (pas de dégradés gratuits, pastels génériques, emojis partout).

## Contraintes absolues (pour toute intervention)

- **INTERDIT de modifier `e2e/suite-phase3.spec.ts`** ni aucun fichier `e2e/` :
  tous les noms accessibles existants (aria-label, rôle, texte) doivent
  continuer de fonctionner **à l'identique**. Les lister via `grep` sur le spec
  pour son app AVANT de changer un libellé.
- **Mode écriture seule** : aucune commande terminal (pas de pnpm/npm/node/git,
  pas de serveur). Lecture (`read`/`grep`/`glob`) + modification
  (`edit`/`write`) uniquement. La vérification est faite à la fin par la CI.
- Ne pas toucher : `modules/slides`, `apps/slides` (référence), ni
  `packages/ui/src/components/dialog.tsx` (déjà corrigé).
- Éviter de modifier `packages/ui` ; si un ajout est indispensable, il doit
  être **additif et rétrocompatible** (ex. une prop optionnelle) et signalé
  dans le rapport.
- Ne pas réécrire la mise en forme globale des fichiers (diff minimal) ; garder
  les exports/contrats utilisés par les tests unitaires des modules.
- Ne pas modifier `ROADMAP.md`, `TODO*` ni ce fichier.

## Apps — état d'avancement

| App | Code | Statut |
|---|---|---|
| Slides | `modules/slides` + `apps/slides` | ✅ FAIT — référence |
| Docs | `modules/docs` + `apps/docs` | ✅ FAIT (15/10) |
| Sheets | `modules/sheets` + `apps/sheets` | ✅ FAIT (15/10) |
| Agenda (Calendar) | `modules/calendar` + `apps/calendar` | ✅ FAIT (15/10) |
| Tâches (Tasks) | `modules/tasks` + `apps/tasks` | ✅ FAIT (15/10) |
| Mail | `modules/mail` + `apps/mail` | ✅ FAIT (15/10) |
| Drive | `modules/drive` + `apps/drive` | ✅ FAIT (15/10) |
| Meet | `modules/meet` + `apps/meet` | ✅ FAIT (15/10) |
| Forms | `modules/forms` + `apps/forms` | ✅ FAIT (15/10) |
| Chat | `modules/chat` + `apps/chat` | ✅ FAIT (15/10) |
| Collab | `apps/collab` | ✅ sans objet (serveur headless, pas d'UI) |
| Classroom | `modules/classroom` + `apps/classroom` | ✅ FAIT (15/10) |
| Sites | `modules/sites` + `apps/sites` | ✅ FAIT (15/10) |
| Admin | `modules/admin` + `apps/admin` | ✅ FAIT (15/10) |
| Accueil | `apps/home` | ✅ FAIT (15/10) |

### Notes d'audit déjà repérées

- **Docs** : `outline-panel.tsx` (aside « Plan ») et `version-history.tsx`
  (aside « Historique ») — vérifier fermeture/réouverture et s'ils ne sont pas
  permanents ; `toolbar.tsx` à passer au modèle (une rangée, ghost, menus).
- **Sheets** : aucun `aside` trouvé — auditer la barre d'outils + barre de
  formule (rangée unique ? menus contextuels ?) et l'occupation du viewport.
- **Calendar** : `calendar-sidebar.tsx` (aside gauche) — le rendre
  repliable/fermable ; les dialogues existent (event-editor, event-detail,
  quick-create) — vérifier qu'ils restent centrés/tidy.
- **Tasks** : `lists-sidebar.tsx` (aside gauche `w-64`) — repliable/fermable ;
  vérifier que la vue liste occupe bien le viewport.

### Rapport attendu (par app)

1. Audit : ce qui diverge de la checklist (avec fichiers).
2. Changements : fichiers modifiés + résumé court.
3. Noms accessibles E2E vérifiés (liste).
4. Points ouverts / ce qui n'a pas pu être fait.
