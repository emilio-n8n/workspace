# ADR-0003 — Authentification, sessions et comptes

**Statut** : accepté
**Date** : 2026-10-10

## Contexte

Il faut des sessions révocables et sûres, des comptes vérifiés, des organisations avec invitations, plus tard MFA et fédération (OIDC/SAML) pour les entreprises et l'éducation. L'auto-hébergement impose que tout fonctionne avec notre PostgreSQL, sans service d'identité externe obligatoire. La logique d'authentification est un domaine où un code maison mal testé est un risque majeur.

## Décision

- **better-auth** (MIT) comme bibliothèque d'authentification, intégrée à TanStack Start, branchée sur notre PostgreSQL via l'adaptateur Drizzle :
  - email + mot de passe (vérification email, réinitialisation),
  - sessions httpOnly, rotation, révocation individuelle et globale,
  - plugin **organisations** (organisations, membres, rôles de base, invitations) — l'organisation « personnelle » sera une organisation de type `personal`,
  - plugins **API keys** (base des jetons MCP/intégrations) et **2FA** activés progressivement.
- Nos tables cœur (`users`, `sessions`, `orgs`, `members`, `invites`…) sont la référence en base ; le schéma better-auth est adopté dans nos migrations, jamais géré « à côté ».
- L'**autorisation** ne dépend pas de better-auth : elle vit dans `packages/permissions` (ADR-0004). Un compte connecté n'a aucun droit implicite.
- Toutes les server functions sensibles passent par un middleware d'authentification qui construit l'`Actor` (utilisateur, organisation active, scopes) et **refuse par défaut**.
- MFA : via le plugin 2FA (TOTP), obligation configurable par organisation (Phase 5).
- Fédération : OIDC en premier (Phase 4/5), délégué à better-auth ou à un pont type Keycloak **optionnel**, jamais obligatoire.

## Conséquences

- Positif : primitives éprouvées (hachage, rotation, CSRF, rate limiting) ; nous investissons notre effort dans l'autorisation et le produit, pas dans le « login ».
- Négatif : une dépendance structurante au schéma de better-auth (évolutions à suivre) ; certains comportements devront être vérifiés bout en bout (révocation, verrouillage).
- Les tests d'acceptation couvrent : inscription, connexion, révocation de session effective, échec de connexion limité (rate limit), invitation acceptée/refusée/expirée.

## Alternatives étudiées

| Option | Pourquoi écartée |
|---|---|
| Implémentation maison | Trop de surface critique (hachage, jetons, sessions) à réécrire sans bénéfice produit |
| Auth.js | Modèle sessions/organisations moins adapté ; écosystème davantage OAuth-first |
| Keycloak / Ory comme socle | Services lourds à opérer ; pertinent plus tard comme **pont** pour l'entreprise, pas comme socle |
| Supabase Auth / services managés | Contraire à l'objectif d'autonomie d'hébergement |
