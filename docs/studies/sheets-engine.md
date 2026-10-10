# S2 — Moteur de tableur (module Sheets)

> Étude technique pré-ADR — suite **Workspace** (auto-hébergeable, AGPL-3.0-only, TanStack Start + React + TypeScript strict + Tailwind v4 + PostgreSQL/Drizzle).
> Date : 10 octobre 2026. Statut : proposition pour revue. ADR attendu : « moteur Sheets ».
> Méthode : état de l'art vérifié par recherche web à la date ci-dessus (dépôts GitHub, registre npm, documentations officielles, textes de licence). Tout chiffre auto-déclaré, incertain ou invérifiable est signalé. Les estimations de charge sont des ordres de grandeur d'ingénierie, à confirmer par POC. Cette étude applique la grille commune de `docs/studies/README.md` et recoupe volontairement S3 (Slides) pour les briques partagées (échange OOXML, sidecars, socle temps réel).

## 1. Contexte & besoin

Contrairement au moteur de présentations (S3), le tableur web open source est un domaine mûr : il existe des moteurs complets (Univer, FortuneSheet, Luckysheet historiquement) et un moteur de formules headless de référence (HyperFormula). Le risque n'est donc pas l'absence de briques, mais l'articulation correcte entre : moteur d'édition, formules, formats de fichiers, collaboration et intégration à la suite (Drive, permissions, UI unifiée).

### Périmètre MVP proposé (v1, volontairement resserré)

- Classeurs multi-feuilles : créer, renommer, réordonner, dupliquer, supprimer ; sélection multi-plages, recopie (fill handle), copier/coller, annuler/rétablir.
- Saisie & calcul : valeurs (texte, nombre, date, devise, pourcentage, booléen) ; **formules courantes** (SUM, AVERAGE, IF, COUNT, COUNTIF, SUMIF, VLOOKUP, INDEX/MATCH, etc.).
- Présentation : formats numériques, alignement, gras/italique, couleurs, bordures simples, fusions, largeur/hauteur, figer les volets, validation de données et mise en forme conditionnelle de base.
- Données : tri et filtres sur plages, recherche/remplacement.
- Fichiers : import/export **.xlsx** et **.csv** sur un sous-ensemble assumé et documenté ; sauvegarde native JSON versionnée.
- Intégration suite : stockage via le module Drive (fichiers, versions, quotas), permissions héritées (lecture / commentaire / édition), design system commun.
- Collaboration : « selon moteur » — lecture seule + verrous optimistes au MVP ; temps réel en phase ultérieure (socle à mutualiser avec S1/S3).
- Hors périmètre v1 : tableaux croisés dynamiques, graphiques éditables, macros/VBA (jamais), ODS natif, sidecars exclus du chemin nominal.

### Contraintes non fonctionnelles

- Licence : aucune dépendance non compatible AGPL-3.0-only dans le chemin nominal.
- Charge : client fluide sur des postes modestes ; serveur 4 cœurs / 8 Go ; cible de test : **100 000 cellules** dont une fraction de formules.
- Sécurité auditable : parseurs épinglés et patchables, neutralisation de l'injection de formules à l'export, aucune exécution de macros.

## 2. Candidats (état vérifié en 2026)

### 2.1 Univer — moteur complet, Apache-2.0 (OSS) + Pro commercial

