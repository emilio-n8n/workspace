# Armada — escouade home

## Missions

- [x] TASK-001 : Landing: sections hero→fonctions→captures→tarifs→FAQ→CTA, hiérarchie de titres h1→h2→h3 et textes alternatifs
- [x] TASK-002 : Landing accessibilité totale: skip link, landmarks, ordre de tabulation, focus visible sur tous les interactifs
- [x] TASK-003 : Landing performance: dimensions d'images explicites, preconnect, zéro décalage de mise en page
- [x] TASK-004 : Tableau de bord: actions rapides (nouveau doc/feuille/évènement) fonctionnelles
- [x] TASK-005 : Tableau de bord: regroupement des fichiers récents (Aujourd'hui/Cette semaine) + dates relatives FR
- [x] TASK-006 : États vides utiles sur toutes les listes du tableau de bord (illustration + action)
- [ ] TASK-007 : Squelettes de chargement à la place des spinners
- [ ] TASK-008 : Connexion/inscription: validation en direct et erreurs actionnables en français
- [ ] TASK-009 : Page tarifs: structure accessible, texte FR relu
- [ ] TASK-010 : FAQ en details/summary accessible au clavier
- [ ] TASK-011 : Navigation mobile responsive (menu, focus, contenu non rogné)
- [ ] TASK-012 : Raccourcis clavier globaux documentés (⌘K déjà câblé)
- [ ] TASK-013 : Pied de page sémantique (liens, mentions, langue)
- [ ] TASK-014 : Branding: titre, meta et Open Graph cohérents

## Journal

### TASK-001 → TASK-003 — page d'accueil publique

Fichiers : `apps/home/src/routes/index.tsx`, `apps/home/src/landing/content.ts`,
`apps/home/src/landing/sections.tsx`, `apps/home/src/landing/mockups.tsx`.

- **Contenu (001)** : six sections dans l'ordre — héros, fonctionnalités, captures,
  tarifs, questions fréquentes, appel à l'action. Un seul `<h1>`, un `<h2>` par
  section, des `<h3>` à l'intérieur : aucun niveau sauté. Les trois captures sont
  des maquettes SVG nommées par le titre de leur `<figcaption>`
  (`aria-labelledby`), donc pas de texte alternatif dupliqué. Copie française
  relue, sans promesse en avance sur le produit (« Bientôt disponible » pour
  l'offre d'assistance, avancement réel pour les applications).
- **Accessibilité (002)** : lien d'évitement « Aller au contenu » en premier
  élément focusable, repères nommés (`banner`, `main`, `contentinfo`,
  `nav` étiquetées, `complementary` pour le panneau des applications), ordre de
  tabulation identique à l'ordre visuel, `focus-visible` (jetons `ring`) sur tous
  les interactifs — y compris les `<summary>` de la FAQ et le menu mobile
  (`aria-expanded`/`aria-controls`, fermeture par Échap). Les
  `<a href><button></a>` imbriqués de l'ancienne page disparaissent.
- **Performance (003)** : chaque média déclare ses dimensions (`width`/`height`
  640×400 + `h-auto w-full`), le rapport 8/5 est donc réservé avant l'application
  de la feuille de styles : aucun décalage de mise en page. Les illustrations
  sont des SVG en ligne (aucune requête, aucun saut de thème entre clair et
  sombre), les polices restent auto-hébergées.

**Écart assumé — `preconnect`** : la page ne contacte aucune origine externe
(polices auto-hébergées, aucune image distante). Une balise `preconnect` vers une
origine non contactée ouvrirait une connexion DNS/TCP/TLS pour rien. Le
mécanisme est en place et documenté : la liste `externalOrigins` de
`index.tsx` alimente `head.links` — le jour où une ressource tierce apparaît,
l'indice est émis sans autre changement.

**Vérifications** : `pnpm --filter @app/home typecheck` (aucune erreur dans
`apps/home` ; les erreurs restantes viennent de `modules/**`, travaillés par
d'autres escouades) et `pnpm exec biome check apps/home/src/landing
apps/home/src/routes/index.tsx` (vert). Tests e2e non lancés (hors périmètre de
vérification léger) ; les libellés attendus par `e2e/parcours.spec.ts` sont
conservés (« La suite bureautique libre », « Ouvrir l'application » en un seul
exemplaire, « AGPL-3.0-only », bascule de thème).

### TASK-004 → TASK-006 — tableau de bord (`/app`)

Fichiers : `apps/home/src/routes/app/index.tsx`,
`apps/home/src/dashboard/{dates,format,quick-actions,recent-files}.ts(x)`,
`apps/home/src/routes/app/recherche.tsx`.

- **Actions rapides (004)** : six cartes. Feuille de calcul et présentation sont
  créées par appel serveur puis ouvertes dans Sheets / Slides — clic unique, sans
  écran intermédiaire (même contrat que le menu « Nouveau » de Drive et que le
  parcours e2e « raccourcis du tableau de bord : créer une feuille »). Titre par
  défaut daté à la minute (« Feuille du 13 octobre 2026 à 14 h 32 »), corrigeable
  en un clic dans l'application ouverte. Document, formulaire, évènement et tâche
  se créent dans leur application : la carte y mène et l'annonce par une
  infobulle — aucune action qui promet une création qu'elle ne fait pas. États :
  carte en attente (`aria-busy` + « Création… »), annonce polie `role="status"`,
  erreur en `role="alert"` avec le message serveur en français.
- **Fichiers récents (005)** : regroupement Aujourd'hui / Cette semaine / Plus
  tôt par jour calendaire (compteur de fichiers par groupe), dates relatives
  françaises (« à l'instant », « il y a 12 min », « hier », « il y a 3
  semaines »), filtre par type (Select accessible), lien profond par fichier
  (Docs / Sheets / Slides / Forms), snippets de chargement à hauteur réservée.
- **États (006)** : liste « Reprendre » — vide sans filtre (illustration + «
  Ouvrir Drive »), vide avec filtre (illustration + « Voir tous les types »),
  erreur (bandeau + « Réessayer », le reste de la page tient), chargement
  (squelettes). Même traitement pour la recherche globale (`EmptyState`,
  `Alert`, région `role="status"`).
- **Contraintes respectées** : `@workspace/docs` et `@workspace/calendar` ne sont
  pas des dépendances de `@app/home` (aucune installation possible) : leurs
  créations restent dans leurs applications, la navigation est explicite.
