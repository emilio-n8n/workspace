# S1 — Moteur de documents (module Docs)

> Étude technique. Rédaction : octobre 2026. Méthode : recherches web sur l'état réel des projets (versions, licences, activité, vulnérabilités) ; toute donnée non vérifiée ou incertaine est signalée comme telle. Les numéros de version sont ceux relevés lors des recherches (sept.–oct. 2026) et bougeront : à revérifier au moment de l'ADR et de l'implémentation.
>
> Rappel des contraintes structurantes du projet Workspace : AGPL-3.0-only, auto-hébergement intégral sans dépendance obligatoire à un service propriétaire, sécurité auditable, UI cohérente entre modules, cible 4 cœurs / 8 Go, formats ouverts et interopérabilité OOXML.

## 1. Contexte & besoin

### 1.1 Périmètre MVP du module Docs

- Édition de texte enrichi **confortable** : titres (H1–H3+), listes (puces, numérotées, imbriquées), tableaux simples, images (upload + affichage), liens, gras/italique/barré/code inline, blocs de code, citations, séparateurs.
- **Autosave** (débounce côté client + sauvegarde serveur), reprise de session, détection de conflit minimale.
- **Versions** : historique nommé/automatique avec restauration (pas de diff sémantique sophistiqué en v1).
- **Import/export** : import DOCX « meilleur effort » ; export Markdown, HTML et DOCX ; le format interne canonique doit être stable et exportable sans perte de structure.
- **Collaboration temps réel** : exigée à terme ; l'architecture du MVP doit la rendre possible sans réécriture (curseurs, présence, édition simultanée en phase 2).
- **Recherche** dans le contenu (indexation) et **permissions** (lecture/écriture/partage) gérées côté serveur, jamais côté client seul.

### 1.2 Hors périmètre MVP (explicite)

- Rendu paginé type Word (sauts de page WYSIWYG), en-têtes/pieds de page, notes de bas de page rendues « à la Word ».
- Suivi de modifications (tracked changes), commentaires ancrés, co-édition avec Word en temps réel sur le même fichier.
- ODF en entrée/sortie, PDF export (phase 2/3), formules, macros, signature.
- Fidélité OOXML « pixel-perfect » : **jamais promise**, mesurée et documentée.

### 1.3 Exigence de fidélité honnête

Le produit doit communiquer des **limites mesurées** : un corpus de documents DOCX réels (créés par Word/LibreOffice/Google Docs) sert de référence ; pour chaque construction (styles, listes numérotées, tableaux, images, notes, etc.) on documente ce qui est conservé, dégradé ou perdu, à l'import comme à l'export. C'est un critère de recette, pas un slogan.

## 2. Candidats (état relevé en 2026)

### 2.1 Éditeurs embarqués (client)

- **Tiptap** — v3.30.x (v3.0 stable juillet 2025 ; ~38,6k étoiles GitHub). Licence : **MIT** pour le cœur et l'écosystème open source (LICENSE.md, Tiptap GmbH). Mainteneur : Tiptap GmbH (Berlin), équipe commerciale active, ~9,6M téléchargements npm/mois annoncés. Gouvernance : société privée ; en juin 2025, 10 extensions auparavant « Pro » sont passées en MIT, mais la plateforme payante (collaboration gérée, historique, commentaires, IA, **conversion DOCX payante via registre npm privé**) reste propriétaire ; le plan Cloud gratuit a été supprimé en juin 2025. Wrapper de ProseMirror ; React/TS de première classe.
- **Lexical** — série 0.x toujours (cœur `lexical` 0.51.0 ; binding `@lexical/yjs` 0.35.0 à nos relevés, versionnage par paquets). Licence : **MIT** (© Meta Platforms). Mainteneur : Meta + équipe cœur communautaire (Bob Ippolito, etc.) ; ~23,9k étoiles. Intégration React officielle (`@lexical/react`), Yjs officiel (`@lexical/yjs`, provider supporté : `y-websocket`). Mise en avant : fiabilité, accessibilité, performance.
- **ProseMirror (direct)** — cœur stable et modulaire : `prosemirror-view` 1.42.6, `prosemirror-model` 1.25.x, `prosemirror-transform` 1.12.x (2026). Licence : **MIT**. Mainteneur : Marijn Haverbeke (maintenance très active, bus factor faible assumé ; financement par sponsors). Pas de bindings React officiels, pas de « batteries incluses ».
- **Plate** — v53.2.1 (juin 2026 ; bêta 54), ~16,5k étoiles. Licence : **MIT** (cœur) ; **Plate Pro / Plate Plus** payant et propriétaire. Mainteneur : udecode (Ziad Beyens). Construit sur **Slate** + React + shadcn/ui. Rythme de versions majeures très élevé (v49 → v53 en un an), signe de changements cassants fréquents — à confirmer en POC.

