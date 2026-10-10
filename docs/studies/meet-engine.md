# S5 — Moteur de visioconférence (module Meet)

> Étude technique du 10 octobre 2026 — statut : ▶ à discuter → ADR « moteur Meet ».
> Projet : Workspace, suite bureautique auto-hébergée (monolithe modulaire TanStack Start + React + TypeScript strict + PostgreSQL + Drizzle), licence **AGPL-3.0-only**.
> Machine de test de référence : 4 cœurs / 8 Go. Les serveurs de production visés pourront être plus gros, mais l'installation légère doit rester possible.
> Principe directeur : ne pas prétendre fournir une plateforme complète avant d'avoir traité TURN, sécurité et charge. Cette étude compare des moteurs WebRTC/SFU éprouvés et auto-hébergeables — aucune promesse marketing dans les critères.

## 1. Contexte & besoin

Le module Meet doit couvrir des **réunions internes d'équipe** (cas réaliste), pas des webinaires publics de 10 000 personnes :

- Réunions **2 à 20 participants**, audio/vidéo, partage d'écran, chat textuel intégré.
- Salles liées aux autres modules (calendrier, permissions, invitations) avec **rôles** : hôte/modérateur, participant, invité.
- **UI cohérente** avec la suite (design system maison, i18n, accessibilité) — un iframe d'un autre produit est exclu par défaut.
- Personne ne doit « tomber » en réunion : le cas NAT/CGNAT/firewall d'entreprise est la norme, pas l'exception.
- **Auto-hébergement intégral**, sécurité auditable, performance sur 4 cœurs / 8 Go en test.

Périmètre explicite **hors MVP** (à documenter comme tel, pas à masquer) : enregistrement, SIP/téléphonie, E2EE, webinaires large échelle, multi-régions, mobiles natifs. Chacun a un coût ops réel (voir §5).

## 2. Candidats

| Candidat | Version (oct. 2026) | Licence exacte | Mainteneur / gouvernance | Activité |
|---|---|---|---|---|
| **LiveKit** (SFU) | serveur v1.13.9 (7 oct. 2026) ; `@livekit/components-react` 2.9.24 (août 2026) ; egress / ingress / SIP séparés | **Apache-2.0** (serveur, SDK, egress, ingress, SIP) | LiveKit, Inc. (société, fondateurs historiques) ; cœur open source, cloud commercial à côté | Très forte : releases quasi hebdomadaires, écosystème agents/IA en forte croissance |
| **Jitsi** (suite) | tags quasi quotidiens, dernier `jitsi-meet_11326` (9 oct. 2026) ; paquets stables 2.0.* (correctif CVE-2025-64754 depuis 2.0.10532) ⚠ numéro stable exact non vérifié | **Apache-2.0** (jitsi-meet, JVB, Jicofo, Jibri, lib-jitsi-meet) ; Prosody : MIT | 8x8, Inc. (équipe Jitsi, Emil Ivov) ; JaaS commercial | Forte et continue, gouvernance d'entreprise (8x8), communauté large |
| **mediasoup** (briques SFU) | Node 3.29.0 (8 oct. 2026) ; Rust 0.30.0 ; mediasoup-client 3.24.5 | **ISC** | Versatica (Iñaki Baz Castillo, José Luis Millán) ; sponsoring, petite équipe | Régulière, releases mensuelles |
| **Galène** | 1.1 (2026 ; date exacte ⚠ à confirmer sur le changelog officiel) | **MIT** | Juliusz Chroboczek (IRIF, Université Paris Cité) + contributeurs ; financé NLNet NGI0Core | Modérée mais réelle ; bus factor proche de 1 |
| **Janus** (passerelle) | v1.4.2 « multistream » (23 sept. 2026) ; legacy 0.16.2 ; 1.4.0/0.16.0 (fév. 2026) | **GPL-3.0-only** + licence commerciale (double licence) | Meetecho (Lorenzo Miniero), Naples | Forte historiquement, orientée passerelle/plugins |
| **coturn** (TURN, obligatoire) | 4.18.0 (8 sept. 2026) | **BSD-3-Clause** | Projet coturn (mainteneurs bénévoles, ex-Citrix) | Active, correctifs de sécurité récents (4.17.0, août 2026) |

Notes de vérification : LiveKit (licence + releases GitHub), Jitsi (`jitsi/lib-jitsi-meet` Apache-2.0, `jitsi/jicofo` Apache-2.0, jitsi.org), mediasoup (mediasoup.org/license), Galène (galene.org, MIT, revue de sécurité tierce 2025), Janus (site officiel : GPLv3 + option commerciale), coturn (fichier LICENSE BSD-3). Sources en §7.