- Version : série **1.0** (majeure annoncée à l'automne 2026) ; dernières publications vérifiées : **1.0.4 au 10 octobre 2026** (release GitHub et `@univerjs/core` npm 1.0.4, **Apache-2.0**).
- Mainteneur : DreamNum Co., Ltd. (équipe d'origine de Luckysheet). 22,5 k★, ~1,9 k forks, activité quotidienne (dernier push le 10 octobre 2026).
- Atouts : TypeScript, React 18/19, rendu **Canvas**, architecture plugin, API Facade, runtime **headless Node.js ≥ 18.17**. L'OSS Sheets couvre feuilles, plages, sélection, formules, formats numériques, tri/filtres, validation, mise en forme conditionnelle, commentaires, notes, tableaux, hyperliens.
- **Point critique** : la répartition OSS/Pro est explicite dans le README — **collaboration temps réel, historique d'édition, import/export, impression, graphiques, TCD** sont **Pro** (commercial). La doc d'import/export le confirme : la conversion passe par `@univerjs-pro/exchange-node`. Le pont xlsx/csv devra donc être construit par Workspace autour du format de snapshot Univer.
- Blog 1.0 : améliorations annoncées sur « scrolling and calculation in large spreadsheets » (revendication éditeur, à mesurer — cf. §6).
- Gouvernance : open core d'entreprise (Open Collective, Discord) ; bus factor correct côté code, feuille de route tirée par le produit commercial.

### 2.2 FortuneSheet — moteur complet, MIT, maintenance ralentie

- Version : `@fortune-sheet/react` **1.0.4** (npm, 6 novembre 2025) ; dépôt `ruilisi/fortune-sheet` 3,7 k★, **MIT**, maintenu par Ruilisi/Xiemala (Suzhou, Chine).
- Activité : **ralentie** — dernier commit le 15 décembre 2025 (~10 mois), 96 issues ouvertes ; dépôt non archivé.
- Base : fork TypeScript de Luckysheet. Moteur de formules = fork de `handsontable/formula-parser` (`@fortune-sheet/formula-parser` 0.2.13, **MIT**) — sous-ensemble de fonctions plus restreint qu'Univer ou HyperFormula.
- Import/export xlsx : **non natif** — via un plugin communautaire tiers (`corbe30/fortuneexcel`), à auditer si retenu.
- Collaboration : pas de temps réel intégré ; le dépôt fournit seulement un exemple de backend de synchronisation d'état.
- Gouvernance : société unique, petite équipe, écosystème modeste → risque de bus factor.

### 2.3 Luckysheet — historique, fin de vie (MIT)

- Dernière publication npm : **2.1.13, 19 janvier 2021**. Dépôt redirigé vers `dream-num/Luckysheet`, désormais **archivé** (« Luckysheet upgraded to Univer »).
- Conservé comme référence historique et source d'inspiration de FortuneSheet ; **non retenu** pour un nouveau développement.

### 2.4 HyperFormula — moteur de formules headless (GPL-3.0-only)

- Version : **3.5.0** (release du 9 octobre 2026 ; 3.0.0 du 14 janvier 2025). Éditeur : Handsoncode sp. z o.o. (Gdynia, Pologne — groupe Handsontable). ~2,8 k★, actif.
- Licence : **double** — propriétaire **ou GPLv3**. Le champ npm déclare **`GPL-3.0-only`** ; le fichier LICENSE.txt décrit la double licence et la doc « Licensing » la confirme.
- **Exigence notable** : l'usage — y compris sous GPL — impose de passer `licenseKey: 'gpl-v3'` dans la configuration (doc « License key ») ; la clé propriétaire, elle, est validée **localement, sans connexion réseau**. La portée juridique exacte de cette exigence (au regard de la GPLv3 et de son §7 interdisant les restrictions supplémentaires) n'a pas été tranchée pendant cette étude — avis juridique requis si l'option C est adoptée.
- Capacités : 400+ fonctions (dont XLOOKUP depuis 3.0), graphe de dépendances, CRUD, undo/redo, presse-papiers, tri ; **headless pur** (pas d'UI), intégrations React/Vue/Angular documentées.
- Compatibilité AGPL-3.0-only : compatible dans les deux scénarios — analyse détaillée §4, option C.

### 2.5 Grilles généralistes — AG Grid, Handsontable

- **AG Grid Community** : **36.2.0** (`ag-grid-community`, `ag-grid-react`, **MIT**), éditeur AG GRID LTD, très actif (push le 10 octobre 2026). Excellente grille de données virtualisée (tri, filtres, édition), mais **ce n'est pas un tableur** : pas de moteur de formules, pas de formats de cellules type feuille, et l'export Excel est réservé à **Enterprise** (doc `enterprise: true`). Candidat pour un mode « données » de Sheets, pas pour le module lui-même.
- **Handsontable** : **18.1.2**, licence **propriétaire** : gratuit uniquement « personnel ou évaluation » (PDF non-commercial), usage commercial = contrat payant, avec une clause interdisant l'usage pour développer un produit concurrent. Un produit AGPL distribué et destiné à un usage professionnel n'entre dans aucune case gratuite. **Exclu** (à noter : HyperFormula est le moteur de formules extrait de Handsontable, d'où ce voisinage de modèles).

### 2.6 Import/export — briques d'échange

- **SheetJS Community Edition** : **Apache-2.0**, SheetJS LLC. État 2026 : dépôt GitHub **gelé** (miroir, dernier push avril 2024, « New home » = git.sheetjs.com) et paquet **npm `xlsx` bloqué à 0.18.5 (2022)**, **vulnérable** : CVE-2023-30533 (prototype pollution, corrigée en 0.19.3) et CVE-2024-22363 (ReDoS, corrigée en 0.20.2) — les advisories précisent qu'aucune version corrigée n'est disponible via npm. La voie officielle est le **tarball 0.20.3+ depuis cdn.sheetjs.com**, hors npm : à épingler, vendorer et auditer si retenu.
- **ExcelJS** : **4.4.0** (npm, octobre 2023 ; dernier commit janvier 2025) — MIT, mature (styles, images, tableaux, formules conservées en texte) mais maintenance au ralenti.
- **read-excel-file 9.3.12 / write-excel-file 4.1.1** : MIT, actifs, orientés valeurs/types avec styles limités — bons candidats pour un pont serveur minimal.
- **CSV** : Papa Parse 5.7.0 (MIT) ou csv-parse 7.0.3 (MIT). Le CSV est un non-problème technique ; en revanche l'**injection de formules** à l'export (`=`, `+`, `-`, `@` en tête de cellule) doit être neutralisée systématiquement.
- **ODS** : aucune bibliothèque JS mature et activement maintenue identifiée lors de cette étude (piste générique `simple-odf` 3.0.3, MIT, insuffisante pour un classeur) ; la conversion fidèle passera par **LibreOffice headless** en service optionnel, comme envisagé pour Docs/Slides.

### 2.7 Sidecars « feuille complète »

- **ONLYOFFICE Docs 9.4** : Community **AGPLv3** (compatible), image Docker 9.4.0.1 poussée en juillet 2026, éditeur Ascensio System SIA. Fidélité xlsx et collaboration natives ; limites Community (~20 utilisateurs recommandés, marque non retirable) ; intégration iframe + JWT, le serveur de documents doit accéder au stockage. Empreinte serveur significative (C++/Node, plusieurs conteneurs).
- **Collabora Online / CODE 26.04** : source **MPL-2.0** (binaires gratuits = édition de développement CODE ; offre production = abonnement), image 26.04.5.1.1 du 9 octobre 2026. Base LibreOffice (fidélité Calc réelle), intégration WOPI ; développement sur Gerrit, GitHub servant d'issue tracker (cf. analyse détaillée en S3 §2.5).
- **Ethercalc** : réécriture 2026 (TypeScript sur stack Cloudflare Workers/Durable Objects), version **0.20260717.0**, licence **CC0-1.0**, auto-hébergement Docker/workerd **sans compte Cloudflare**, collaboration temps réel native. Mais : application autonome (pas un composant embarquable), accès par URL de room (auth HMAC optionnelle), stockage interne au sidecar, **aucune intégration Drive/permissions** de la suite. Écarté en v1 ; utile comme référence d'architecture minimaliste.

## 3. Comparaison multicritère

| Candidat | Licence / compat AGPL | Self-host & poids | Sécurité / surface | Intégration React/TS | Formules & formats (xlsx/csv) | Collaboration | Perso UI | Perf. grosses feuilles | Effort (est.) | Risques |
|---|---|---|---|---|---|---|---|---|---|---|
| **Univer OSS** | Apache-2.0, compat. ; Pro commercial exclu du périmètre | Lib légère, client seul (+ headless possible) | Surface plugin navigateur ; pas de CVE critique repérée (recherche non exhaustive) | Très bon (TS, React 18/19, adaptateurs) | Formules OSS complètes ; **import/export = Pro** → pont maison requis | OSS : non (Pro) | Bonne (plugins, thèmes, i18n) | Canvas ; revendique l'optimisation des grands classeurs (à mesurer) | 6–10 sem. MVP (dont pont xlsx) + 1–2 sem. POC | Open core : fonctions « fichiers » et collab chez Pro ; API 1.x jeune |
| **FortuneSheet** | MIT, compatible | Lib légère, client seul | Surface classique ; dépend d'un fork formula-parser dormant | Bon (composant React direct) | Formules = sous-ensemble ; xlsx via **plugin tiers** non officiel | Non (exemple de backend seulement) | Moyenne (héritage Luckysheet) | Pas de garantie publique au-delà de quelques 10k cellules ; POC requis | 5–8 sem. | Maintenance ralentie (~10 mois), bus factor, écosystème modeste |
| **Luckysheet** | MIT, compatible | — | — | Faible (jQuery, pré-React) | — | — | — | — | — | **Archivé** ; remplacer par Univer/FortuneSheet |
| **HyperFormula (seul)** | GPL-3.0-only ; compat. AGPL via §13 ; `licenseKey: 'gpl-v3'` requis | Moteur lib pur, serveur ou client | Moteur isolé, pas d'évaluation native | Bon (headless, TS) | 400+ fonctions ; **pas d'import/export de fichiers** (format interne) | Non | N/A (pas d'UI) | Conçu pour de gros classeurs ; à valider en charge | N/A seul | Dépend d'une UI à construire ; gouvernance Handsontable ; clause « license key » à faire valider |
| **AG Grid Community (seul)** | MIT, compatible | Lib légère | Surface DOM classique (pas de canvas) | Excellent (React first-class) | **Aucune fonction tableur** ; export Excel = Enterprise ; CSV ok | Non | Bonne mais générique | Excellent sur de gros volumes de *données* affichées | N/A seul | Ce n'est pas un tableur ; des mois d'UI métier à construire |
| **Handsontable** | Propriétaire (perso/éval. seulement) | — | — | — | — | — | — | — | — | **Disqualifié** : incompatible distribution AGPL pro |
| **SheetJS CE** | Apache-2.0, compatible | Brique serveur/client | CVE sur npm (0.18.5) ; version saine = hors npm (CDN) | Brique sans UI | Référence xlsx/ods/csv en lecture/écriture | — | — | Dépend du contexte | 1–2 sem. (intégration) | Chaîne d'approvisionnement hors npm ; à épingler/auditer |
| **Sidecar ONLYOFFICE 9.4** | AGPLv3, compatible | **Lourd** (conteneurs, RAM) | Grand code C++, iframe/JWT à isoler | Iframe (UI étrangère) | Fidélité xlsx native, OOXML | Oui, native | Non (marque, UI tiers) | Charge serveur importante | 3–6 sem. (JWT, WOPI, stockage) | Limites Community (~20 util.), poids, cohérence UI |
| **Sidecar Collabora 26.04** | MPL-2.0 (source) ; prod = abonnement | Lourd (base LibreOffice) | Idem, sandboxing en progrès | Iframe (UI étrangère) | Très bonne fidélité Calc | Oui, native (WOPI) | Non | Charge serveur importante | 3–6 sem. + coût abonnement | Modèle économique, complexité d'exploitation |
| **Ethercalc** | CC0-1.0 | Léger (workerd/Docker) | Accès par URL, HMAC optionnel, proxy requis | Aucune (app autonome) | Import/export limités ; pas de xlsx riche documenté | Oui, native | Non | Correcte pour usage léger | 2–4 sem. (mais hors modèle) | Ne s'intègre pas (permissions/Drive/UI) |

Légende : colonne « Effort » = ordres de grandeur (1–2 développeurs familiers avec la stack), à affiner par POC. « Compat. » = compatible avec la distribution du projet sous AGPL-3.0-only.

## 4. Options d'architecture

### Option A — Moteur embarqué dans le client Workspace

**A1 — Univer OSS (recommandé).** Intégration par packages `@univerjs/*` en « plugin mode », chargement différé côté client (SSR/TanStack Start : composant client-only), thème aligné sur le design system. Le MVP exige de construire le **pont d'échange** : conversion xlsx/csv ↔ snapshot Univer, côté serveur (ExcelJS ou read/write-excel-file, SheetJS CE 0.20.3 en option), persistance du snapshot dans PostgreSQL via Drive, permissions Workspace. Collaboration temps réel : hors MVP (verrous optimistes), phase ultérieure — les primitives OT existent dans les dépendances OSS d'Univer, mais le service coopératif est Pro.
**Coûts** : 6–10 semaines MVP + 1–2 semaines de POC. **Bénéfices** : le meilleur rapport périmètre OSS/effort du marché, architecture extensible, headless pour les tâches serveur, UI personnalisable.
**Risques** : open core (import/export/collab chez Pro) → notre pont est un actif à maintenir ; API 1.x récente ; dépendance à la roadmap commerciale de DreamNum (à surveiller à chaque mineure).

**A2 — FortuneSheet (plan B).** Intégration React plus directe, MIT intégral, empreinte légère. Mais formules plus limitées, import/export par plugin tiers, maintenance ralentie, pas de headless. **Coûts** : 5–8 semaines. **Bénéfices** : simplicité, licence irréprochable, base de code compacte. **Risques** : périmètre fonctionnel plus court → plus de rustines ; bus factor.

### Option B — Sidecar (ONLYOFFICE Docs ou Collabora Online)

Le module Sheets devient une enveloppe autour d'une iframe ; le fichier vit dans Drive, le sidecar l'édite via JWT/WOPI. **Coûts** : 3–6 semaines d'intégration (SSO, JWT, stockage, tests) + exploitation continue. **Bénéfices** : fidélité OOXML et collaboration temps réel immédiates ; risque de développement minimal. **Inconvénients** : UX étrangère (rupture du critère « UI cohérente »), branding imposé (ONLYOFFICE) ou abonnement (Collabora), empreinte RAM/CPU contraire à la cible 4 cœurs / 8 Go, surface C++ à durcir. À réserver à un mode « compatibilité » optionnel (décision partagée avec S1/S3), pas comme fondation.

### Option C — Moteur de formules et grille séparés (HyperFormula + AG Grid)

Architecture « composants » : HyperFormula pour le calcul (headless), AG Grid Community pour l'affichage/saisie. Honnêtement : ce n'est viable que si l'on accepte de **construire un éditeur de tableur complet** (barre de formules, multi-feuilles, formats, fusions, recopie, formatage conditionnel…) — AG Grid n'étant pas un tableur et son export Excel étant Enterprise. **Coûts** : 15–25 semaines et au-delà ; le poste incompressible est l'UI métier, pas le calcul. Écartée pour le MVP.

Analyse licence HyperFormula (les deux scénarios demandés) :

1. **Dépendance liée** (même processus, bundle client ou serveur) : la GPLv3 et l'AGPLv3 sont conçues pour se combiner. L'AGPLv3 §13 dispose : « Notwithstanding any other provision of this License, you have permission to link or combine any covered work with a work licensed under version 3 of the GNU General Public License into a single combined work » (réciproque en GPLv3 §13). Workspace peut donc lier HyperFormula GPL-3.0-only **sans changer sa propre licence** ; en contrepartie, la partie HyperFormula reste couverte par la GPLv3 (source, notices, licence fournies — satisfait naturellement par un projet AGPL dont les sources sont publiées) et aucune restriction supplémentaire ne peut être ajoutée. Réserves : l'exigence de `licenseKey: 'gpl-v3'` est une pratique non standard à faire valider ; et cette dépendance interdirait toute re-licenciation permissive future de la partie liée.
2. **Service séparé** (moteur de calcul dans un conteneur/processus distinct appelé par API) : techniquement attractif (mutualiser le calcul, alléger le client), mais l'avantage est **opérationnel, pas juridique** : Workspace étant distribué (auto-hébergement), le service embarquant HyperFormula doit lui aussi respecter la GPLv3 ; la doctrine « programmes séparés / simple agrégation » (FAQ FSF) ne dispense de rien lorsque la combinaison est intime. Dans les deux scénarios, aucun blocage pour un projet AGPL-3.0-only.

**Conclusion de l'option C** : pas de blocage de licence, mais effort produit rédhibitoire ; HyperFormula reste une cartouche utile en **calcul headless** (recalcul serveur, exports de rapports, futurs classeurs « data ») — usage où sa compatibilité AGPL est déjà établie ci-dessus.

## 5. Recommandation

**Retenir l'option A1 : moteur embarqué Univer OSS + pont d'échange xlsx/csv construit par Workspace, avec FortuneSheet en plan B et sidecar ONLYOFFICE/Collabora en option « compatibilité » hors chemin nominal.**

Justification :

- **Périmètre** : Univer OSS couvre le MVP fonctionnel (formules, tri/filtres, formats, validation, conditionnel) sans licence problématique ; c'est le seul moteur complet dont l'OSS est à la fois riche et activement développé en 2026.
- **Licence** : Apache-2.0 au cœur, briques MIT pour l'échange → chemin nominal 100 % compatible AGPL-3.0-only, sans open core dans le calcul ni dans l'édition.
- **Cohérence de suite** : le pont xlsx/csv et le stockage Drive/versions sont des briques communes aux modules (mutualisables avec S1/S3) ; l'UI reste sous notre contrôle via les plugins de thème.
- **Sobriété** : aucun serveur supplémentaire par défaut ; le sidecar n'est activé que par demande explicite (fichiers complexes, équipes > 20).
- **Honnêteté** : l'import/export n'est pas natif côté OSS — c'est le coût principal de cette option, traité par un POC dédié et un périmètre de fidélité documenté.

### Plan d'intégration progressif

| Phase | Contenu | Durée (est.) | Critère de sortie |
|---|---|---|---|
| **0 — POC** | Intégration Univer React/TS (SSR-safe, lazy) ; test de charge **100 k cellules** ; prototype de conversion xlsx ↔ snapshot Univer (lecture + écriture) ; comparatif ExcelJS vs read/write-excel-file vs SheetJS 0.20.3 | 1–2 sem. | Feu vert perf + fidélité ; sinon bascule A2 ou révision de périmètre |
| **1 — MVP** | Module Sheets : Univer OSS, thème, sauvegarde snapshot via Drive, permissions, tri/filtres, formats courants, import/export CSV (Papa Parse) et xlsx v1 (valeurs, formules courantes, formats numériques simples, largeurs, fusions), verrous optimistes | 6–10 sem. | Créer un classeur, le partager en lecture/édition, aller-retour xlsx sans perte sur le sous-ensemble documenté |
| **2 — Interop avancée** | Fidélité xlsx étendue (styles, mises en forme conditionnelles, validation, tableaux, noms définis), export ODS via LibreOffice headless optionnel, historique de versions, préférences (locale, formats) | 4–8 sem. | Corpus de fichiers réels ≥ 80 % d'import sans retouche sur le sous-ensemble annoncé |
| **3 — Collaboration** | Socle temps réel mutualisé avec S1/S3 (présence, co-édition, reprise après crash) ; optimisation worker/wasm pour les très gros classeurs | 6–12 sem. | Deux éditeurs simultanés sans perte de données |

Point de séquencement : le socle temps réel et le pont OOXML doivent être **communs** aux modules Docs/Sheets/Slides — Sheets ne doit pas forger ses propres conventions (point hérité de S3 §6.10).

### Pourquoi pas les autres

- **FortuneSheet** : viable mais maintenance ralentie et formules plus limitées ; conservé en plan B si le POC Univer échoue (bundle, API, perf).
- **Luckysheet** : archivé depuis 2025, npm gelé depuis 2021 — disqualifié pour un produit neuf.
- **HyperFormula seul / AG Grid Community** : excellents composants, mais option C = repartir de zéro sur l'UI tableur ; effort incompatible avec le calendrier.
- **Handsontable** : licence propriétaire incompatible avec une distribution AGPL professionnelle (et clause de non-concurrence explicite).
- **SheetJS CE en dépendance principale** : import/export non maintenu sur npm et CVE connues sur la version npm — utilisable seulement en brique secondaire épinglée (0.20.3+) ou pas du tout.
- **Sidecars en cœur de module** : fidélité et collaboration immédiates mais UI étrangère, poids d'exploitation et limites Community — anti-thèse de l'objectif « suite unifiée et sobre » ; à garder en option explicite.
- **Ethercalc** : conceptuellement proche, mais application autonome sans intégration permissions/Drive/UI ; ne répond pas au besoin d'un module de la suite.

## 6. Questions ouvertes / POC à valider

1. **Charge 100 000 cellules** (dont ~10 % de formules) : temps d'ouverture, mémoire client, fluidité du scroll et de l'édition, temps de recalcul — cibles à fixer avant POC (proposition : ouverture < 2 s, mémoire < 500 Mo, recalcul < 1 s pour 10 k formules sur 4 cœurs). Aucun benchmark public indépendant identifié pour Univer ou FortuneSheet : à établir en interne.
2. **Pont xlsx ↔ Univer** : réaliste sur quelles métadonnées (styles, formats numériques, fusions, noms, formules) ? Écrire un corpus d'essai (fichiers métier réels) et mesurer le taux d'aller-retour sans perte ; trancher ExcelJS vs read/write-excel-file vs SheetJS 0.20.3 vendorié.
3. **TanStack Start / SSR** : stratégie de chargement client-only (suspense, bundle splitting), taille du bundle Univer, coexistence avec le routing et le shell.
4. **Stabilité d'API Univer 1.x** : rythme des breaking changes, politique annoncée (docs « API Stability ») ; fréquence de veille à prévoir.
5. **Licence HyperFormula** (si usage headless retenu) : faire valider la clause `licenseKey: 'gpl-v3'` (habilitation à exercer les droits GPL) — avis juridique ponctuel.
6. **Sécurité** : neutralisation de l'injection de formules à l'export CSV/xlsx ; audit des parseurs retenus (fuzzing léger, versions épinglées) ; CSP compatible Canvas.
7. **Collaboration** : besoin réel (présence ? édition simultanée ?) — la réponse conditionne le socle temps réel mutualisé et l'éventuel recours à un sidecar.
8. **ODS** : la demande existe-t-elle ? Si oui, arbitrer entre LibreOffice headless (fidélité, coût d'exploitation) et un simple export best-effort.
9. **Snapshots en PostgreSQL** : taille des JSON versionnés pour de gros classeurs, quotas Drive, stratégie de compaction (delta vs snapshot complet).
10. **Sort du sidecar** : proposer ONLYOFFICE/Collabora en extension facultative dès la v1 ou attendre une demande ? Impact documentation d'exploitation (RAM, WOPI, TLS).

## 7. Sources

Consultées le 10 octobre 2026.

**Univer**
- https://github.com/dream-num/univer (README, répartition OSS/Pro, métadonnées ; API GitHub : 22 527★, push 10/10/2026)
- https://github.com/dream-num/univer/releases (v1.0.4, 10/10/2026)
- https://docs.univer.ai/blog/univer-1-0 (annonce 1.0, améliorations grands classeurs)
- https://docs.univer.ai/server/import-export (conversion via `@univerjs-pro/exchange-node`)
- https://registry.npmjs.org/@univerjs/core/latest (1.0.4, Apache-2.0)

**FortuneSheet**
- https://github.com/ruilisi/fortune-sheet (README, métadonnées : 3 736★, push 15/12/2025)
- https://github.com/ruilisi/fortune-sheet/releases/tag/v1.0.4 (6/11/2025)
- https://registry.npmjs.org/@fortune-sheet%2Freact/latest (1.0.4, MIT)
- https://registry.npmjs.org/@fortune-sheet%2Fformula-parser/latest (0.2.13, MIT, fork de handsontable/formula-parser)
- https://github.com/corbe30/fortuneexcel (plugin tiers d'import/export xlsx cité par le README)

**Luckysheet**
- https://github.com/dream-num/Luckysheet (archivé, « upgraded to Univer »)
- https://registry.npmjs.org/luckysheet (2.1.13, publiée le 19/01/2021)

**HyperFormula**
- https://github.com/handsontable/hyperformula (métadonnées ; release 3.5.0 du 09/10/2026)
- https://hyperformula.handsontable.com/guide/licensing.html (« GPLv3 ou propriétaire »)
- https://hyperformula.handsontable.com/guide/license-key.html (`licenseKey: 'gpl-v3'`, validation locale)
- https://raw.githubusercontent.com/handsontable/hyperformula/master/LICENSE.txt (double licence) et /CHANGELOG.md (3.0.0 du 14/01/2025, XLOOKUP)
- https://registry.npmjs.org/hyperformula/latest (3.5.0, GPL-3.0-only)
- https://www.gnu.org/licenses/agpl-3.0.txt (AGPLv3 §13 : combinaison avec GPLv3) ; https://www.gnu.org/licenses/gpl-faq.html (doctrine des programmes séparés / simple agrégation)

**Grilles**
- https://github.com/ag-grid/ag-grid (LICENSE.txt : packages MIT + commerciaux ; métadonnées)
- https://registry.npmjs.org/ag-grid-community/latest et /ag-grid-react/latest (36.2.0, MIT)
- https://www.ag-grid.com/javascript-data-grid/excel-export/ (`enterprise: true`)
- https://github.com/handsontable/handsontable (LICENSE.txt : personnel/évaluation vs commercial, clause de non-concurrence ; 18.1.2)

**Import/export**
- https://github.com/SheetJS/sheetjs (miroir gelé, « New home » git.sheetjs.com)
- https://api.github.com/advisories/GHSA-4r6h-8v6p-xvw6 (CVE-2023-30533 ; npm non maintenu, 0.19.3 via cdn.sheetjs.com)
- https://services.nvd.nist.gov/rest/json/cves/2.0?cveId=CVE-2024-22363 (ReDoS, corrigée en 0.20.2)
- https://docs.sheetjs.com/docs/getting-started/installation/nodejs (tarball 0.20.3)
- https://registry.npmjs.org/xlsx/latest (0.18.5 — état npm)
- https://registry.npmjs.org/exceljs (4.4.0, MIT, publiée le 19/10/2023) ; https://github.com/exceljs/exceljs (dernier push 21/01/2025)
- https://registry.npmjs.org/read-excel-file/latest (9.3.12) et /write-excel-file/latest (4.1.1), MIT
- https://registry.npmjs.org/papaparse/latest (5.7.0) et /csv-parse/latest (7.0.3), MIT
- https://registry.npmjs.org/simple-odf/latest (3.0.3, MIT — piste ODF générique ; pas de moteur ODS mature identifié)

**Sidecars**
- https://github.com/ONLYOFFICE/DocumentServer/releases (v9.4.0) et https://hub.docker.com/r/onlyoffice/documentserver/tags (image 9.4.0.1, juillet 2026)
- https://www.onlyoffice.com/compare-editions (Community AGPLv3, « up to 20 recommended ») et https://www.onlyoffice.com/about.aspx (éditeur : Ascensio System SIA)
- https://github.com/CollaboraOnline/online (source MPL-2.0, issue tracker ; images https://hub.docker.com/r/collabora/code/tags — 26.04.5.1.1 du 09/10/2026)
- https://www.collaboraonline.com/ (CODE = édition de développement ; voir aussi S3 §2.5 pour les conditions production)
- https://github.com/audreyt/ethercalc (réécriture TS ; README : self-host Docker/workerd sans compte Cloudflare, accès par room, HMAC optionnel) et https://raw.githubusercontent.com/audreyt/ethercalc/main/package.json (0.20260717.0, CC0-1.0)

> **Limites de cette étude** : aucun benchmark indépendant des moteurs sur 100 k cellules n'existe publiquement à notre connaissance — les revendications de performance d'Univer sont éditeur et non auditées. La portée juridique exacte de l'exigence « license key » d'Handsontable (GPLv3) n'a pas pu être tranchée. Les tarifs et conditions commerciales d'Univer Pro ne sont pas publics. L'état des parseurs ODS JS a été sondé à la date de l'étude et peut évoluer. Enfin, les intégrations React/Vue annoncées n'ont pas été testées dans le contexte TanStack Start : le POC de phase 0 est indispensable avant l'ADR.
