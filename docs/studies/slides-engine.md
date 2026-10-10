# S3 — Moteur de présentations (module Slides)

> Étude technique pré-ADR — suite **Workspace** (auto-hébergeable, AGPL-3.0-only, TanStack Start + React + TypeScript strict).
> Date : 10 octobre 2026. Statut : proposition pour revue. ADR attendu : « moteur Slides ».
> Méthode : état de l'art vérifié par recherche web à la date ci-dessus. Tout chiffre invérifiable ou auto-déclaré est signalé explicitement. Les estimations de charge sont des ordres de grandeur d'ingénierie, à confirmer par POC.

## 1. Contexte & besoin

Slides est le module le plus difficile de la suite : contrairement aux documents et aux tableurs, il n'existe **aucun moteur web OSS dominant** (équivalent de ce que ProseMirror/Luckysheet&nbsp;—&nbsp;ou Univer Sheets&nbsp;—&nbsp;représentent pour leurs domaines). Le marché est occupé par des produits fermés (PowerPoint Online, Google Slides, Pitch) et des SDK commerciaux (Univer Pro, tldraw). Toute stratégie « on branche un moteur existant » se heurte donc soit à une licence non libre, soit à un périmètre OSS amputé, soit à une UI impossible à aligner avec le reste de la suite.

Le besoin produit est un éditeur WYSIWYG de diapositives intégré au monolithe modulaire, avec interopérabilité OOXML crédible (lecture raisonnable de fichiers .pptx existants, export fidèle), sur des serveurs modestes (4 cœurs / 8 Go).

### Périmètre MVP proposé (v1, volontairement resserré)

- Diapositives : créer, dupliquer, réordonner, supprimer, gabarits/mises en page simples (titre, contenu, deux colonnes, vide), arrière-plans.
- Contenu : zones de texte riches (gras/italique/souligné, taille, police, couleur, alignement, listes simples), images (upload, redimensionnement, recadrage simple + crop), formes (rectangle, ellipse, ligne, flèche), z-order, alignement/répartition de base, guides.
- Thèmes simples : palette + paire de polices + arrière-plans maîtres, appliqués via variables de thème.
- Mode présentation : plein écran, navigation clavier/souris, notes de présentateur (panneau), vue miniatures.
- Fichiers : export PPTX (PptxGenJS), export PDF (impression navigateur puis, en option, service LibreOffice), sauvegarde native JSON versionnée, import best-effort de .pptx (phase 2).
- Hors périmètre v1 (assumé) : animations/transitions avancées, SmartArt, graphiques et tableaux éditables, objets multimédias, co-édition temps réel, ODP/ODS en entrée. Ces éléments viendront en phases 2/3 ou via un mode « compatibilité » sidecar (option E).

## 2. Candidats (état vérifié en 2026)

### 2.1 Univer (dream-num) — SDK TypeScript, Apache-2.0 (OSS) + Pro commercial

