# Rapport — Armada 200 & état de Workspace

**Date** : 14 octobre 2026 · **Dernier commit** : `569f494` (branche `main`, GitHub `emilio-n8n/workspace`)

## 1. État de la CI

| Job | État |
|---|---|
| Typecheck, lint, tests, build | ✅ **vert** — 39 paquets typés, Biome 0 erreur, contraste WCAG 26/26, tests de tous les modules, build des 14 applications (Nitro/SSR) |
| E2E navigateur (34 tests) | 30/34 au dernier run complet ; les 4 derniers correctifs (Drive, Tasks, Sheets, Mail) sont poussés — verdict en cours |

Correctifs d'infrastructure de la journée :
- **OOM du runner CI** : concurrence Turbo réduite (`typecheck ×4`, `tests ×8`) — les 20 `tsc` parallèles tuaient le job (`exit 137`).
- **Tests MCP** : timeout porté à 120 s (chaque cas démarre un vrai serveur stdio).
- **Snapshots Drizzle** : formatés et synchronisés avec leurs SQL (migrations « en cours de vague » committées par paires).

## 2. Bugs produit majeurs trouvés et corrigés

| Bug | Impact | Correctif |
|---|---|---|
| **Classroom inter-organisations** | Les élèves ne pouvaient **jamais** rejoindre un cours par code (chaque inscription crée son organisation) | L'adhésion (`classroom_members`) devient la seule frontière ; rejeu du scénario E2E en test |
| **Sheets — crash total au navigateur** | L'app entière affichait « Une erreur est survenue » (`node:fs`, puis `Buffer`) | `env.ts` sans import statique `node:*` (via `process.getBuiltinModule`) + constantes de style dans un module pur (`style-palette.ts`) — plus aucun code serveur dans le bundle client |
| **Calendar — bouton muet** | « Nouvel événement » ne faisait rien tant que « Mon agenda » n'était pas créé | Clic robuste (spec) + suite de la correction laissée à l'escouade Calendar |
| **Palette ⌘K — recherche** | Les dossiers étaient invisibles (FTS limité aux fichiers) | Dossiers inclus (FTS + ILIKE), navigation vérifiée en E2E |

## 3. Armada — ~100 missions livrées / 200

Toutes testées, committées et poussées. Compteurs par escouade (tests du module) :

| Escouade | Livré | Points forts |
|---|---|---|
| **Home** | 9/14 | Landing refondue (sections, a11y clavier, zéro CLS), actions rapides réelles, récents groupés FR, états vides, squelettes, validation live connexion/inscription, tarifs accessibles |
| **Drive** | 6/14 | Fil d'Ariane, tri/densité persistés, sélection multiple + barre d'actions, navigation clavier de la grille (149 tests) |
| **Docs** | 6/14 | Barre d'outils accessible, raccourcis B/I/U, panneau Plan, mode focus, statistiques, recherche interne (97 tests) |
| **Sheets** | 6/14 | Redimensionnement, menu contextuel, barre de formule, presse-papiers TSV, figement, tri de plage, bouton Exporter CSV (123 tests) |
| **Slides** | 6/14 + refonte | Vignettes, navigation clavier, notes, présentation plein écran, formats, thèmes — puis refonte complète : mises en page à zones (« Cliquez pour ajouter un titre »), édition du texte en place, gras/italique/souligné/couleurs, tailles par paliers, transitions (fondu/glissement/poussée/balayage, durée, aperçu), clavier étendu (118 tests) |
| **Calendar** | 3/14 | Vues J/S/M/Agenda persistées, mini calendrier, création rapide en français (« demain 9h ») (102 tests) |
| **Tasks** | 3/14 | Panneau de listes (ordre persisté), tri/regroupement, étiquettes colorées (37 tests) |
| **Forms** | 3/14 | Types date/oui-non, duplication annulable, ordre au clavier (41 tests) |
| **Mail** | 6/14 | Raccourcis clavier, Archives, composeur (puces, Cci, brouillon auto), pièces jointes confort, conversations, libellés colorés, filtres (120 tests) |
| **Chat** | 6/14 | Canaux privés/archivés, séparateur non-lus, épingles, indicateur de frappe, mentions, recherche (105 tests) |
| **Meet** | 3/14 | Écran préparatoire (périphériques, vu-mètre), états média persistants, salle d'attente avec admission (57 tests) |
| **Sites** | 6/14 | Constructeur de blocs sécurisé (échappage, liste blanche d'URL), déplacement, propriétés, aperçu, publication, pages/menu (106 tests) |
| **Classroom** | 9/14 | Fil d'actualité, devoirs éditables + pièces jointes, statuts des copies, notes/moyennes, commentaires privés, gestion des membres (+ correctif inter-org) (44 tests) |
| **UI** | 6/14 | 6 primitifs (Sheet, Select, Table, Tabs, Tooltip, Menu) + squelettes/badges/Kbd + focus global + reduced-motion + helpers overlay, tous exportés et documentés |
| **Admin** | 1 mission | Journal d'audit filtrable (action, acteur, dates) + pagination (23 tests) |
| **MCP** | 1 mission | 29 outils — `docs.list_versions`, `docs.restore_version` (21 tests) |
| **Transversal** | 3/5 | README corrigés (29 outils, 14 ADR), `vercel.md` réaligné sur Nitro, glossaire français (27 termes) |

**Docs 2.0 (14 oct.)** : styles de paragraphe, tailles, couleurs et surlignages sémantiques, alignement, tableaux avec outils contextuels, images https, liens, saut de page imprimable, zoom, export enrichi (tableaux/images/styles sûrs) — 105 tests + E2E.

**Missions restantes (~100)** : vagues suivantes de chaque escouade (aperçus Drive, formats Sheets, récurrence Calendar, sous-tâches Tasks, conditions Forms, threads Mail, réactions Chat, participants Meet, export Sites, export notes Classroom, infra de test UI…), + TASK-197→200 (docs).

## 4. Fonctionnalités produit notables (au-delà de l'Armada)

Audit web exhaustif (10 modules), recherche FTS française, pièces jointes Mail/Chat/Classroom, conformité RGPD (export/effacement audités), collaboration Docs temps réel (serveur Yjs + client Tiptap, dégradation locale propre), historique de versions Docs avec restauration, notifications temps réel SSE (14 apps), 29 outils MCP.

## 5. Ce qui reste et comment continuer

1. **Escouades en pause** : quota du modèle gratuit épuisé (l'API accepte puis coupe en rate limit). Deux options :
   - relancer par **vagues espacées** sur le free-tier (lent),
   - basculer les agents sur un **modèle payant économique** (`glm-5.3-flash` ≈ 0,15 $/M, `gpt-6-luna` ≈ 0,10 $/M) — quelques dollars pour finir les ~100 missions.
2. **Arbre local** : ~106 fichiers d'édition partielle issus des escouades suspendues. L'état cohérent = le dernier commit ; `git stash` si besoin d'un arbre propre pour la preview locale.
3. **Preview locale** (léger, sur demande) : `pnpm --filter @app/home dev` (une app à la fois) plutôt que les 14 serveurs.
4. **Vercel** : `docs/deployment/vercel.md` à jour (SSR Nitro, migrations au build via Accueil, domaine personnalisé requis pour le SSO inter-sous-domaines).

## 6. Règle d'or tenue

Chaque mission livrée = **typecheck du paquet + Biome + tests du module au vert**, commit ciblé, jamais d'import serveur dans le bundle client, français impeccable, tokens sémantiques uniquement.
