# S4 — Socle messagerie (module Mail)

> Étude technique — état des vérifications en ligne : **10 octobre 2026**.
> Principe directeur : une interface de messagerie ne suffit pas ; il faut un service
> e-mail réel (SMTP/IMAP/JMAP, délivrabilité, antispam). On privilégie l'intégration de
> composants éprouvés plutôt que la reconstruction.
> Méthode : versions et licences vérifiées sur les sites/dépôts officiels ; toute donnée
> incertaine ou non recoupée est signalée comme telle. Cette étude alimente l'ADR « socle Mail ».

## 1. Contexte & besoin

Contrairement aux modules Docs/Sheets/Slides, le module Mail n'est pas seulement une UI : c'est un
service réseau exposé 24/7 à Internet, avec des responsabilités d'exploitation (réputation IP,
délivrabilité, abus) qui ne peuvent pas être abstraites par l'application.

**Périmètre réaliste du module Mail (Phase 4)** :

- **Inclus** : comptes sur domaine(s) du déploiement ; lecture/écriture/réponse/transfert ; dossiers et
  étiquettes ; recherche ; pièces jointes ; brouillons ; spam (marquage, corbeille, apprentissage simple) ;
  filtres (Sieve) ; alias et adresses multiples ; quotas ; lien Calendar/Contacts via CalDAV/CardDAV ;
  UI cohérente avec la suite ; comptes externes en lecture (fallback).
- **Exclu Phase 4** : ActiveSync/EAS (Outlook mobile natif), conformité e-discovery/légal, migrations
  Exchange complexes, multi-tenant grand public (SaaS), signatures S/MIME avancées par utilisateur.

**Dépendances opérationnelles non négociables** (détaillées en §3.3-§3.4) : domaine et zone DNS maîtrisée
(SPF, DKIM, DMARC, PTR, MTA-STS), IP statique à réputation propre (le port 25 est bloqué chez de
nombreux hébergeurs), relais sortant si nécessaire, sauvegardes + restauration testées, cadence de
mise à jour de sécurité, procédure d'abus.

## 2. Candidats (versions, licences, gouvernance — octobre 2026)

