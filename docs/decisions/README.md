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
| [0007](0007-moteur-docs.md) | Moteur de documents (Docs) : Tiptap 3 + Yjs/Hocuspocus | accepté sous réserve des POC |
| [0008](0008-moteur-sheets.md) | Moteur de tableur (Sheets) : Univer OSS + pont xlsx maison | accepté sous réserve des POC |
| [0009](0009-moteur-slides.md) | Moteur de présentations (Slides) : scène maison hybride | accepté sous réserve des POC |
| [0010](0010-socle-mail.md) | Socle messagerie (Mail) : Stalwart en sidecar, UI maison JMAP | accepté sous réserve du POC délivrabilité |
| [0011](0011-moteur-meet.md) | Visioconférence (Meet) : LiveKit + coturn, UI maison | accepté sous réserve des POC réseau et charge |
| [0012](0012-suite-multi-applications.md) | Suite multi-applications et SSO (rail, lanceur, palette ⌘K) | accepté |

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
