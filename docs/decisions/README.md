# Décisions d'architecture (ADR)

Une décision structurante = un fichier numéroté. Une décision remplacée n'est jamais réécrite : elle passe au statut « remplacée par ADR-XXXX » et reste archivée.

Format : titre, statut (`proposé` | `accepté` | `remplacé` | `rejeté`), contexte, décision, conséquences, alternatives étudiées.

| # | Sujet | Statut |
|---|---|---|
| [0001](0001-licence.md) | Licence du projet : AGPL-3.0-only | accepté (défaut appliqué ; révision possible avant première publication) |
| [0002](0002-stack-et-monorepo.md) | Stack et organisation du monorepo | accepté |
| [0003](0003-authentification.md) | Authentification, sessions et comptes | accepté |
| [0004](0004-multi-tenant-permissions.md) | Multi-tenant et modèle de permissions | accepté |
| [0005](0005-stockage.md) | Abstraction de stockage des fichiers | accepté |
| [0006](0006-mcp.md) | Serveur MCP officiel | accepté |
| 0007+ | Moteurs Docs / Sheets / Slides / Mail / Meet | **en attente des études S1–S5** (`docs/studies/`) |

## Modèle

```md
# ADR-XXXX — Titre

**Statut** : proposé | accepté | remplacé par ADR-YYYY
**Date** : AAAA-MM-JJ

## Contexte
Pourquoi cette décision se pose maintenant.

## Décision
L'option retenue, formulée sans ambiguïté.

## Conséquences
Positives, négatives, ce qui devient difficile ou interdit.

## Alternatives étudiées
Ce qui a été écarté et pourquoi.
```
