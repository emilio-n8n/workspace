# Module Meet

## Objectif
Salles de visioconférence persistantes avec lien, selon l'ADR-0011 : média
LiveKit si l'exploitant le fournit, sinon les salles restent une gestion de
liens propre et honnête.

## Périmètre (livré)
- Création de salles (slug unique), liste par organisation, copie du lien,
  suppression réservée au créateur.
- Page de salle `/room/<slug>` : salle d'attente, jeton LiveKit signé côté
  serveur (JWT HS256, 2 h) uniquement si `LIVEKIT_URL`, `LIVEKIT_API_KEY` et
  `LIVEKIT_API_SECRET` sont configurés ; sinon message de configuration clair.
- Client LiveKit léger (chargé dynamiquement) : grille des participants,
  micro/caméra, quitter.

## Autorisations
Salles visibles des membres de l'organisation ; le secret LiveKit ne quitte
jamais le serveur (seul un jeton limité à la salle est émis).

## Critères d'acceptation
Créer une salle, partager le lien, suppression par le créateur seulement ;
sans serveur média, la page explique la configuration ; le jeton est un JWT
conforme (tests de service + E2E).

## Hors périmètre
Enregistrement, transcription, effets, salons d'attente, invités externes.
