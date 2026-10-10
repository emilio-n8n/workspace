# ADR-0001 — Licence du projet : AGPL-3.0-only

**Statut** : accepté (défaut appliqué ; révision possible avant première publication)
**Date** : 2026-10-10

## Contexte

Workspace est une suite de productivité destinée à être **auto-hébergée**, y compris sous forme de service réseau par des tiers (écoles, administrations, entreprises, hébergeurs). Elle doit rester open source, protéger ses utilisateurs contre la « capture » propriétaire d'une version hébergée, et pouvoir intégrer des composants éprouvés aux licences variées (MPL, GPL, AGPL) sans friction juridique.

## Décision

Licence du projet : **AGPL-3.0-only** (GNU Affero General Public License, version 3, sans clause « or later »).

- L'application et ses packages internes sont couverts en un seul bloc.
- Les composants externes intégrés (sidecars communiquant par réseau ou processus séparé) sont distribués tels quels sous leurs propres licences (MPL-2.0 pour Collabora, AGPL-3.0 pour ONLYOFFICE/Stalwart, MIT/Apache pour les SDK, etc.), sans en faire des œuvres dérivées du cœur.
- Toute dépendance est vérifiée avant intégration ; les bibliothèques GPL/AGPL **liées** dans le code sont compatibles avec AGPL-3.0.

## Conséquences

- Positif : cohérence avec la mission (le service hébergé reste ouvert), compatibilité maximale avec les briques open source pragmatiques, dissuasion du « open washing ».
- Négatif : certains utilisateurs ou partenaires évitent l'AGPL ; une intégration propriétaire tierce nécessitera une discussion de licence ; le dépôt ne peut plus devenir permissif sans l'accord des ayants droit.
- La licence complète sera ajoutée (`LICENSE`) avant toute publication, avec l'en-tête de licence standard.

## Alternatives étudiées

| Option | Pourquoi écartée |
|---|---|
| Apache-2.0 / MIT | Ne protège pas les déploiements réseau : risque de fork propriétaire fermé d'une suite hébergée ; exclut ou complique l'usage de moteurs GPL/AGPL |
| MPL-2.0 | Copyleft par fichier insuffisant pour l'objectif ; combinaisons plus complexes |
| Licences non OSI (BUSL, Elastic) | Contraires à l'objectif « open source » du projet |

Révision possible avant la première publication si un besoin majeur (écosystème éducatif, partenaires) le justifie — la décision serait alors remplacée par un nouvel ADR, jamais modifiée.