- Version 1.0 publiée le 23 septembre 2026 (6 éditeurs : Sheets, Docs, Slides, Boards, Bases, PDF). Dépôt `dream-num/univer` : 22,5 k★, Apache-2.0, très actif (mise à jour continue, référence « dev »).
- **Point critique** : le README officiel sépare explicitement OSS et Pro. Pour Slides, l'OSS fournit « le modèle de présentation et les paquets d'UI d'édition » — le reste (import/export de fichiers, graphiques, tableaux, infrastructure de formes, collaboration) est **Pro, sous licence commerciale**, avec filigrane et limites sans clé de licence (essai 30 jours). La documentation Slides fournie est encore en `1.0.0-beta.2` et installe les paquets `@univerjs-pro/slides*`.
- Paquet OSS `@univerjs/slides` : 1.0.4, Apache-2.0 (npm). Des observations de tiers rapportent que la démo Slides du showcase officiel affiche « License Required » — cohérent avec la répartition ci-dessus (source secondaire, non vérifiée par nos soins).
- Témoin utile : **Casual Slides** (CasualOffice, Apache-2.0, v0.1.0 du 1er juin 2026, 7★) est un éditeur self-hosted construit sur Univer **OSS 0.24.x épinglé + `pnpm patch`** pour combler des manques (rev tracking de collaboration, mutations d'éléments, tables/charts). Il revendique 68/87 sondes de fidélité .pptx réussies. Projet très jeune, mono-équipe, mais c'est la preuve de faisabilité d'un chemin 100 % OSS sur Univer… au prix d'un fork à maintenir.
- Gouvernance : société (DreamNum Co., Ltd.), modèle open-core assumé. Bus factor : bon côté OSS, mais la feuille de route Slides est tirée par le produit commercial.

### 2.2 Construction maison — React + canvas + briques ciblées

- **Konva 10.5.0** (MIT, ~14,8 k★, publié la veille de cette étude ; maintenu depuis 2015 par l'équipe Konva.js, créateur Anton Lavrenov) et **react-konva 6.4 k★** (MIT) : scène graphique, événements, drag & drop, transforms, export. Intégration React de premier ordre. Concurrent : **Fabric.js 7.4.0** (MIT, ~31 k★), plus lourd et à cadence de publication plus lente (release il y a ~4 mois), à réserver si l'on veut son parseur SVG/controls intégrés.
- **reveal.js v6** (MIT, maintenu par Hakim El Hattab, v6 = build Vite, activité 2026 réelle) pour le mode présentation (navigation, fragments, notes, print PDF). Alternatives : Slidev (MIT) et Marp (MIT) — excellents mais orientés Markdown, pas WYSIWYG ; simples références, pas des briques d'édition.
- Modèle de scène : à concevoir (JSON versionné, transforms, z-order, thème). C'est le cœur de l'effort, mais aussi de la maîtrise.

### 2.3 PPTist (Vue 3, AGPL-3.0) — l'application la plus mature

- 9,4 k★, 1,8 k forks, dépôt actif (dernier push le 10 octobre 2026), mono-mainteneur (pipipi-pikachu) avec miroirs Gitee/GitCode et double licence (AGPL-3.0 ou licence commerciale).
- Périmètre impressionnant : texte riche, formes, lignes, images, tableaux, graphiques, formules LaTeX, vidéo/audio, présentation, AIPPT. **Import PPTX auto-déclaré ≈ 85 %, export ≈ 95 %** (chiffres de l'auteur, non audités indépendamment).
- Bibliothèque d'import associée : **pptxtojson** (MIT, 454★), parseur .pptx first-in-browser qui produit du JSON exploitable ; c'est un composant réutilisable **indépendamment** de PPTist. Autres briques d'import repérées : PptxViewJS (MIT, très jeune : 1 commit, 22★ — risque élevé), pipto (MIT, 5★, anecdotique).
- Limite structurelle : c'est une **application monolithique Vue 3**, pas une bibliothèque. L'intégrer dans un monolithe React/TanStack implique iframe (UI non intégrable) ou portage.

### 2.4 Exports et conversions

- **PptxGenJS 4.0.1** (MIT, ~2,2 M téléchargements/semaine, dernière publication il y a ~1 an) : génération PPTX côté navigateur/Node, utilisée par PPTist et Casual Slides. Usage massif mais maintenance au ralenti (mono-mainteneur).
- **LibreOffice headless** (MPL-2.0 ; branches actives 26.2.6 du 4 septembre 2026 et 26.8 du 26 août 2026) : `soffice --headless --convert-to pdf` est le moyen le plus fidèle de rendre un .pptx en PDF côté serveur (~2–3 s pour un petit fichier selon un aide-mémoire tiers). **unoserver 3.7** (MIT, juin 2026, 939★) mutualise les conversions via une instance persistante. Pistes WASM (LibreOffice compilé en WebAssembly) encore jeunes : ZetaOffice/zetajs (allotropia ; le wrapper est MIT, l'offre ZetaOffice est commerciale) et `@matbee/libreoffice-converter` (MPL-2.0, très récent) — à surveiller, pas à retenir pour le MVP.
- La TDF a annoncé (mai 2026) une stratégie « LibreOffice mobile + web » (WASM/Qt6) : sans engagement de date, signal à suivre (source secondaire).

### 2.5 Sidecars « suite complète »

- **ONLYOFFICE Docs 9.4** (19 mai 2026). Community **AGPLv3** (donc compatible avec un produit AGPL-3.0-only). Fidélité OOXML native et collaboration incluses. Mais : marque et branding **non retirables** en Community, « jusqu'à 20 utilisateurs recommandés », pas de clustering ni d'admin panel, pas de web mobile ; white-label et scalabilité en édition commerciale. Intégration par iframe (api.js + JWT), le serveur de documents doit accéder au stockage.
- **Collabora Online / CODE 26.04.4.2** (24 septembre 2026). Code source **MPL-2.0** ; les binaires distribués ont des « conditions additionnelles » (EULA). CODE est gratuit pour domicile/test/petites équipes mais **explicitement déconseillé en production** ; l'usage production passe par un abonnement (≈ 3 €/utilisateur/mois jusqu'à 99 utilisateurs), avec SLA. Intégration WOPI ; qualité Impress réelle (notes dans l'éditeur, interop PPTX en progrès constants).

### 2.6 Éditeurs génériques à détourner

- **Excalidraw** (MIT, 96 k★) : excellent whiteboard infini, embeddable en React… mais **aucun modèle de diapositives** (pas de pages, transitions, mode présentateur, export PPTX). Le détourner reviendrait à écrire tout le métier Slides par-dessus, en héritant d'une UI « croquis » inadaptée. Écarté pour ce module.
- **tldraw** (v3.15.x, oct. 2026) : licence **source-available non OSI** ; l'usage production exige une clé de licence et interdit le retrait du filigrane. Incompatible avec un produit distribué sous AGPL. Écarté sans ambiguïté.

## 3. Comparaison multicritère

| Candidat | Licence / compat AGPL | Self-host & poids | Sécurité / surface | Intégration React/TS | Import / export & fidélité | Collaboration | Perso UI | Performance | Effort (sem., est.) | Risques |
|---|---|---|---|---|---|---|---|---|---|---|
| **Univer OSS** (+ Pro) | Apache-2.0 compat. ; Pro commercial exclu | Excellent (lib), cœur léger | Surface classique d'un SDK navigateur | Très bon (TS, React 18/19) | **OSS : aucun import/export** ; Pro : complet | OSS : modèle seul ; Pro : complète | Bonne (plugins, thèmes) | Canvas, bon sur grosses scènes | 4–8 sem. pour l'édition de base, **mais MVP impossible sans Pro** ; fork+patch façon Casual : 10–16 sem. + dette | Périmètre OSS amputé, dépendance à la roadmap commerciale, patchs à maintenir |
| **Maison (Konva + reveal.js + pptxgenjs)** | MIT partout, compat. AGPL | Parfait, serveur inchangé | Maîtrisée ; seul risque = service LibreOffice optionnel | Excellente (react-konva, TS strict) | Export PPTX bon (pptxgenjs) ; import = phase 2 via pptxtojson (~85 % annoncé) ; PDF haute fidélité via LibreOffice | À construire (Yjs en phase 3) | **Totale** (design system maison) | Client canvas fluide ; coût serveur nul par défaut | **14–22 sem.** (MVP resserré), 6–8 sem. de plus pour import/finitions | Effort réel élevé ; édition de texte riche sur canvas = risque n°1 ; pptxgenjs peu maintenu |
| **PPTist** | AGPL-3.0 compat. (ou licence com.) | App autonome ; self-host ok | Bonne (app éprouvée) | Faible (Vue 3 monolithique) | ≈ 85 % entrée / ≈ 95 % sortie (auto-déclaré) | Non (pas de temps réel) | Faible sans portage | Correcte (Vue) | Iframe + passerelle : 3–5 sem. ; portage React : 12–20+ sem. | Mono-mainteneur ; UI impossible à fondre ; fork long terme |
| **ONLYOFFICE Docs (sidecar)** | AGPLv3 compat. | 2–4 conteneurs lourds, à dimensionner | Surface iframe/JWT ; éditeur tiers exposé au réseau | Intégration par iframe | **Fidélité OOXML native, référence du marché** | Oui (temps réel inclus) | Marquage ONLYOFFICE obligatoire | Charge serveur significative | 3–6 sem. (JWT, stockage, SSO) | UI étrangère, poids, limites Community (≈ 20 util., pas de white-label) |
| **Collabora Online / CODE (sidecar)** | MPL-2.0 (source) ; binaires EULA ; prod payante | Idem, base LibreOffice | Idem ; sandbox Landlock en progrès | Intégration WOPI/iframe | Très bonne (moteur LibreOffice Impress) | Oui | Marquage Collabora | Charge serveur significative | 3–6 sem. + coût licence prod (≈ 3 €/util./mois) | Licence production payante ; CODE non recommandé en prod ; complexité |
| **Excalidraw** | MIT compat. | Léger | Bonne | Excellente (composant React) | Aucun (pas de PPTX, pas de PDF diapos) | Oui (via backend propre) | UI croquis, hors marque | Bonne | 8+ sem. pour un résultat inadapté | Mauvais modèle de données ; impasse produit |
| **tldraw** | **Non OSI**, watermark + clé en prod | — | — | Excellente | — | Oui (payant) | — | — | — | Licence incompatible avec le projet |

Légende : les colonnes « Effort » sont des estimations de l'auteur de l'étude, à affiner par POC (hypothèse : 1–2 développeurs familiers avec la stack).

## 4. Options d'architecture

### Option A — Tout maison
Cœur : modèle de scène JSON + rendu react-konva + overlay DOM pour l'édition de texte ; présentation : reveal.js ou visionneuse plein écran maison ; export : pptxgenjs (client, Web Worker) ; PDF : impression navigateur, puis service LibreOffice headless optionnel ; import : pptxtojson.
**Coûts** : 14–22 semaines pour le MVP ; maintenance à vie. **Bénéfices** : UI 100 % cohérente, licence propre (MIT partout), zéro composant tiers lourd, performance maîtrisée des deux côtés, modèle de données CRDT-friendly pour la collaboration future.

### Option B — Univer OSS (+ fork/patch)
Édition de base rapide, runtime éprouvé, Facade API. **Coûts** : 4–8 semaines initiales, mais le périmètre OSS ne couvre ni import/export ni collaboration ; le chemin complet = fork + patchs (modèle démontré par Casual Slides) = 10–16 semaines + veille de compatibilité à chaque montée de version. **Bénéfices** : le plus rapide *si* l'on accepte la dette de fork ; écosystème TS moderne. **Risque stratégique** : les fonctions vitales (fichiers) restent l'aimant commercial de DreamNum ; dépendre d'un open-core pour le cœur d'un produit AGPL est un pari défavorable.

### Option C — Sidecar ONLYOFFICE (cœur remplacé par l'iframe)
**Coûts** : 3–6 semaines ; opérer un Document Server dédié. **Bénéfices** : fidélité OOXML et collaboration immédiates, AGPL. **Inconvénients** : UI incohérente avec la suite (critère explicite du projet), branding ONLYOFFICE, limites Community, poids d'exploitation contraire à l'objectif « machines modestes », dépendance forte à un éditeur tiers pour le cœur du module.

### Option D — Sidecar Collabora
Mêmes écueils, plus la licence de production payante (CODE n'étant pas une cible prod). À garder en tête comme « mode compatibilité » entreprise, pas comme fondation.

### Option E — Hybride (recommandée)
Cœur maison (option A) + briques OOXML ciblées :
1. export PPTX via **pptxgenjs** (Web Worker) et export PDF via impression, puis **service LibreOffice headless poolé** (unoserver) pour la haute fidélité ;
2. import .pptx en **phase 2** via **pptxtojson** (MIT), best-effort, avec repli « aperçu » : conversion du .pptx en PDF par le service LibreOffice pour les présentations non importables proprement ;
3. **sidecar ONLYOFFICE optionnel**, activable par instance (extension/plugin), réservé à l'édition fidèle de fichiers complexes et aux équipes > 20 ;
4. présentation via **reveal.js** si le POC valide la coexistence avec un rendu canvas, sinon visionneuse maison (un seul pipeline de rendu = moins de divergence).

**Bénéfices** : cohérence UI et licence par défaut irréprochable ; interopérabilité par paliers ; aucun composant lourd dans le chemin nominal ; le sidecar devient une option, pas une dépendance. **Coûts** : effort maison le plus élevé, mais étalé et sous notre contrôle.

## 5. Recommandation

**Retenir l'option E : moteur maison + briques OOXML (pptxgenjs, pptxtojson) + service de conversion LibreOffice optionnel + sidecar ONLYOFFICE optionnel hors cœur.**

Justification :
- **Cohérence** : c'est le seul chemin qui garantit l'UI unifiée exigée par le projet ; ni Univer Pro, ni ONLYOFFICE, ni PPTist ne le permettent.
- **Licence** : 100 % de briques MIT/Apache-2.0 dans le chemin nominal ; le projet reste distribuable sous AGPL-3.0-only sans obligation tierce (le sidecar ONLYOFFICE AGPL reste compatible s'il est activé, avec sa marque conservée).
- **Sobriété** : aucun serveur supplémentaire par défaut ; le service LibreOffice n'est sollicité que pour PDF/aperçus, en conteneur isolé, dimensionné pour 4 cœurs / 8 Go.
- **Interopérabilité honnête** : export PPTX bon dès le MVP ; import .pptx en best-effort assumé (≈ 85 % annoncé par l'écosystème PPTist, à mesurer) avec repli aperçu PDF ; jamais de promesse de fidélité pixel à pixel.

### Plan d'intégration progressif

| Phase | Contenu | Durée (est.) | Critère de sortie |
|---|---|---|---|
| **0 — POC** | Risques techniques : édition de texte (canvas vs overlay DOM), perf deck 100 diapos sur 4 cœurs/8 Go, aller-retour PPTX (pptxgenjs → PowerPoint/LibreOffice) | 2–3 sem. | Feu vert sur les 3 risques, sinon révision du périmètre |
| **1 — MVP** | Modèle de scène, éditeur (texte, images, formes, thèmes simples), miniatures, mode présentation, export PPTX + PDF, sauvegarde JSON | 8–12 sem. | Démo interne : créer un deck de 20 diapos et l'exporter proprement |
| **2 — Interop** | Import .pptx via pptxtojson, notes de présentateur, tableaux lecture seule, service LibreOffice (pooling, sandbox, quotas) | 6–8 sem. | Import réussi sur un corpus de decks réels ≥ 70 % sans retouche |
| **3 — Collaboration** | Co-édition (Yjs/hocuspocus… à arbitrer avec S1/S2 pour l'unicité du socle temps réel), transitions simples | 6–10 sem. | Deux éditeurs simultanés sans perte, recharge après crash |
| **4 — Options avancées** | Sidecar ONLYOFFICE activable, graphiques, animations, ODP | à décider | — |

Point de séquencement : Slides ne devrait démarrer le MVP **qu'après** stabilisation des socles partagés (stockage, permissions, temps réel) issus de S1/S2, sous peine de dupliquer des plomberies.

### Pourquoi pas les autres

- **Univer OSS seul** : ne couvre pas import/export (Pro), donc pas le MVP ; le fork+patch est un chemin viable mais coûteux et fragile, à réévaluer si DreamNum ouvre davantage l'OSS (à re-tester à chaque mineure 1.x).
- **Univer Pro** : licence commerciale, filigrane sans clé, incompatible avec la distribution libre du projet, et contraire à l'exigence d'auto-hébergement sans dépendance propriétaire.
- **PPTist** : la plus mature, mais application Vue monolithique ; l'adopter = porter un produit entier (coût 12–20+ semaines et divergence UI), ou iframe = incohérence assumée. On **réutilise en revanche son écosystème MIT** : `pptxtojson` pour l'import (et ses idées d'architecture comme référence).
- **Sidecars ONLYOFFICE/Collabora comme cœur** : UI étrangère, poids d'exploitation, branding imposé, limites Community (ONLYOFFICE) ou coût récurrent (Collabora) — incompatibles avec l'objectif « suite cohérente et sobre ».
- **Excalidraw** : mauvais modèle de données (whiteboard, pas de diapos) ; le détournement coûte plus cher que le moteur maison en réutilisant Konva.
- **tldraw** : licence non OSI, watermark et clé en production — disqualifié pour un produit distribué.
- **Fabric.js** : alternative acceptable mais redondante avec Konva, plus lourde et sans binding React aussi solide ; à garder en réserve.

## 6. Questions ouvertes / POC à valider

1. **Édition de texte riche** : canvas natif (contrôle total, IME/accessibilité difficiles) vs overlay DOM contenteditable synchronisé sur la scène (meilleur IME, a11y, mais synchronisation plus délicate). C'est le risque n°1 du moteur maison — POC obligatoire.
2. **Fidélité réelle de l'import pptxtojson** : mesurer sur un corpus hétérogène (PowerPoint desktop, exports Google Slides/LibreOffice, decks « sales » : SmartArt, thèmes, polices manquantes). Définir le seuil de bascule vers l'aperçu PDF.
3. **Round-trip PPTX** : pptxgenjs produit-il des fichiers ouvrables sans avertissement dans PowerPoint desktop, LibreOffice Impress et Google Slides (thèmes, polices, alignements) ? Tester aussi les polices absentes (métriques Calibri/Carlito).
4. **Service LibreOffice** : pooling (unoserver) vs processus par job ; sandboxing (conteneur sans réseau sortant, limites CPU/RAM, Landlock si disponible) ; temps de conversion réel sur 4 cœurs ; protection zip-bomb/XML malformé.
5. **reveal.js ou visionneuse maison** : la coexistence d'un rendu canvas (édition) et HTML (présentation) crée-t-elle une divergence de rendu perceptible ? Sinon, un seul pipeline maison suffit.
6. **Maintenance de pptxgenjs** (dernière publication ~2025) : plan B = fork maintenu en interne, ou émettre nous-mêmes les surcouches OOXML manquantes ; à trancher à la phase 2.
7. **Sort du sidecar** : l'option ONLYOFFICE (marque conservée, ≈ 20 utilisateurs Community) doit-elle être proposée dès la v1 en extension, ou attendre une demande ? Impact sur la doc d'exploitation.
8. **Univer, veille** : re-vérifier à chaque release 1.x si import/export Slides rejoignent l'OSS ; recroiser avec l'avancement de Casual Slides (fork OSS + patchs) comme sentinelle.
9. **Accessibilité** : un rendu canvas pose des défis ARIA/lecteur d'écran ; définir le niveau visé (WCAG AA ?) et un mode « outline » textuel pour la lecture assistée.
10. **Séquencement vs S1/S2** : les décisions collaborateurs (Yjs ?) doivent être communes aux trois éditeurs ; Slides doit consommer le socle, pas en inventer un.

## 7. Sources

Consultées le 10 octobre 2026.

**Univer**
- https://github.com/dream-num/univer
- https://docs.univer.ai/blog/univer-1-0
- https://docs.univer.ai/guides/slides/getting-started/installation.md
- https://docs.univer.ai/guides/pro/license
- https://registry.npmjs.org/@univerjs/slides/latest
- https://github.com/CasualOffice/slides
- https://casualoffice.org/casual-slides
- https://bisque.today/p/github-trending/2026-09-22-univer (source secondaire, observation « License Required »)

**Moteur maison & briques**
- https://github.com/konvajs/konva
- https://www.npmjs.com/package/konva
- https://konvajs.org/docs/about.html
- https://github.com/fabricjs/fabric.js
- https://www.npmjs.com/package/fabric
- https://github.com/gitbrent/PptxGenJS
- https://www.npmjs.com/package/pptxgenjs
- https://github.com/pipipi-pikachu/pptxtojson
- https://github.com/gptsci/pptxviewjs
- https://github.com/gezhiheng/pipto

**PPTist**
- https://github.com/pipipi-pikachu/PPTist
- https://api.github.com/repos/pipipi-pikachu/PPTist (métadonnées : 9 377★, AGPL-3.0, push du 10/10/2026)

**Présentation**
- https://github.com/hakimel/reveal.js
- https://revealjs.com/upgrading (v5 → v6)
- https://github.com/slidevjs/slidev
- https://github.com/marp-team/marp

**Whiteboards (écartés)**
- https://github.com/excalidraw/excalidraw
- https://docs.excalidraw.com/docs/@excalidraw/excalidraw/installation
- https://github.com/tldraw/tldraw/blob/main/LICENSE.md
- https://tldraw.dev/community/license

**Sidecars**
- https://github.com/ONLYOFFICE/DocumentServer
- https://www.onlyoffice.com/compare-editions
- https://helpcenter.onlyoffice.com/docs/faq/docs-community.aspx
- https://www.onlyoffice.com/blog/2026/05/onlyoffice-docs-9-4
- https://www.onlyoffice.com/blog/2026/05/onlyoffice-license-and-trademark-policy
- https://github.com/CollaboraOnline/online
- https://www.collaboraonline.com/code-26-04-release-notes/
- https://www.collaboraonline.com/subscriptions/
- https://www.collaboraonline.com/faqs/

**LibreOffice & conversions**
- https://blog.documentfoundation.org/blog/2026/08/05/libreoffice-project-and-community-recap-july-2026 (versions 26.2.6 / 26.8)
- https://github.com/unoconv/unoserver (MIT, 939★ ; PyPI unoserver 3.7, juin 2026 : https://pypi.org/project/unoserver/)
- https://github.com/converterer/libreoffice-headless-cheatsheet (commande `--convert-to pdf`, ~2–3 s sur petit VPS ; source tierce)
- https://github.com/allotropia/zetajs et https://nlnet.nl/project/ZetaOffice (piste WASM)
- https://libraries.io/npm/@matbee%2Flibreoffice-converter (convertisseur WASM MPL-2.0, très récent)
- https://en.libre-office.fr/article.php/libreoffice-to-launch-mobile-and-web-version-in-2026 (stratégie web/mobile TDF, source secondaire)

> **Limites de cette étude** : les pourcentages de fidélité PPTist sont auto-déclarés ; les tarifs Univer Pro ne sont pas publics ; la licence des binaires CODE comporte des conditions additionnelles au MPL-2.0 (à faire relire en cas d'adoption) ; les estimations de charge n'ont pas été validées par POC. Toute décision finale devrait être précédée de la phase 0 et consolidée en ADR.