| Candidat | Version (oct. 2026) | Licence | Mainteneur | Activité |
|---|---|---|---|---|
| Stalwart | 0.16.25 (05/10/2026) | AGPL-3.0-only (Community) + SEL v1 (entreprise) | Stalwart Labs (UK), grants NLnet NGI0 | Très actif (releases ~hebdo) |
| mailcow: dockerized | 2026-09a (06/10/2026) | GPL-3.0 | Équipe mailcow (créateur A. Peters) ; Servercow / The Infrastructure Company GmbH | Actif (releases mensuelles) |
| docker-mailserver | 16.0.1 (04/09/2026) | MIT | Bénévoles (depuis 2021, créateur Tomav) | Actif |
| Mailu | ligne 2024.06.x — 2024.06.61 (30/09/2026) | MIT (code projet) | Équipe Mailu collaborative | Correctifs réguliers, pas de majeure depuis 2024.06 |
| Stack manuelle Postfix+Dovecot+Rspamd+ClamAV | Postfix 3.10.x, Dovecot CE 2.4.5, Rspamd 4.2.1, ClamAV 1.5.x/1.4.x | IPL-1.0 (Postfix, option EPL-2.0 à confirmer), LGPL-2.1 (Dovecot), Apache-2.0 (Rspamd), GPL-2.0 (ClamAV) | Venema / Open-Xchange / V. Stakhov / Cisco Talos | Tous actifs |
| Roundcube (client) | 1.7.4 (06/09/2026), LTS 1.6.18 | GPL-3.0-or-later (exceptions skins/plugins) | Bénévoles | Actif |
| SOGo (client/groupware) | 5.12.11 (14/09/2026) | GPL-2.0 | Alinto | Actif, correctifs sécurité fréquents |
| SnappyMail (client) | v2.38.2 (GitHub, 10/2024) | AGPL-3.0 | the-djmaze (dev unique) | ⚠ Signaux de fragilité (voir ci-dessous) |
| Bulwark (client JMAP) | 1.13.0 (07/10/2026) | AGPL-3.0 (fork d'un socle MIT) | Projet Bulwark | Très actif (webmail pour Stalwart) |
| Cypht (client/agrégateur) | v2.12.2 (29/08/2026) | LGPL-2.1 | Communauté Cypht | Actif (IMAP/JMAP/EWS) |

**Précisions critiques** :

- **Stalwart** : la licence a évolué — le projet est désormais **dual-licencié AGPL-3.0-only (Community) +
  Stalwart Enterprise License v1** (site officiel, oct. 2026). L'AGPL ne s'applique qu'aux versions
  modifiées redistribuées ou exploitées comme service réseau ; exécuter Stalwart non modifié en sidecar
  n'impose rien. Un comparatif tiers (WZ-IT) évoque une « SEL v2 » : **non recoupé** par les sources
  officielles à ce jour. Réservé à l'édition Enterprise : multi-tenancy, tableaux de bord, SCIM,
  classifieur spam IA/LLM, réplicas/sharding ; le programme v1.0.0 (« schéma stable, upgrades automatiques »)
  était annoncé pour le S1 2026, **non publié au 10/10/2026** (docs mises à jour le 03/10/2026 ; les
  montées de version restent manuelles, la documentation recommande même de ne mettre à jour que si nécessaire).
  Point souvent méconnu : la WebUI est téléchargée depuis GitHub au premier démarrage (hébergement interne possible).
- **mailcow** : stack Docker complète (Postfix, Dovecot, Rspamd, ClamAV, SOGo 5.12.x, webmails, Unbound…).
  Gouvernance peu formelle ; l'éditeur Servercow (The Infrastructure Company GmbH) est la « maison »
  commerciale du projet (support managé, hébergement). CVE-2026-40874 (contournement d'auth API) corrigée en
  version 2026-03b ; la même version impose la 2FA admin.
- **docker-mailserver** : conteneur unique, Postfix/Dovecot/Rspamd/ClamAV/Amavis/SpamAssassin/OpenDKIM/
  OpenDMARC/Postgrey/Fail2ban/Postscreen. Pas d'UI d'administration ni de webmail/CalDAV/JMAP. Passage
  Debian 12 → 13 dans la v15/16 (changements cassants signalés).
- **Mailu** : suite Docker avec UI d'admin, Roundcube/SnappyMail, Rspamd. Ligne majeure **figée depuis
  2024.06** (correctifs uniquement, 61e patch le 30/09/2026). CVE-2026-85751 (contournement d'auth par
  spoofing d'identité proxy) corrigée en 2024.06.55 ; impact critique, correction rapide.
- **Roundcube** : mature, volumineux parc, bénévoles ; **pas de support JMAP pour le mail en 2026** (le
  projet roundcube-next a été arrêté ; discussions en cours pour contacts/calendrier via une bibliothèque
  PHP d'abord). Historique de CVE XSS régulier (8 correctifs dans la 1.6.14, mises à jour 1.6.18/1.7.3 en
  août 2026).
- **SnappyMail** : dernière release GitHub v2.38.2 (oct. 2024), dernier commit mars 2026, indisponibilité
  du site snappymail.eu signalée en mars 2026 (forum HestiaCP), développement assuré par une seule
  personne, pas de JMAP. **Écarté comme dépendance** malgré une base légère et rapide.
- **SOGo** : groupware complet (webmail, calendrier, contacts, **EAS/ActiveSync**), utilisé par mailcow ;
  GPL-2.0 ; éditeur Alinto ; plusieurs CVE en 2026 (XSS via ICS 5.12.7, reset de mot de passe avant 5.12.11).
- **Bulwark / Cypht / ihasmail / JMAP Webmail (root-fr)** : clients web JMAP utiles comme **références
  d'implémentation** et comme filet de secours ; Bulwark est spécifique Stalwart.

## 3. Comparaison multicritère

| Critère | Stalwart | mailcow | docker-mailserver | Mailu | Stack manuelle |
|---|---|---|---|---|---|
| Licence / compat AGPL | AGPL-3.0-only : OK pour sidecar non modifié ; patchs à publier | GPL-3.0 : OK en service séparé | MIT : OK | MIT : OK | Postfix IPL-1.0 **non compatible GPL** → processus séparé uniquement, jamais de code fusionné |
| Auto-hébergement intégral | Oui (binaire unique, Docker possible) | Oui (Docker Compose massif) | Oui (1 conteneur) | Oui (multi-conteneurs) | Oui, mais tout est à assembler |
| Sécurité | Rust (mémoire sûre), audit externe publié, cadence hebdo | Correctifs rapides ; CVE API 2026 ; 2FA imposée | Correctifs communautaires ; brique unique | Correctifs rapides ; CVE critique 2026 | Dépend du durcissement manuel ; surface maximale |
| Intégration technique | JMAP natif + API admin (JMAP/CLI) ; OIDC ; Postgres | IMAP/SMTP + API REST (admin) | IMAP/SMTP ; setup.sh / fichiers | IMAP/SMTP + API REST | IMAP/SMTP ; Ansible à écrire |
| Protocoles | JMAP mail (RFC 8620/8621), IMAP4rev2, SMTP, Sieve, CalDAV/CardDAV, JMAP Contacts (RFC 9610), JMAP Calendars **à l'état de brouillon** | IMAP/SMTP ; CalDAV/CardDAV/EAS via SOGo | IMAP/SMTP/Sieve ; pas de DAV/JMAP | IMAP/SMTP/Sieve ; DAV via Radicale | IMAP/SMTP/Sieve ; DAV à ajouter |
| Délivrabilité | DKIM auto (génération/rotation), SPF/DMARC (RFC 9989-9991), MTA-STS, TLS-RPT, ARC (entrant), DANE | Bonnes pratiques via Rspamd/OpenDKIM ; DNS à gérer | Bonnes pratiques via Rspamd/OpenDKIM ; DNS à gérer | Équivalent | Équivalent, à scripter |
| Effort d'exploitation | Faible en régime ; **upgrades manuels pré-1.0** | Élevé (dizaines de conteneurs) ; RAM mini 6 Gio + swap | Moyen ; pas d'UI | Moyen-élevé | Très élevé |
| Ressources (4c/8 Go) | ~100 Mo au repos ; 1 Go suffit pour 5-10 utilisateurs | 6 Gio mini ; ~8 Gio pour 100 IMAP ; EAS : 16-32 Gio/100 | ClamAV/Amavis dominent (~1-2 Gio) | ClamAV ≥2 Gio ; Tika +1-2 Gio si activé | Variable, ≥ mailcow souvent |
| Risques | Pré-1.0 : migrations manuelles, schéma non figé ; v1.0 en retard ; features ops en Enterprise | Gouvernance informelle ; complexité ; dette Docker | Pas de JMAP/UI/DAV ; support communautaire seul | Ligne figée depuis 2024.06 ; CVE critique récente | Bus factor 1 par composant ; erreur de config = délivrabilité cassée |
| Coûts cachés | Enterprise €2,00/boîte/an (palier 25-499) si multi-tenant/dashboards ; support premium dès 150 boîtes | Support payant tiers (Servercow) ; temps RAM/backup | Temps d'intégration (fichiers, certs, sauvegardes, webmail externe) | Temps d'intégration ; reprise en main à prévoir | Coût d'ingénierie le plus élevé |

**Coûts transverses à tous les candidats** (souvent sous-estimés) : réputation d'IP (temps de chauffe,
surveillance/remédiation des blocklists), relais sortant si le port 25 est fermé, et temps d'exploitation
récurrent (mises à jour de sécurité, sauvegardes, rapports DMARC/abus) — plusieurs heures par semaine pour
une petite instance, quel que soit le logiciel retenu.

### 3.1 Licence et compatibilité AGPL-3.0-only

- Tous les candidats sont des logiciels libres exécutables **en service séparé** : c'est le mode
  d'intégration retenu, qui évite toute question de licence combinée. Points d'attention :
  **Postfix** est sous IPL-1.0 (licence non compatible GPL ; alternative EPL-2.0 signalée depuis la 3.2.5 —
  à confirmer dans le `LICENSE` de la version utilisée) — le garder en processus séparé, ne jamais lier
  ni copier son code ; **Stalwart** est AGPL-3.0-only : si le projet Workspace redistribue un Stalwart
  modifié, les patchs doivent être publiés sous AGPL.
- Les features Enterprise de Stalwart ne sont **pas** dans le binaire Community : si Workspace veut à terme
  du multi-tenant (« plusieurs organisations sur une instance ») ou des dashboards natifs, il faudra soit
  budgéter les licences (palier 25-499 boîtes : 2,00 €/boîte/an), soit assumer un déploiement par locataire.

### 3.2 Sécurité

- Toutes les UI webmail de l'écosystème ont un flux régulier de XSS/CVE (Roundcube, SOGo, mailcow,
  Mailu) : ce n'est pas rédhibitoire mais impose une **cadence de mise à jour disciplinée**. Fait notable
  2026 : CVE-2026-85751 (Mailu, contournement d'auth proxy, sévérité critique) et CVE-2026-40874 (mailcow).
- Stalwart bénéficie du 100 % Rust (élimine les classes de vulnérabilités mémoire), d'un audit externe
  publié et d'un rythme de correctifs hebdomadaire — mais reste jeune.
- Dans tous les cas, l'UI maison hérite de la charge : **rendu HTML sûr** (sanitization + sandbox iframe,
  images bloquées par défaut) et traitement des pièces jointes sont des exigences produit, pas des options.

### 3.3 Délivrabilité — les exigences réelles

- **DNS** : SPF (RFC 7208), DKIM (RFC 6376), **DMARC désormais DMARCbis (RFC 9989/9990/9991, publiés en
  mai 2026)** avec report `rua` ; PTR (reverse DNS conforme au HELO) ; MTA-STS (RFC 8461) + TLS-RPT
  (RFC 8460) recommandés ; DNSSEC/DANE optionnels. ARC (RFC 8617) utile si transferts.
- **IP & port 25** : IP statique, réputation propre, warm-up ; de nombreux hébergeurs bloquent le port 25
  sortant (Hetzner : 25/465 bloqués par défaut avec déblocage sur demande ; DigitalOcean/Vultr aussi, sur
  demande) — **à vérifier avant de choisir l'hébergeur**. Si le port 25 reste fermé : relais sortant
  (Amazon SES, Mailgun, Postmark, Brevo…) avec SPF/DKIM du relais alignés — dépendance externe assumée et
  documentée. Certaines plages d'IP VPS sont pré-listées en blocklists : vérifier avant achat.
- **Exigences des grandes messageries** : Gmail/Yahoo exigent depuis février 2024 (expéditeurs de volume
  ≥ 5 000 messages/jour) SPF+DKIM+DMARC alignés, désabonnement one-click (RFC 8058) et taux de spam
  < 0,3 % (Postmaster Tools) ; Microsoft/Outlook.com a imposé des règles similaires depuis mai 2025.
  En dessous des seuils, l'authentification reste indispensable pour éviter le classeur spam.
- **Exploitation** : suivi des rapports DMARC/TLS, surveillance des blocklists, boîtes postmaster,
  procédure de remédiation d'IP, limites d'envoi par compte, gestion d'abus/compromissions, et **non
  négociable : sauvegarde + restauration de la boîte complète testées**.

### 3.4 Antispam

- **Stalwart Community** embarque : moteur de règles, classifieur statistique FTRL, DNSBL, Pyzor,
  protection phishing (homographes, spoofing), greylisting, spam traps. Le classifieur IA/LLM et les
  dashboards sont Enterprise. Suffisant pour démarrer ; à valider sur corpus réel.
- **Rspamd** (Apache-2.0, 4.2.1) reste la référence industrielle (classifieur bayésien entraîné,
  Redis pour l'historique, milter/proxy). Intégration possible via milter ou MTA hooks — **édition
  Community à confirmer au moment du POC**. À n'ajouter que si le filtre intégré s'avère insuffisant :
  chaque brique supplémentaire coûte de la RAM et de l'exploitation.
- **ClamAV** (GPL-2.0, Cisco Talos) : optionnel ; consomme ≥ 2 Go de RAM (recommandation reprise par la
  documentation Mailu) — poids à arbitrer sur une machine 8 Go.

## 4. Options d'architecture

### Option A — Sidecar serveur « Stalwart Community » + UI maison au-dessus de JMAP *(recommandée)*

- **Principe** : Stalwart (binaire/conteneur, base PostgreSQL partagée ou dédiée) expose JMAP ; l'UI
  Workspace (React/TS) parle **JMAP d'abord** (JSON typé, requêtes batchées, push WebSocket/SSE) et
  utilise CalDAV/CardDAV pour Calendar/Contacts tant que JMAP Calendars n'est pas finalisé.
- **Bénéfices** : cohérence UI totale (aucun webmail tiers embarqué) ; empreinte faible (~100 Mo au repos,
  1 Go pour 5-10 utilisateurs) → tient sur 4 cœurs/8 Go avec de la marge ; automatisations délivrabilité
  (DKIM, MTA-STS, DMARC) ; sécurité Rust + audit ; AGPL-3.0-compatible ; fallback IMAP.
- **Coûts** : développement UI (le vrai coût : liste, thread, composer, pièces jointes, recherche) ;
  discipline d'upgrade pré-1.0 ; features ops avancées en Enterprise ; JMAP Calendars au stade de
  brouillon → prévoir CalDAV comme interface stable pour Calendar.
- **Effort** : le plus élevé en dev, le plus faible en exploitation.

### Option B — Intégration client seule (boîtes e-mail existantes, pas de serveur)

- **Principe** : Workspace se branche sur les boîtes existantes (JMAP si disponible, sinon IMAP/SMTP ;
  pour les comptes IMAP tiers, un adaptateur ou le proxy `stalwartlabs/imap-to-jmap` en AGPL-3.0).
- **Bénéfices** : MVP rapide, aucune responsabilité de délivrabilité ni d'exploitation serveur ; utile
  aussi comme complément (multi-comptes).
- **Limites** : pas de service souverain (pas de domaine propre, pas de contrôle antispam/quotas), UX
  dégradée sur IMAP (sync, OAuth par fournisseur), pas de CalDAV unifié.
- **Usage recommandé** : étape 0 du plan ou fonctionnalité secondaire, jamais la cible.

### Option C — Suite complète existante (mailcow / Mailu / docker-mailserver) + UI maison en IMAP

- **Bénéfices** : configurations de référence éprouvées, admin opérationnelle déjà là (mailcow/Mailu),
  communauté/documentation étendues ; c'est l'option la plus « sûre » pour un admin pressé.
- **Coûts** : intégration **IMAP uniquement** (pas de JMAP : sync moins riche, parsing MIME côté client) ;
  deux UI d'administration à maintenir (incohérence) ; empreinte lourde (mailcow ≥ 6 Gio + swap, Mailu avec
  ClamAV/Tika) sur une cible 4c/8 Go ; surface d'attaque plus large (PHP webmail, multiples services).
- **Verdict** : bon choix « serveur documenté » pour des déploiements hors Workspace ; pas le socle de
  l'UI unifiée.

### Option D — Assemblage manuel Postfix + Dovecot + Rspamd + ClamAV

- Contrôle maximal, licences éprouvées (avec la réserve IPL de Postfix), mais : aucune brique JMAP,
  UIs/DAV à ajouter, tout le durcissement et les DNS à scripter, forte dépendance aux personnes.
  **Non recommandé** pour un projet qui doit converger vers une UI unifiée.

## 5. Recommandation, plan progressif et arbitrages

**Recommandation** : **Option A** — sidecar Stalwart Community (AGPL-3.0) + UI maison JMAP-first, avec
fallback IMAP pour les comptes externes, CalDAV/CardDAV comme pont Calendar/Contacts, et **relais sortant
assumé si le port 25 est indisponible** chez l'hébergeur retenu. Alternatives documentées dans l'ADR :
mailcow (suites complètes) et docker-mailserver (minimalisme) pour les déploiements administrés hors
Workspace ; l'UI Workspace ne promet que JMAP + IMAP (pas de garantie d'admin des suites tierces en Phase 4).