### 2.2 Collaboration temps réel

- **Yjs** — v13.6.33 (sept. 2026, MIT, Kevin Jahns ; v14 en RC depuis 2025-2026). CRDT éprouvé, ~6–7M téléchargements npm/semaine, écosystème de bindings (ProseMirror via `y-prosemirror` MIT actif, Lexical natif, Slate, CodeMirror…). Financement par dons/sponsors, maintien solo avec contributeurs ; participe au GitHub Secure Open Source Fund (2026).
- **Hocuspocus** — **v4 stable (mai 2026)**, licence **MIT** (même éditeur que Tiptap, Tiptap GmbH). Serveur WebSocket Yjs multi-runtime (Node, Bun, Deno, Cloudflare Workers, uWebSockets), hooks d'authentification/persistance, extensions (base de données, Redis). C'était historiquement l'option commerciale de l'écosystème Tiptap ; la version stable est désormais MIT.
- **Liveblocks (à écarter)** — plateforme gérée propriétaire (les SDK clients sont Apache-2.0 ; le serveur de sync a été open-sourcé en février 2026 sous AGPL-3.0, mais l'éditeur indique explicitement **ne pas recommander ni supporter l'auto-hébergement en production**). Incompatible avec la contrainte « aucune dépendance obligatoire à un service propriétaire » — mentionné pour mémoire.
- Alternatives internes à Yjs : `y-websocket` (MIT, simple, persistance à construire), `prosemirror-collab` (centralisé, pas d'offline/CRDT — écarté pour un produit offline-friendly).

### 2.3 Import/export

- **mammoth** (`mammoth`) — v1.12.3 (sept. 2026), licence **BSD-2-Clause**, Michael Williamson (1 mainteneur principal). DOCX → HTML/Markdown **sémantique** : mappe les styles (`Heading 1` → `h1`) et **ignore volontairement la mise en forme visuelle**. Le README avertit : « performs no sanitisation of the source document, and should therefore be used extremely carefully with untrusted user input ». CVE-2026-97151 (pollution de prototype via styles DOCX malveillants, jusqu'à exfiltration de fichiers locaux pour 1.11.0–1.12.1) corrigée en 1.12.2. Limites documentées (issues ouvertes 2026) : largeurs de colonnes perdues, niveaux de numérotation ignorés, pas de citations.
- **`docx` (dolanmiu/docx)** — v9.8.1 (sept. 2026), licence **MIT**, Dolan Miu. Génération DOCX par API déclarative + `patchDocument` (gabarits à placeholders `{{tag}}`, styles préservés en option). Pas de CVE connue sur la dernière version (relevé Snyk). Bus factor ~1 ; pas un parseur DOCX généraliste.
- **Pandoc** — v3.12 (sept. 2026), licence **GPL-2.0-or-later**, John MacFarlane (très actif ; binaire WASM possible depuis 3.9, févr. 2026). Conversion universelle (DOCX ↔ Markdown ↔ HTML…), fidélité supérieure à mammoth mais pas parfaite ; destiné à tourner en **service séparé**.
- **Conversion Tiptap (DOCX/ODT/Markdown)** — extension payante (registre npm privé, plan Start $49/mois min.), en bêta, extensions historiques en fin de vie en 2026. **Hors jeu** pour un socle auto-hébergé.

### 2.4 Sidecars « haute fidélité »

- **Collabora Online** — série 26.04 (CODE 26.04.4.1, sept. 2026). Licence : **MPL-2.0** (source ; certaines parties sous BSD/LGPL) ; la **marque et le thème CSS sont propriétaires** selon Collabora, et la version supportée relève d'un abonnement. Édition gratuite = CODE (Development Edition). Sizing officiel (août 2026) : minimum **4 threads CPU** ; 1 Go de RAM serveur + 50 Mo/utilisateur simultané ; l'AppImage CODE demande 2 cœurs + 1 Go + 100 Mo/user. Intégration type WOPI. Vulnérabilités 2025-2026 notables : CVE-2025-66208 (RCE, 9.8, proxy Nextcloud CODE), CVE-2026-23623 (contournement lecture seule), CVE-2026-46499 (bypass read-only par WebSocket), CVE-2026-48164 (XSS réfléchi). Contexte : rupture TDF/Collabora en 2026 (TDF a réactivé LibreOffice Online).
- **ONLYOFFICE Docs Community** — 9.4 (mai 2026). Licence : **AGPL-3.0 + conditions additionnelles (Section 7)** ajoutées en 2026, contestées par le consortium Euro-Office/Nextcloud ; 9.4 supprime la limite de 20 connexions, RabbitMQ et la dépendance base de données. Besoins : 2 cœurs 2 GHz recommandés, **2 Go RAM min. (4 Go conseillé)**, 40 Go disque. Vulnérabilités : CVE-2021-3199 (path traversal → RCE historique, ajoutée au **catalogue KEV de la CISA le 8 oct. 2026**), CVE-2026-41034 (< 9.3.0, fuite d'infos via XLS), CVE-2026-38587 (DocSpace, IDOR), XSS réfléchi dans l'endpoint WOPI (SEC Consult). Gouvernance : Ascensio System ; fork **Euro-Office** (annoncé 27 mars 2026, première stable 9 juin 2026, consortium IONOS/Nextcloud/Proton/XWiki/OpenProject…) — instabilité juridico-gouvernementale.
- **LibreOffice headless** — 26.8 (2026, **MPL-2.0**, TDF). Conversion par CLI (`soffice --convert-to`), support Markdown en import/export depuis 26.8. LibreOffice Online a été réactivé par TDF en mars 2026 mais **n'est pas prêt pour la production** (travaux de modernisation à mener). Le headless est mature mais sérialisé (un profil par instance) et pas « pixel-perfect ».

## 3. Comparaison multicritère

### 3.1 Éditeurs embarqués

| Critère | Tiptap 3 | Lexical | ProseMirror direct | Plate 53 |
|---|---|---|---|---|
| Licence (cœur) | MIT | MIT | MIT | MIT |
| Compat AGPL-3.0-only | Oui | Oui | Oui | Oui |
| Self-host sans service tiers | Oui (plateforme payante non requise) | Oui | Oui | Oui (Pro payant non requis) |
| Sécurité / vulnérabilités | Dépend du socle PM ; XSS collage corrigé côté PM (voir 3.3) | Pas de CVE moteur notable trouvée (à confirmer) | CVE-2026-104847 (XSS collage) corrigé ≥ 1.42.3 ; CVE 2024 DOMSerializer corrigé ≥ model 1.22.1 | Hérite de Slate/React ; suivi à vérifier |
| Intégration React/TS | Excellente, TS natif | Excellente, React officiel | À construire (pas de React officiel) | Excellente (shadcn/ui) |
| Formats | HTML/JSON, Markdown MIT (`@tiptap/markdown`), DOCX payant | JSON/HTML/Markdown (selon plugins) | JSON/HTML via modules (serializers) | JSON/HTML/Markdown |
| Collaboration | Yjs via extensions MIT ; Hocuspocus MIT | `@lexical/yjs` officiel | `y-prosemirror` MIT | Yjs (intégration à valider) |
| Personnalisation UI | Totale (headless) | Totale (headless) | Totale, plus de code | Totale (headless + composants) |
| Performance client | Correcte ; à mesurer (socle PM plus volumineux que Lexical) | Se revendique minimaliste | Correcte, contrôle fin | Correcte ; bundle shadcn à surveiller |
| Effort d'intégration | Moyen (≈ semaines) | Moyen+ (0.x, plugins à assembler) | Élevé (tout à sa charge) | Moyen, mais migrations fréquentes |
| Risques | Dépendance commerciale à Tiptap GmbH (frontière MIT/payant mouvante) | API 0.x, écosystème doc moins mûr | Bus factor (1 mainteneur), coût initial | Churn majeur fréquent, Pro payant |

### 3.2 Conversion et sidecars

| Critère | mammoth | docx (npm) | Pandoc | LibreOffice headless | Collabora CODE | ONLYOFFICE CE |
|---|---|---|---|---|---|---|
| Licence | BSD-2 | MIT | GPL-2.0+ | MPL-2.0 | MPL-2.0 (+ marque/CSS propriétaires) | AGPL-3.0 + Section 7 contestée |
| Compat AGPL projet | Oui | Oui | Oui (processus séparé) | Oui | Oui (sidecar) | Juridiquement incertaine (conditions additionnelles) |
| Self-host total | Oui (lib) | Oui (lib) | Oui (CLI) | Oui | Oui (CODE) | Oui |
| Sécurité | CVE-2026-97151 corrigée ≥ 1.12.2 ; pas de sanitisation (« untrusted input » à risque) | 0 vuln. directe relevée (Snyk, sept. 2026) | Moteur Haskell, surface CLI ; sandboxer | Moteur C++, historique de CVEs LibreOffice ; jail conseillé | CVEs 2025-2026 (dont RCE 9.8 en proxy NC) | KEV (CVE-2021-3199), CVEs 2026, WOPI XSS |
| Fidélité OOXML | Sémantique seulement (styles visuels ignorés) | Bonne en écriture (génération), faible en relecture | Bonne, pas parfaite | Bonne (moteur LibreOffice) | Très bonne (édition native) | Très bonne (édition native) |
| Ressources serveur | Négligeable (lib Node) | Négligeable | Faible/moyenne | Moyenne (1 process/conv., sérialiser) | 2-4 threads + 1-2 Go RAM | 2 Go min. 4 Go conseillé + 40 Go disque |
| Intégration | Directe dans le monolithe | Directe | Sidecar simple | Sidecar (file d'attente) | WOPI/iframe (hôte WOPI à écrire) | API/JWT + WOPI (hôte à écrire) |
| UI cohérente suite | Oui (nous la construisons) | n/a | n/a | n/a | Non (UI propre en iframe) | Non (UI propre en iframe) |
| Risques | 1 mainteneur, limites structurelles | 1 mainteneur, périmètre écriture | GPL (sidecar requis) | Effort d'industrialisation | Marque/CSS propriétaires, gouvernance TDF/Collabora | Gouvernance + licence contestée, fork Euro-Office |

### 3.3 Faits de sécurité transverses (à intégrer au plan)

- Le collage de HTML non fiable est le vecteur XSS classique des éditeurs type ProseMirror/Tiptap : **épingler `prosemirror-view` ≥ 1.42.3** (CVE-2026-104847) et valider les attributs de nœuds (héritage DOMSerializer).
- Tout import DOCX est hostile par défaut : **sanitiser côté serveur** (DOMPurify ou équivalent), exécuter la conversion dans un worker isolé, borner taille/expansion ZIP (zip-bomb), interdire l'accès fichier (`externalFileAccess`), journaliser.
- La collaboration WebSocket exige authentification **et autorisation par document** (jeton court, vérification ACL côté Hocuspocus), plus contrôles d'origine et quotas.

## 4. Options d'architecture

### Option A — 100 % embarqué (éditeur JS + conversion bibliothèque)

- Contenu : Tiptap ou Lexical en React, format canonique JSON/HTML, Yjs + Hocuspocus pour le temps réel, mammoth/docx/Pandoc (sidecar optionnel) pour l'interop.
- Bénéfices : UI 100 % cohérente, poids serveur minimal (compatible 8 Go), licence simple (MIT/BSD), collaboration temps réel native, pas d'iframe tierce (surface d'attaque réduite), i18n/accessibilité maîtrisées.
- Coûts : la fidélité DOCX est **la** dépense cachée — import sémantique (pertes assumées) et export structural (pas de restitution du layout d'origine) ; suivi de modifications et pagination ne sont pas fournis.

### Option B — Sidecar d'édition (Collabora/ONLYOFFICE ou LibreOffice headless en éditeur)

- Contenu : le document reste DOCX/ODT ; l'édition se fait dans l'instance distante (iframe/WOPI).
- Bénéfices : fidélité OOXML quasi native, tracked changes, pagination, formats bureautiques complets ; l'équipe n'écrit pas de moteur.
- Coûts : 2–4 Go RAM et plusieurs cœurs au minimum (tension sur 8 Go), hôte WOPI à implémenter, UI étrangère dans l'iframe (rupture de cohérence), latence, montée en version lourde, et — selon le candidat — risques de licence/gouvernance (ONLYOFFICE) ou verrous marque/thème (Collabora). Pour LibreOffice headless : pas d'édition interactive, uniquement conversion.

### Option C — Combinaison (recommandée)

- Contenu : éditeur embarqué pour l'édition quotidienne + **services de conversion séparés** (LibreOffice headless pour DOCX→PDF/ODT, Pandoc pour MD↔DOCX/HTML) + **porte de sortie optionnelle** « haute fidélité » étudiée plus tard (POC Collabora CODE) si le besoin utilisateur est démontré.
- Bénéfices : MVP livrable avec une stack légère et 100 % open source ; la fidélité progresse par paliers mesurés ; possibilité d'ajouter le sidecar d'édition sans changer le format canonique.
- Coûts : deux formats internes à gérer (canonique JSON + DOCX de sortie), file de conversion à industrialiser, décision sidecar reportée (incertitude assumée, tranchée par POC).

## 5. Recommandation argumentée + plan d'intégration

### 5.1 Recommandation

**Adopter l'option C** avec la pile suivante, intégralement MIT/BSD et auto-hébergeable :

1. **Éditeur : Tiptap 3 (cœur MIT)** — vélocité et écosystème (UI components open source, extensions MIT, `@tiptap/markdown` MIT), TS/React natif, socle ProseMirror (sortie de secours : passer en ProseMirror direct sans changer de modèle de document). Ne pas dépendre des briques payantes (Plateforme, conversion DOCX).
2. **Collaboration : Yjs 13 + Hocuspocus 4 (MIT)**, servi comme processus séparé authentifié, persistance PostgreSQL, extension Redis seulement si besoin de mise à l'échelle. C'est l'option la plus mature et la moins risquée (pas de service propriétaire).
3. **Import : mammoth ≥ 1.12.3**, durci (worker isolé, limites de taille, sanitisation), en acceptant une fidélité **sémantique** et en le documentant.
4. **Export : Markdown/HTML natifs** (Tiptap MIT) + **DOCX via `docx` 9.x** (génération/patch) ; **Pandoc 3.12 en sidecar optionnel** pour les cas MD↔DOCX plus fidèles ; **LibreOffice headless** (MPL-2.0) pour PDF/ODT en phase ultérieure.
5. **Sidecar d'édition haute fidélité** (Collabora CODE en premier choix technique, MPL-2.0) : **reporté**, décidé par POC et ADR dédiés ; ONLYOFFICE écarté du socle (Section 7 contestée, KEV, gouvernance).

### 5.2 Plan progressif

- **Étape 0 — POC (1–2 semaines, avant ADR)** : Tiptap 3 + Yjs en local ; import/export sur un corpus de 20–30 DOCX réels ; mesurer la fidélité, le poids du bundle, le coût de conversion ; vérifier les licences des paquets réellement embarqués.
- **MVP Docs** : schéma de nœuds figé ; autosave serveur ; versions (snapshots) ; permissions ; export MD/HTML/DOCX ; import DOCX v1 durci ; images stockées ; recherche simple ; tests E2E.
- **Phase 2 — Collaboration** : Hocuspocus en service (JWT + ACL par document), présence/curseurs, offline (IndexedDB), compactage des updates Yjs + snapshots ; mesures de charge sur 4 cœurs/8 Go.
- **Phase 3 — Fidélité (conditionnelle)** : sidecar LibreOffice headless (PDF/ODT) ; POC Collabora CODE « ouvrir en haute fidélité » derrière un flag, avec critères explicites ; en cas d'échec, reste sur Pandoc + amélioration incrémentale du convertisseur DOCX maison.

### 5.3 Pourquoi pas les autres (résumé)

- **Lexical** : alternative sérieuse (Meta, Yjs officiel, léger, accessible) ; non retenu pour le MVP car API encore en 0.x, outillage UI moins riche, et moindre expérience documentaire côté imports OOXML — à réévaluer si Tiptap dérive commercialement.
- **ProseMirror direct** : trop de briques à écrire pour un MVP (toolbar, extensions, a11y) ; reste accessible sous Tiptap.
- **Plate** : churn de versions majeures élevé (v49→v53 en un an), Pro payant, écosystème plus jeune ; risque de migrations douloureuses.
- **Liveblocks / Tiptap Platform / Plate Pro** : propriétaires ou nécessitant des services gérés — contraires à la contrainte d'auto-hébergement.
- **ONLYOFFICE Docs** : licence AGPL+conditions contestées, instabilité (fork Euro-Office), CVE-2021-3199 au KEV, empreinte lourde (4 Go conseillés). Non retenu à ce stade.
- **Collabora Online** : techniquement solide mais lourd (4 threads min., RAM), UI non cohérente, marque/thème propriétaires, contexte TDF/Collabora agitée ; conservé en POC de fidélité uniquement.
- **LibreOffice Online** : réactivé par TDF en mars 2026 mais pas prêt pour la production — à suivre.
- **Collabora/ONLYOFFICE comme simple convertisseur** : plus lourds que Pandoc/LibreOffice headless pour le même service ; sans bénéfice à ce stade.

## 6. Questions ouvertes / POC à valider

1. **Corpus de fidélité** : constitution et grille de notation (conservation des titres/listes/tableaux/images/notes ; pertes documentées). Critère de sortie du POC étape 0.
2. **Format canonique** : ProseMirror JSON comme source de vérité + HTML dérivé ; valider la stabilité du schéma et la stratégie de migration.
3. **Hocuspocus en production modeste** : mémoire/CPU réels pour N documents ouverts sur 4 cœurs/8 Go ; comportement avec PostgreSQL ; nécessité (ou non) de Redis.
4. **Historique de versions** : snapshots périodiques vs replay d'updates Yjs ; coût de stockage et UX de restauration (la fonctionnalité historique payante de Tiptap ne doit pas être requise).
5. **Durcissement de l'import** : worker isolé, limites anti-zip-bomb, sanitisation, test de l'exploit CVE-2026-97151 sur notre pipeline épinglé.
6. **Mapping DOCX à l'export** : couverture `docx` 9.x pour titres/listes/tableaux/images ; arbitrage avec Pandoc (sidecar) selon les cas — mesurer les deux.
7. **Pandoc comme service** : file d'attente, limites de ressources, isolation (processus, timeouts) ; hypothèse GPL acceptée en sidecar.
8. **PDF** : `LibreOffice headless` (fidélité) vs impression CSS (légèreté) ; décision phase 3.
9. **Porte « haute fidélité »** : seuil d'exigence utilisateur qui justifierait un sidecar d'édition ; POC Collabora CODE (WOPI) chiffré en jours-homme.
10. **Licences vivantes** : revue automatique en CI des licences des paquets embarqués (la frontière MIT/payant de Tiptap a déjà bougé en 2025-2026) ; clause de sortie documentée.
11. **Accessibilité & i18n** : audit clavier/lecteur d'écran, support RTL, cohérence avec le design system de la suite.
12. **Incertitudes assumées** : absence de CVE « moteur » trouvée pour Lexical (recherches limitées) ; détails du thème CSS propriétaire Collabora (réponses forum, à confirmer commercialement) ; compatibilité MPL-2.0↔AGPL-3.0 au niveau fichier (notices Exhibit B) à vérifier si intégration plus intime qu'un sidecar.

## 7. Sources

Consultées le 10 octobre 2026. Les pages « release notes / changelog » évoluent ; re-vérifier avant l'ADR.

**Éditeurs et collaboration**
1. Tiptap — licence MIT : https://github.com/ueberdosis/tiptap/blob/main/LICENSE.md
2. Tiptap — v3.0 stable : https://tiptap.dev/blog/release-notes/tiptap-3-0-is-stable
3. Tiptap — open-sourcing (extensions Pro → MIT, annonce de juin 2025) : https://tiptap.dev/blog/release-notes et discussion HN https://news.ycombinator.com/item?id=44202103
4. Tiptap — tarifs/plateforme (conversion DOCX payante) : https://tiptap.dev/pricing , https://tiptap.dev/docs/conversion/getting-started/overview , https://tiptap.dev/open-source-to-platform
5. Tiptap — notes de version 2026 (dont `@tiptap/markdown` MIT) : https://tiptap.dev/blog/release-notes et https://www.npmjs.com/package/@tiptap/markdown
6. Hocuspocus 4 stable : https://tiptap.dev/blog/release-notes/hocuspocus-4-stable-release et https://github.com/ueberdosis/hocuspocus
7. Lexical — dépôt/licence : https://github.com/facebook/lexical ; `@lexical/yjs` : https://www.npmjs.com/package/@lexical/yjs ; équipe : https://lexical.dev/community
8. ProseMirror — changelog et versions : https://prosemirror.net/docs/changelog/ ; `prosemirror-view` npm : https://www.npmjs.com/package/prosemirror-view
9. Plate — npm : https://www.npmjs.com/package/platejs ; releases v49→53 : https://platejs.org/docs/releases ; Plate Pro (conditions) : https://pro.platejs.org/terms
10. Yjs — licence et état : https://docs.yjs.dev/license , https://yjs.dev , versions : https://github.com/yjs/yjs/releases
11. Liveblocks — open source serveur (AGPL, non supporté en autohébergement prod) : https://liveblocks.io/blog/open-sourcing-the-liveblocks-sync-engine-and-dev-server et https://www.npmjs.com/package/@liveblocks/server

**Import/export**
12. mammoth — dépôt et limites : https://github.com/mwilliamson/mammoth.js ; npm : https://www.npmjs.com/package/mammoth
13. CVE-2026-97151 (mammoth) : https://www.sentinelone.com/vulnerability-database/cve-2026-97151
14. `docx` (dolanmiu) — dépôt, patcher, releases : https://github.com/dolanmiu/docx , https://github.com/dolanmiu/docx/blob/master/docs/usage/patcher.md , https://github.com/dolanmiu/docx/releases ; vulnérabilités : https://security.snyk.io/package/npm/docx
15. Pandoc — version/licence : https://pandoc.org/releases.html , https://github.com/jgm/pandoc ; 20 ans du projet (WASM) : https://pandoc.org/twenty-years-of-pandoc.html

**Sidecars**
16. Collabora Online — licence/termes : https://www.collaboraonline.com/terms/collabora-online-mplv2 ; CODE 26.04 : https://www.collaboraonline.com/code-26-04-release-notes
17. Collabora — dimensionnement : https://sdk.collaboraonline.com/docs/technotes/hardware_provisioning.html ; prérequis CODE : https://github.com/CollaboraOnline/richdocumentscode
18. Collabora — sécurité : CVE-2026-23623 https://www.cve.org/CVERecord?id=CVE-2026-23623 ; CVE-2026-46499 https://github.com/CollaboraOnline/online/security/advisories/GHSA-27j2-3cqv-cc5q ; CVE-2026-48164 https://github.com/CollaboraOnline/online/security/advisories/GHSA-wgmm-q3ch-64jj ; CVE-2025-66208 https://nvd.nist.gov/vuln/detail/CVE-2025-66208
19. Collabora — marque/thème CSS propriétaires (réponse forum) : https://forum.collaboraonline.com/t/code-binary-license/179
20. ONLYOFFICE Docs 9.4 — limites supprimées : https://www.onlyoffice.com/blog/2026/05/onlyoffice-docs-9-4 et https://linuxiac.com/onlyoffice-docs-9-4-removes-community-connection-limit
21. ONLYOFFICE — prérequis système : https://helpcenter.onlyoffice.com/docs/installation/docs-community-sys-reqs-linux.aspx
22. ONLYOFFICE — polémique de licence et fork Euro-Office : https://www.onlyoffice.com/blog/2026/03/onlyoffice-flags-license-violations-in-euro-office-project-by-nextcloud-and-ionos ; https://nextcloud.com/blog/euro-office-license-compliance-and-what-open-source-means ; https://en.wikipedia.org/wiki/Euro-Office
23. ONLYOFFICE — vulnérabilités : KEV CISA https://www.cisa.gov/known-exploited-vulnerabilities-catalog ; CVE-2026-41034 (feedly) https://feedly.com/cve/vendors/onlyoffice ; XSS WOPI https://sec-consult.com/vulnerability-lab/advisory/reflected-cross-site-scripting-in-onlyoffice-docs-documentserver
24. LibreOffice — 26.8 et téléchargements : https://www.libreoffice.org/download ; LibreOffice Online réactivé (mars 2026) : https://www.theregister.com/software/2026/03/02/libreoffice-online-dragged-out-of-the-attic/4388766 et https://linuxiac.com/libreoffice-online-project-reopened-with-new-community-focus

**Sécurité des éditeurs**
25. ProseMirror — CVE-2026-104847 (XSS collage, corrigé 1.42.3) : https://github.com/ProseMirror/prosemirror-view/security/advisories/GHSA-c8x8-7fp4-3x9w et https://discuss.prosemirror.net/t/xss-vulnerability-found-in-prosemirror-view/9067
26. ProseMirror — DOMSerializer (corrigé ≥ model 1.22.1) : https://discuss.prosemirror.net/t/heads-up-xss-risk-in-domserializer/6572
