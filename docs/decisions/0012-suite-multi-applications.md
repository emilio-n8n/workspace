# ADR-0012 — Suite multi-applications et SSO

**Statut** : accepté
**Date** : 2026-10-11

## Contexte

Le modèle de référence (Google Workspace) repose sur des **sites distincts** — drive, docs, mail… — reliés par un compte unique et un lanceur, pas sur une application unique qui afficherait toutes les sections. La première version de Workspace empilait toutes les routes dans une seule application web ; c'était contraire au modèle mental attendu et produisait une interface « fourre-tout ». Les contraintes du brief restent : un écosystème unifié (mêmes comptes, fichiers, permissions) et une exploitation auto-hébergée simple.

## Décision

- **Applications séparées dans le monorepo** : `apps/home` (portail, compte, jetons — port 3000), `apps/drive` (3001), `apps/docs` (3002), `apps/tasks` (3003). Chaque application possède son serveur SSR, son bundle et son domaine de responsabilité ; les applications suivantes (sheets, calendar, mail…) suivront le même patron.
- **Authentification unique (SSO)** : une seule base, une seule configuration better-auth, **le gestionnaire monté sur chaque application** (`/api/auth/*`). Cookie de session partagé :
  - développement : même hôte `localhost`, ports différents (les cookies ignorent les ports — aucune configuration) ;
  - production : sous-domaines (`drive.exemple.org`…) avec `BETTER_AUTH_COOKIE_DOMAIN` (cookies inter-sous-domaines) et `trustedOrigins` dérivées de `getAppUrls()`.
- **Navigation inter-applications** : registre unique `SUITE_APPS` dans `packages/ui` (icône, ton, phase, livrée ou non), **rail d'applications** de 76 px, **lanceur** (grille de 9 points) et **palette de commandes ⌘K** partagés. Les URLs publiques sont calculées côté serveur (`getAppUrls` : ports en développement, sous-domaines en production, surcharges explicites `*_URL`).
- **Les modules exposent leur surface complète** : services (`./`), server functions (`./server`) et interface (`./ui`) ; les applications ne font que monter ces briques et brancher les liens inter-apps (`createDocument` depuis Drive → atterrit dans Docs).
- **Authentification côté serveur** : la bascule d'organisation (`switchOrgFn`) et la déconnexion (`signOutFn`) sont des server functions — vérification d'appartenance côté serveur, écriture de la session dans notre table ; jamais de POST direct du navigateur à better-auth depuis une origine tierce.

## Conséquences

- Positif : cohérence avec le modèle attendu ; isolation des applications (bundles et poids par app) ; déploiement auto-hébergé = `docker compose` + reverse proxy à sous-domaines ; SSO sans friction en développement.
- Négatif : exploitation avec reverse proxy et DNS de sous-domaines documentée à la charge de l'exploitant ; navigation inter-applications = chargements complets (accepté : c'est le modèle Google) ; tests E2E multi-origines (résolu par la configuration `webServer` multiple de Playwright).
- Les redirections inter-applications utilisent `redirect({ href })` ; les cookies non configurés en production (sans `BETTER_AUTH_COOKIE_DOMAIN`) exigeraient une reconnexion par sous-domaine — documenté dans `.env.example`.

## Alternatives étudiées

| Option | Pourquoi écartée |
|---|---|
| Application unique à onglets internes | Rejetée par l'usage : interface fourre-tout, bundles lourds, modèle mental éloigné de la référence |
| Microservices à bases séparées | Casse l'unification des comptes, fichiers, permissions et de notre MCP — contraire au brief |
| Sous-domaines dès le développement | Complexité DNS locale (fichiers hosts, certificats) pour zéro bénéfice : les cookies partagés par `localhost` suffisent |
| API d'authentification centralisée inter-origines (CORS) | Surface d'attaque et complexité inutiles : chaque app monte le même gestionnaire sur la même base |