**Plan progressif** :

1. **POC socle (2-3 semaines)** : Stalwart épinglé (0.16.x) sur VM 4c/8 Go ; domaine de test ; DNS complet ;
   PostgreSQL ; mesures perf ; spike librairie JMAP TS (`jmap-jam` / `jmap-kit` / `jmap-client-ts`) ;
   **test réel de délivrabilité (§6.1)**. Critère de sortie : envoi authentifié aligné, en boîte sur
   Gmail/Outlook, aucune blocklist.
2. **MVP « lecture/écriture » (Phase 4)** : liste + vue message + pièces jointes (blobs) + recherche +
   dossiers + lu/non-lu + composer simple (réponse/transfert, brouillons) ; auth (OIDC ou mots de passe
   d'application) ; provisionnement minimal par CLI/API admin ; politique de sécurité HTML e-mail.
3. **Phase 4 complète** : threading, règles de tri (Sieve via RFC 9661), UX spam (junk/report), multi-comptes,
   quotas, alias, notifications push (WebSocket + WebPush), export/import.
4. **Durcissement** : MTA-STS + TLS-RPT + DMARC en `reject`, rapports `rua`, procédures d'upgrade
   (épinglage, fenêtre, sauvegarde), PRA/restauration, observabilité (métriques Community limitées →
   alerting par journaux/OpenTelemetry), **promotion en GA conditionnée à la sortie de Stalwart v1.0**
   (schéma stable, upgrades automatisés).

**Pourquoi pas les autres** : mailcow/Mailu = empreinte RAM et UI d'admin en double, intégration IMAP
seulement ; docker-mailserver = pas de JMAP/DAV/UI ; Roundcube/SnappyMail/SOGo = stack PHP et skins en
décalage avec l'UI Workspace (et signaux de maintenance défavorables pour SnappyMail) — ils restent
d'excellentes **références fonctionnelles** et des webmails « admin » à déployer séparément ; assemblage
Postfix/Dovecot = charge d'exploitation incompatible avec l'objectif produit.

## 6. Questions ouvertes / POC à valider

1. **POC délivrabilité (le plus important)** : domaine dédié + IP statique ; configurer SPF, DKIM (rotation),
   DMARC (none → reject), PTR, MTA-STS/TLS-RPT ; envoyer ~200 messages réels vers Gmail, Outlook.com, Yahoo,
   Proton (comptes seed) ; mesurer le placement boîte/spam, via Postmaster Tools et SNDS, plus `mail-tester` ;
   analyser les rapports DMARC pendant 2 semaines ; **si le port 25 est bloqué : rejouer le test via relais
   (SES/Mailgun/Postmark) et comparer**. Critères : alignement SPF+DKIM 100 %, taux de mise en boîte
   conforme, aucune blocklist, latence acceptable.
2. **Stalwart v1.0** : date réelle, périmètre des migrations, comportement de montée 0.16.x → 1.0
   (dry-run sur copie) ; stratégie d'épinglage des versions en attendant.
3. **Calendars** : JMAP Calendars (brouillon) vs CalDAV comme interface pour le module Calendar ;
   tester la conformité et le scheduling (invitations iMIP) côté Stalwart.
4. **SSO/Provisionnement** : OIDC Workspace ↔ Stalwart ; rôle des mots de passe d'application pour les
   clients natifs ; SCIM étant Enterprise, définir un provisionnement minimal (API admin JMAP/CLI).
5. **Antispam** : corpus comparatif Stalwart intégré vs Rspamd (milter/hooks) ; décider si un sidecar
   Rspamd est justifié et mesurer son coût RAM/Redis.
6. **Performance 4c/8 Go** : charge concurrente IMAP/JMAP, recherche plein texte (backend interne/Postgres
   vs Meilisearch), sauvegarde/restauration chronométrées, montée en version sans coupure.
7. **UI** : choix de la librairie JMAP TS ; politique de rendu HTML (sandbox, chargement des images,
   liens externes) ; accessibilité et i18n cohérentes avec la suite.
8. **Fallback IMAP** : adapter maison vs proxy `stalwartlabs/imap-to-jmap` ; authentification OAuth2
   (XOAUTH2) Gmail/Outlook pour les comptes externes.
9. **Abus & limites** : quotas d'envoi par compte, réaction à une compromission, journaux de livraison.
10. **Souveraineté du relais** : si relais sortant requis, dépendance externe à documenter dans l'ADR
    (coûts, RGPD, réversibilité).

## 7. Sources

**Stalwart**
- Site et éditions : https://stalw.art/open-source/ — https://stalw.art/compare/ — https://stalw.art/pricing
- Docs : https://stalw.art/docs/install/upgrade/ — https://stalw.art/docs/install/requirements/ — https://stalw.art/docs/server/enterprise/ — https://stalw.art/docs/management/webui/ — https://stalw.art/docs/development/rfcs/
- Releases : https://github.com/stalwartlabs/stalwart/releases — dépôt : https://github.com/stalwartlabs/stalwart
- Écosystème : https://github.com/stalwartlabs/imap-to-jmap — https://stalw.art/blog/security-audit — https://nlnet.nl/project/Stalwart/

**Suites serveur**
- mailcow : https://github.com/mailcow/mailcow-dockerized/releases — https://docs.mailcow.email/getstarted/prerequisite-system/ — https://www.sentinelone.com/vulnerability-database/cve-2026-40874/ — https://servercow.de/
- docker-mailserver : https://github.com/docker-mailserver/docker-mailserver — https://www.heise.de/en/news/Docker-Mailserver-15-All-round-package-for-mail-servers-in-containers-10303955.html
- Mailu : https://github.com/Mailu/Mailu — https://raw.githubusercontent.com/Mailu/Mailu/master/LICENSE.md — https://raw.githubusercontent.com/Mailu/Mailu/master/CHANGELOG.md — https://nvd.nist.gov/vuln/detail/CVE-2026-85751 — https://mailu.io/1.9/general.html
- Stack manuelle : https://www.postfix.org/ — https://en.wikipedia.org/wiki/Postfix_(software) — https://dovecot.org/ — https://github.com/dovecot/core/releases — https://github.com/rspamd/rspamd — https://github.com/Cisco-Talos/clamav

**Clients web**
- Roundcube : https://roundcube.net/ — https://roundcube.net/license/ — https://roundcube.net/news/2026/08/09/security-updates-1.6.18-and-1.7.3 — https://lists.roundcube.net/hyperkitty/list/dev@lists.roundcube.net/thread/OIDWSDQUTNXYFRGPDNOGJAIGGZCHGUGK/
- SOGo : https://github.com/Alinto/sogo — https://www.sogo.nu/year/2026.html — https://kb.cert.org/vuls/id/487613 — https://www.vulncheck.com/advisories/sogo-before-5-12-11-password-reset-token-interception-via-origin-header
- SnappyMail : https://github.com/the-djmaze/snappymail — https://forum.hestiacp.com/t/snappymail-eu-is-unreachable-since-march-2026/22061
- Bulwark : https://bulwarkmail.org/ — https://github.com/bulwarkmail/webmail — Cypht : https://github.com/cypht-org/cypht — https://www.cypht.org/features

**Protocoles & intégration**
- JMAP : https://jmap.io/spec/ — https://jmap.io/software/ — RFC 8620 (cœur) : https://www.rfc-editor.org/info/rfc8620 — RFC 8621 (mail) : https://www.rfc-editor.org/info/rfc8621 — RFC 9610 (contacts) : https://www.rfc-editor.org/info/rfc9610/ — RFC 9553 (JSContact) : https://www.rfc-editor.org/info/rfc9553
- DMARCbis : RFC 9989 : https://www.rfc-editor.org/info/rfc9989/ — RFC 9990 : https://www.rfc-editor.org/info/rfc9990/ — RFC 9991 : https://www.rfc-editor.org/info/rfc9991/

**Délivrabilité & exploitation**
- Gmail (expéditeurs) : https://support.google.com/mail/answer/81126 — Microsoft : https://learn.microsoft.com/en-us/answers/questions/4748398/outlook-s-new-requirements-for-high-volume-senders
- DMARCbis (contexte) : https://blog.mxtoolbox.com/2026/09/18/dmarcbis-rfc-9989-what-does-it-mean-for-your-email/
- Port 25 chez les hébergeurs : https://www.theodorehq.com/docket/blog/posts/port-25-and-465-blocked-on-your-vps — https://mailflowauthority.com/self-hosted-smtp/vps-blocked-port-25

*Fin de l'étude. Les éléments marqués « à confirmer/à vérifier » doivent être re-testés au moment du POC et de l'ADR.*