## 3. Comparaison multicritère

### 3.1 Synthèse

| Critère | LiveKit | Jitsi (suite) | mediasoup | Galène | Janus |
|---|---|---|---|---|---|
| Licence vs AGPL-3.0-only | ✅ Apache-2.0 | ✅ Apache-2.0 + MIT | ✅ ISC | ✅ MIT | ⚠️ GPL-3.0-only : combinaison permise (§13 GPLv3/AGPLv3, FSF) mais revue juridique requise |
| Auto-hébergement | ✅ binaire Go (+ Redis en prod) | ✅ mais pile complète (nginx, Prosody, Jicofo, JVB) | ✅ mais **tout le serveur reste à écrire** | ✅ binaire unique, TURN intégré | ✅ binaire C + plugins à choisir |
| Sécurité (audit/depuis 2025) | Politique de divulgation, durcissements TURN récents ; CVE 2026 côté service SIP (Snyk) ⚠ détail non creusé | Processus d'avis formel (repo security-advisories), CVE-2025-64754 corrigé | Pas de revue publique connue ; petite surface si bien exposé | **Test d'intrusion Radically Open Security (2025)** | Suivi CVE actif, projet mature |
| Intégration React/TS | ✅ SDK React officiel (hooks, composants) + livekit-client TS | ⚠️ `lib-jitsi-meet` (JS bas niveau, GUIs à réécrire) ou iframe | ⚠️ mediasoup-client bas niveau, signaling à écrire | ⚠️ client JS/TS maison (protocole documenté), pas de SDK React | ⚠️ janus.js + signaling JSON, GPL dans le bundle client |
| Partage d'écran | ✅ natif | ✅ natif | à construire | ✅ natif (multi-fenêtres) | à construire/plugin |
| Enregistrement | Egress (Apache-2.0) séparé ; composite = Chrome headless, lourd | Jibri : **1 système par enregistrement**, 8 Go+ RAM/session, non colocalisé | rien de natif | ✅ natif « recording to disk » (perspective limitée) | plugin recorder (.mjr + post-traitement) |
| Chat | data channels intégrés | natif (XMPP) | à construire | natif | plugin text room |
| Personnalisation UI | ✅ composants stylables CSS/i18n, UI 100 % maison possible | ⚠️ soit branding limité, soit réécriture lourde via lib-jitsi-meet | totale mais tout est à écrire | UI minimaliste propre, difficile à aligner sur un design system riche | totale mais tout est à écrire |
| Scalabilité (documentée) | multi-nœuds + Redis ; docs prod : 10 Gbps, pas de chiffre participants/cœur ⚠ | 4 cœurs dédiés = base ; OCTO pour fédérer ; test tiers 2022 : 4 vCPU/8 Go → ~45 caméras HD ≈85 % CPU, 235 participants / 2 caméras ≈92 % | 1 worker = 1 cœur ; ~500 consommateurs/worker (source secondaire ⚠) | **~300 participants/cœur** en diffusion ; **~20 caméras/cœur** en réunion (40 sur 4 cœurs) | dépend des plugins, chiffres non vérifiés |
| Effort d'intégration | Moyen (token + UI à habiller) | Moyen-élevé (stack + UI) ou faible mais iframe | Élevé (signaling, salles, permissions, enregistrement) | Moyen-élevé (UI) mais serveur simple | Élevé |
| Risques réseau | TURN requis ; plage UDP 50000-60000 ; ports 7880/7881 | TURN (coturn) requis ; plage ice4j | à définir à la main | TURN intégré | à définir à la main |

### 3.2 Licence — compatibilité AGPL-3.0-only

