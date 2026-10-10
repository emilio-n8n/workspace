# ADR-0011 — Moteur de visioconférence (Meet)

**Statut** : accepté sous réserve des POC réseau et charge
**Date** : 2026-10-10
**Source** : [`docs/studies/meet-engine.md`](../studies/meet-engine.md)

## Contexte

La visioconférence impose des contraintes réseau (TURN, UDP, bande passante) et de charge que le brief demande d'assumer explicitement. Aucune promesse de « plateforme complète » ne doit être faite avant d'avoir traité TURN, sécurité et dimensionnement.

## Décision

- **SFU** : **LiveKit** (Apache-2.0) — serveur, SDK React (`@livekit/components-react`), egress/ingress et SIP dans le même écosystème.
- **UI maison** : composants LiveKit **restylés** avec nos tokens (pas d'UI tierce exposée).
- **TURN** : **coturn** (BSD-3) **obligatoire dès le MVP** pour les réseaux NATés — pas une option de confort.
- **Plan progressif** : MVP = réunions simples (pas d'enregistrement) sur 4 cœurs / 8 Go ; avancé = enregistrement (egress), webinaires, SIP.
- **Alternatives documentées** : Jitsi (suite complète, plus lourde à opérer), mediasoup (assemblage maison), Galène (sidecar webinaire possible), Janus (GPL-3.0 — compatibilité à revoir juridiquement si retenu).

## Conséquences

- Positif : la meilleure base tout-en-un auto-hébergeable pour notre UX ; écosystème actif ; licences compatibles.
- Négatif : exigences d'exploitation réelles (ports UDP 50000–60000, TURN, Redis en production) à documenter pour l'auto-hébergeur ; chiffres de capacité officiels non publiés → nous devrons mesurer nous-mêmes.
- Obligation : POC — appel réel derrière NAT avec chemin TURN forcé, et charge de 8 participants caméras sur 4 cœurs/8 Go, avant d'engager le développement du module (Phase 4).

## Alternatives étudiées

| Option | Pourquoi écartée (à ce stade) |
|---|---|
| Jitsi | Écosystème complet et éprouvé, mais suite lourde (Prosody/Jicofo/Jibri) et UI propre à restyler entièrement — second choix |
| mediasoup | Excellent SFU mais bibliothèque de briques : assemblage complet à notre charge |
| Galène | Simple et audité, mais vision conférence webinaire — possible sidecar complémentaire |
| Janus | GPL-3.0 : faisable via compatibilité GPLv3↔AGPLv3, mais complexité et posture juridique à confirmer |
