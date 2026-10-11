# Registre de défauts — vague L11 (2026-10-11)

Trois audits sévères ont été menés sur l'intégralité du code (design/UX/a11y,
backend/sécurité/perf, justesse/tests). Environ **260 constats** au total.
Traitement : correctifs partagés par le lead, puis **10 escouades
parallèles** (une par module), chacune tenue de passer `typecheck` + `test`.

## Correctifs transverses (lead) — livrés

| Défaut | Correctif |
|---|---|
| `revokeGrant(id)` sans portée : révocation cross-organisation | Signature `revokeGrant(resource, grantId)` filtrant id + orgId + ressource ; appels drive/tasks mis à jour |
| Purge Drive : blobs du sous-arbre détruits mais lignes orphelines | Escouade Drive : CTE récursive + suppression complète |
| `audit.recent` accessible avec un scope auto-attribué | Rôle owner/admin exigé (MCP) + scope `audit:read` réservé aux admins à l'émission |
| `listEvents` calendrier : fuite inter-organisations via invitation | Escouade Calendar : `orgId` filtré + plafond de plage |
| Réponses Forms orphelinées à chaque sauvegarde de questions | Escouade Forms : identifiants de question stables (upsert) |
| Injection de formules CSV (Forms, Sheets) | Escouades : préfixe `'` sur `= + - @` + `\r` |
| Course sur les versions Docs (`append`) | Incrément atomique `currentVersion + 1 RETURNING` |
| Contenu de document non borné (JSON arbitraire) | Limite 1 Mo + liste blanche des types de nœuds |
| XSS par caractères de contrôle dans `javascript:` (export HTML) | Audit : liste blanche http(s)/mailto + rejet des caractères de contrôle (escouade Docs/lead) |
| Tests pouvant viser la base de développement | `test/setup.ts` repo-wide : refus d'exécuter sans `TEST_DATABASE_URL` |
| Membres dupliqués possibles | Index unique `member(organization_id, user_id)` + migration 0002 |
| `trustedOrigins` localhost toléré en production | Garde au démarrage (`PUBLIC_URL` localhost interdit en prod) |
| Pas de rate limit / cookies implicites | `rateLimit` activé + cookies `httpOnly/sameSite/secure` explicites |
| `lastUsedAt` écrit à chaque requête MCP | Throttle SQL 5 minutes |
| Jetons : scopes non validés, liste non filtrée par organisation | Validation `isWorkspaceScope` + filtre `(userId, orgId)` |
| Voile des modales clair en thème sombre | Token `--overlay` (sombre dans les deux thèmes) |
| Ombres hors système (`shadow-xs/lg`) | Ramenées à `shadow-soft`/`shadow-lift` (composants partagés) |
| Dialogues sans nom accessible | `aria-labelledby` automatique + fermeture 32 px |
| Rail : 14 apps sans défilement (hauteur laptop) | `overflow-y-auto` + items `shrink-0` |
| Hauteurs magiques `calc(100vh − X)` (4 valeurs divergentes) | Coquille `h-dvh` + `#contenu` défilable ; pages en `h-full` |
| Pas de lien d'évitement, menus plein écran focusables | Skip-link « Aller au contenu » + arrière-plans `tabIndex={-1}` |
| Carrousel d'audit : `Badge` sans variante destructive | Variante ajoutée |
| Aucune preuve mathématique du contraste | `pnpm check:design` : OKLCH→sRGB + WCAG 2.1, **26/26 paires OK** (clair + sombre) |

## Escouades en cours (10)

Chaque escouade corrige son module (défauts de l'audit + tests) et ne rend
main que si `typecheck` + `test` passent :

1. **Sheets** — parseur de formules (DoS, agrégats, sémantique vide/#DIV0), sauvegarde par lot, export CSV, grille (perf, en-têtes opaques).
2. **Forms** — identifiants de question stables, garde `MAX_RESPONSES` atomique, draft par défaut, pagination/export complet, a11y.
3. **Calendar** — fuite inter-org, transaction, agenda unique, all-day UTC, confirmations.
4. **Mail** — boîtes (courses, suffixe), brouillon→envoi transactionnel, requêtes agrégées, webhook constant-time + idempotent, migration `external_id`.
5. **Slides** — upsert par identifiant, révision optimiste, bornes x+w, canvas lisible en clair, plein écran accessible.
6. **Chat** — liste en une requête, `dm_key` unique, transactions, `now()` SQL, pagination clamps.
7. **Classroom** — note conservée à la remise, codes 8 caractères non biaisés, agrégats, note invalide refusée, confirmations.
8. **Sites** — moteur Markdown réécrit (code opaque, astérisques arithmétiques, listes imbriquées), slugs sans course, éditeur (chargement, garde « non enregistré », confirmation).
9. **Drive** — purge de sous-arbre, quota de stockage appliqué, pré-vol upload, menu non rogné, tri honnête.
10. **Tasks + éditeur Docs** — états d'erreur, confirmations, sauvegarde sans perte (file d'attente + flush), aria.

## Prochains chantiers documentés (non bloquants)

- Batching des résolutions de rôles Drive (N+1 historique) via `accessibleResourceIds`.
- Optimistic locking Docs (append résolu, replace-latest restait last-write-wins).
- Rétention des versions (`version_retention_days` non appliqué), partage externe (`allow_external_sharing` non appliqué).
- Limitation de débit sur les endpoints publics (forms, webhook mail, liens de partage).
- Websockets Chat, IMAP Mail, images Slides.
