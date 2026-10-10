# Sécurité — vue d'ensemble

> La sécurité est une propriété du système, pas une case à cocher. Ce document décrit le modèle retenu, les contrôles en place et — honnêtement — ce qui reste ouvert.

## Principes

1. **Le serveur est la source de vérité** : toute décision d'autorisation est calculée côté serveur, à chaque appel. L'UI n'est jamais une frontière de sécurité.
2. **Refus par défaut** : sans permission explicite (rôle d'organisation ou grant de ressource), une opération est refusée.
3. **Moindre privilège** : sessions normales, jetons MCP scopés, scopes `read`/`write` séparés, aucune administration par défaut.
4. **Échec sûr** : erreurs typées, sans fuite d'informations internes ; les refus sont journalisés.
5. **Traçabilité** : les actions sensibles émettent un événement d'audit (acteur, organisation, ressource, résultat).

## Authentification et sessions

- Sessions httpOnly, `Secure` en production, `SameSite=Lax` par défaut (adapté au POST des server functions), rotation à la connexion, révocation individuelle/globale, expiration glissante bornée.
- Mots de passe : hachage géré par better-auth (jamais en clair, jamais journalisés) ; politique longueur minimale ; vérification email avant usage complet.
- Limitation de débit sur les points d'authentification (connexion, réinitialisation, invitations) — par IP et par compte.
- MFA (TOTP) : prévu via plugin, obligatoire configurable par organisation (Phase 5).

## Autorisation et isolation

- Modèle : ADR-0004 (`orgs`, `members`, `resource_grants`, liens de partage hachés, jetons d'API hachés et scopés).
- Toute requête de ressource exige `org_id` + contrôle `can(actor, action, resource)`.
- Les jetons (invitations, partages, API) sont **stockés hachés** (SHA-256 avec sel applicatif le cas échéant) et comparés en temps constant.
- **Tests obligatoires par module** : accès autorisé / refus sans grant / refus autre organisation / expiration / révocation.
- RLS PostgreSQL : prévu en défense secondaire sur les tables sensibles (Phase 2+), jamais en remplacement.

## Validation et entrées

- Toute entrée de server function / outil MCP passe par un schéma de validation partagé (zod) : types, tailles, énumérations. Aucune donnée brute n'atteint la base.
- Requêtes SQL uniquement paramétrées via Drizzle ; aucune concaténation.
- Uploads : taille maximale configurable, vérification du type réel (signature), nom de fichier assaini, clé de stockage opaque (jamais le nom utilisateur), analyse antivirus optionnelle (ClamAV) documentée pour le self-host.

## Secrets et configuration

- Aucun secret dans le dépôt. `.env` local ignoré (git), `.env.example` fourni sans valeurs réelles.
- Secrets fournis par variables d'environnement, validés au démarrage (`packages/config`) ; l'instance refuse de démarrer si la configuration est incomplète.
- Redaction systématique des secrets et jetons dans les logs.

## Menaces principales et contrôles (STRIDE, résumé)

| Menace | Contrôle principal |
|---|---|
| Usurpation (spoofing) | Sessions httpOnly + révocation, MFA progressif, rate limit |
| Altération (tampering) | Autorisation serveur systématique, validation d'entrée, audits |
| Répudiation | `audit_events` horodatés, acteur identifié (session ou jeton) |
| Fuite d'information | Isolation par organisation testée, erreurs génériques, pas de secrets en logs |
| Déni de service | Limites de débit, quotas de stockage, limites d'upload |
| Élévation de privilèges | Refus par défaut, scopes séparés, aucun chemin admin implicite |

## Limites connues (à ce stade)

- Pas de chiffrement au repos géré par l'application (repose sur disque/serveur de l'hébergeur — documenté pour l'exploitant).
- Pas de SSO fédéré avant la Phase 4/5 ; pas de MFA avant Phase 5.
- La limitation de débit mono-nœud est simple par conception ; multi-nœuds → stockage partagé à prévoir.
- Aucune prétention d'audit de sécurité externe : un audit est à programmer avant une adoption large.

## Signalement de vulnérabilités

Procédure publique (canal, délais, politique de divulgation) à définir et publier **avant la première version publique** ; en attendant, les problèmes doivent être signalés de façon privée au mainteneur.