- La FSF indique que **GPLv3 et AGPLv3 peuvent toujours être combinées** (fichiers/modules séparés) et que **Apache-2.0 est compatible GPLv3**. En pratique : LiveKit (Apache-2.0), Jitsi (Apache-2.0/MIT), mediasoup (ISC), Galène (MIT) et coturn (BSD-3) sont utilisables sans friction dans un projet AGPL-3.0-only, avec obligations de conserver licences/NOTICE.
- **Janus (GPL-3.0-only, double licence)** : la combinaison avec AGPLv3 est permise par le §13 des deux licences, mais mélanger deux copyleft forts (dont dans le bundle client si l'on intègre `janus.js`) impose une revue juridique et une politique de redistribution plus lourde. Ce n'est pas bloquant, c'est un coût.
- Séparer les processus (le SFU n'est pas lié au code de la suite) reste la posture la plus simple : pas de contamination du code AGPL, seules les dépendances embarquées dans le bundle client comptent.

### 3.3 Réseau & capacité — les chiffres vérifiés (et leurs limites)

- **TURN obligatoire.** Les docs LiveKit l'affirment comme Jitsi : les pare-feu d'entreprise bloquent UDP et parfois le TCP non-TLS. Il faut donc TURN/UDP, TURN/TCP et idéalement **TURN/TLS sur 443**.
- **Ports LiveKit** (doc officielle) : 7880 (signalisation WS/HTTP), 7881 (ICE/TCP), **UDP 50000–60000** ; TURN intégré possible (auth intégrée, identifiants à TTL depuis les versions récentes). En Docker : réseau hôte recommandé ; Redis recommandé en production.
- **Ports coturn** : 3478/5349 (STUN/TURN), plage relais UDP configurable (ex. 49152–65535), 443/TLS pour les réseaux stricts ; authentification par secret partagé (TURN REST API) à câbler sur le service de tokens de la suite.
- **Bande passante par flux** (doc Jitsi) : 180p ≈ 200 kbit/s, 360p ≈ 500 kbit/s, 720p ≈ 2 500 kbit/s, 4K ≈ 10 Mbit/s. LiveKit : audio Opus 24–64 kbit/s ; simulcast ~125 kbit/s (bas) / 400 kbit/s (moyen) / 2,5 Mbit/s (720p), pour ~+17 % de bande montante chez le publieur.
- **Ordre de grandeur (à mesurer, pas garanti)** : 10 participants publiant en 720p ≈ 29 Mbit/s montants au SFU ; chaque participant reçoit une grille de ~9 flux dont la qualité est choisie par le SFU (simulcast/dynacast), soit typiquement 4–8 Mbit/s descendants → ~40–80 Mbit/s sur le serveur. Un lien 1 Gbps suffit pour ce profil ; c'est le CPU qui décide d'abord.
- **CPU** : le test tiers Jitsi 2022 (historique) montre que **le nombre de caméras actives** détermine la charge, pas le nombre de participants. Galène annonce ~20 caméras/cœur. mediasoup = 1 worker/cœur. LiveKit ne publie pas de chiffre participants/cœur ⚠ : **le POC de charge (§6) est obligatoire** avant toute promesse.
- **Redimensionnement simulcast/SVC** : LiveKit gère simulcast VP8/H.264 et SVC VP9/AV1 (simulcast VP9/AV1 ajouté fin 2026) + dynacast ; Galène gère simulcast et SVC VP8/VP9 ; Jitsi gère simulcast + contraintes récepteur. Indispensable sur réseaux modestes.

## 4. Options d'architecture

### Option A — SFU éprouvé + UI maison (recommandée)

LiveKit (binaire, Redis optionnel) + coturn dédié + UI entièrement maison (SDK React LiveKit comme base, re-stylé sur le design system ; token JWT émis par le serveur TanStack Start).

- **Coûts** : apprendre l'API LiveKit (salles, grants, pistes), habiller ~1 lot de composants React, opérer 2 services (SFU + TURN), câbler auth/permissions.
- **Bénéfices** : UI 100 % cohérente, code TS de bout en bout, enregistrement/SIP via services séparés quand on en a besoin, code serveur Apache-2.0 (pas de fork nécessaire), chemins d'échelle documentés (Redis, multi-nœuds).

### Option B — Suite complète embarquée (Jitsi)

Pile Jitsi complète, interface `jitsi-meet` intégrée en iframe (external API) ou UI réécrite sur `lib-jitsi-meet`.

- **Coûts** : 4–5 services à opérer (nginx, Prosody, Jicofo, JVB, + Jibri pour l'enregistrement), XMPP à comprendre, réécriture UI lourde si l'on refuse l'iframe, gouvernance produit chez 8x8.
- **Bénéfices** : fonctionnalités les plus complètes immédiatement (lobby, breakout rooms, enregistrement) — le choix le plus rapide vers un « produit fini », au prix de la cohérence UI (iframe) ou de l'effort (lib-jitsi-meet). À garder comme plan B crédible.

### Option C — Hybride (cœur LiveKit + briques annexes)

LiveKit pour la réunion temps réel + services découplés : coturn autonome, egress dédié (enregistrement), plus tard SIP (`livekit-sip`), et si le besoin « webinaire/amphi » apparaît, **Galène en side-car** pour la diffusion massive très économique (~300 participants/cœur sans caméras croisées).

- **Coûts** : plusieurs services, mais chacun à responsabilité unique et remplaçable ; abstraction nécessaire côté module Meet (adaptateur) pour ne pas lier la suite au SDK.
- **Bénéfices** : progressive enhancement réel — on n'active un service que quand le besoin est validé ; chemins de sortie (mediasoup/Pion/Janus) crédibles car la surface d'intégration reste mince (token + protocole SFU).

## 5. Recommandation, plan progressif, et pourquoi pas les autres

### Recommandation

**Option A, évoluant vers C** : moteur principal **LiveKit** (Apache-2.0), **UI maison** sur la base du SDK React (re-stylé, pas d'iframe), **coturn autonome obligatoire** dès le MVP (TURN/UDP + TCP + TLS 443), le TURN intégré LiveKit restant une option de secours à départager en POC. Le module Meet s'appuie sur une **couche d'abstraction** (adaptateur) : le jour où LiveKit déçoit, on change de moteur sans réécrire les autres modules.

Justification : meilleur rapport {licence permissive, SDK React mature, écosystème 2026 très actif, self-host léger (un binaire), chemins documentés enregistrement/SIP} ; répond aux quatre exigences du principe directeur (TURN traité, surface de sécurité réduite, charge mesurée par POC, périmètre progressif). Principal risque : gouvernance d'entreprise de LiveKit, mitigé par Apache-2.0 (pas de risque de licence) et par l'abstraction.

### Plan progressif

**Phase MVP — réunions simples (pas d'enregistrement) :**

1. Infra : LiveKit + **coturn** sur la machine de test 4 cœurs / 8 Go ; certificats TLS ; Redis seulement si multi-instance plus tard.
2. Auth : tokens JWT courts émis par TanStack Start (grants : join/publish/subscribe/data), salles créées à la demande par le module, rôles hôte/participant/invité.
3. UI : écran de réunion maison (grille, barre de contrôle, partage d'écran, chat via data channels), i18n/accessibilité de la suite.
4. Critères de sortie : réunion 8 participants caméras actives tenue sur la machine de test ; **100 % des participants connectés via TURN dans un réseau qui bloque l'UDP direct** ; qualité dégradée proprement quand simulcast rétrograde.

**Phase avancée :**

5. Enregistrement via **egress** sur hôte dédié (jamais sur le SFU), stockage objet auto-hébergé, quotas/rétention.
6. E2EE en option (insertable streams) après modèle de menace ; breakout rooms construites côté module (pas natif LiveKit).
7. Multi-nœuds (Redis) et régions quand les métriques du MVP le justifient ; SIP/téléphonie via `livekit-sip` seulement si un besoin réel est décrit.

### Pourquoi pas les autres

- **Jitsi** : le plus complet « clé en main », mais pile lourde à opérer, gouvernance 8x8, et surtout **conflit avec l'exigence d'UI cohérente** (iframe = UI étrangère ; lib-jitsi-meet = réécriture majeure). Plan B si le POC LiveKit échoue.
- **mediasoup** : briques excellentes (ISC), mais tout reste à construire (signaling, salles, permissions, enregistrement, chat) — effort injustifié face à LiveKit ; à revisiter si l'on veut posséder chaque couche.
- **Galène** : remarquable en efficacité (MIT, revue sécurité, TURN intégré), mais bus factor proche de 1, écosystème client limité, UI minimaliste et pas d'enregistrement composite : parfait comme side-car « amphi » un jour, pas comme cœur du module.
- **Janus** : très mature mais GPL-3.0-only (chaîne copyleft à gérer côté client), orienté passerelle/plugins, effort d'intégration le plus élevé ; son terrain (SIP médias) est couvert autrement si besoin.

## 6. Questions ouvertes / POC à valider

1. **POC NAT réel avec TURN** : tests depuis 4 réseaux (domicile, 4G/CGNAT, entreprise UDP bloqué, invité Wi-Fi) ; forcer TURN/UDP, TURN/TCP, TURN/TLS 443 ; vérifier avec Trickle ICE et logs TURN ; valider secret partagé coturn ↔ émission de tokens (TTL courts).
2. **POC de charge sur 4 cœurs / 8 Go** : N participants (8, 12, 20+) avec x caméras actives en 720p simulcast ; mesurer CPU, RAM, bande montante/descendante, perte, latence ; établir la limite « saine » du nœud unique et le comportement de dégradation (dynacast).
3. **Intégration TanStack Start** : composants WebRTC en client-only (SSR à garder hors du chemin), émission de tokens côté serveur, synchro des métadonnées de salle (participants, mute, attente), adaptation du SDK React au design system (variables CSS, i18n) — évaluer ce qu'on garde du SDK vs composants maison.
4. **Coût de l'enregistrement** : plus tard, mesurer egress composite (Chrome headless : lourd) vs pistes séparées ; définir la politique de rétention.
5. **Licences/notices** : confirmer l'analyse Apache-2.0/MIT/ISC/BSD-3 → AGPL-3.0-only (revue lead), politique NOTICE, interdiction d'introduire Janus tant que la question GPL n'est pas tranchée par écrit.
6. **Gouvernance/sortie** : surveiller LiveKit, Inc. (changement de licence de composants annexes ?) ; chiffrer une bascule POC vers mediasoup/Pion ; garder l'adaptateur mince.
7. **Divers** : E2EE dans le modèle de menace ? enregistrement consenti et notification des participants ? bande passante minimale pour clients modestes ? besoin mobile (web d'abord) ?

### Incertitudes assumées

- Pas de chiffre officiel LiveKit participants/cœur : toute cible chiffrée en §5 devra être validée par le POC 2.
- Chiffres mediasoup (~500 consommateurs/worker) et coturn (5–10k sessions audio sur 4c/8 Go) issus de sources secondaires, non reproduits ici.
- Numéro de paquet stable Jitsi exact en oct. 2026 non vérifié (tags quasi quotidiens).
- Détail des CVE récentes (LiveKit SIP, Jitsi) partiellement consulté ; un audit CVE complet est à refaire au moment de la décision.

## 7. Sources

Plateformes et releases :
- LiveKit — serveur et releases : https://github.com/livekit/livekit et https://github.com/livekit/livekit/releases (v1.13.9, 7 oct. 2026)
- LiveKit — licence Apache-2.0 : https://github.com/livekit/livekit/blob/master/LICENSE
- LiveKit — déploiement self-host (ports, TURN, Redis, 10 Gbps) : https://docs.livekit.io/home/self-hosting/deployment/
- LiveKit — egress : https://github.com/livekit/egress
- LiveKit — composants React : https://github.com/livekit/components-js et https://www.npmjs.com/package/@livekit/components-react (2.9.24, Apache-2.0)
- LiveKit — simulcast et bande passante : https://livekit.com/blog/an-introduction-to-webrtc-simulcast et https://livekit.com/blog/audio-quality
- LiveKit — politique de sécurité : https://livekit.com/security/policy
- Jitsi — projets (JVB, Jicofo, Jibri, Jigasi) : https://jitsi.org/projects
- Jitsi — handbook, exigences (RAM/CPU/bande passante/Jibri) : https://jitsi.github.io/handbook/docs/devops-guide/devops-guide-requirements/
- Jitsi — lib-jitsi-meet (Apache-2.0, GUI custom) : https://github.com/jitsi/lib-jitsi-meet
- Jitsi — releases : https://github.com/jitsi/jitsi-meet/releases (tag `jitsi-meet_11326`, 9 oct. 2026)
- Jitsi — avis de sécurité : https://github.com/jitsi/security-advisories et CVE-2025-64754 : https://nvd.nist.gov/vuln/detail/CVE-2025-64754
- mediasoup — site et licence ISC : https://mediasoup.org et https://mediasoup.org/license ; releases : https://github.com/versatica/mediasoup/releases (3.29.0, 8 oct. 2026)
- Galène — site, fonctionnalités, performance, revue de sécurité : https://galene.org ; licence : https://github.com/jech/galene/blob/master/LICENCE
- Janus — licence GPLv3 + option commerciale : https://janus.conf.meetecho.com/docs et https://janus.conf.meetecho.com/docs/FAQ.html ; releases : https://github.com/meetecho/janus-gateway/releases (v1.4.2, 23 sept. 2026)
- coturn — projet, releases (4.18.0, 8 sept. 2026) : https://github.com/coturn/coturn/releases ; licence BSD-3 : https://github.com/coturn/coturn/blob/master/LICENSE

Analyses et compatibilité :
- FSF — combinaison AGPLv3/GPLv3 : https://www.gnu.org/licenses/gpl-faq.en.html#AGPLGPL et https://www.gnu.org/licenses/quick-guide-gplv3.en.html
- FSF — liste des licences (Apache-2.0 ↔ GPLv3) : https://www.gnu.org/licenses/license-list.en.html
- Meetrix — test de charge Jitsi 4 vCPU (2022, historique) : https://meetrix.io/blogs/jitsi-meet-architecture-235-users/
- Forasoft — comparaison SFU (mediasoup/Janus/LiveKit/JVB) : https://www.forasoft.com/learn/video-streaming/articles-streaming/sfu-comparison-mediasoup-janus-livekit-jitsi-pion
- CelloIP — dimensionnement TURN/coturn (estimation tierce) : https://celloip.com/blog/webrtc-turn-server-production-guide
- Docs WebRTC — TURN : https://webrtc.org/getting-started/turn-server
