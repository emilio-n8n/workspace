# Module Meet

## Objectif
Salles de visioconférence persistantes avec lien, selon l'ADR-0011 : média
LiveKit si l'exploitant le fournit, sinon les salles restent une gestion de
liens propre et honnête.

## Périmètre (livré)
- Création de salles (slug unique), liste par organisation, copie du lien,
  suppression réservée au créateur.
- Page de salle `/room/<slug>` : écran préparatoire (aperçu caméra, vu-mètre du
  micro, choix des périphériques), jeton LiveKit signé côté serveur (JWT HS256,
  2 h) uniquement si `LIVEKIT_URL`, `LIVEKIT_API_KEY` et `LIVEKIT_API_SECRET`
  sont configurés ; sinon message de configuration clair.
- Client LiveKit léger (chargé dynamiquement) : galerie des participants,
  micro/caméra, quitter, file d'admission pour l'organisateur.
- États micro/caméra visibles sur chaque vignette et conservés dans le stockage
  local (`meet.media-preferences.v1`) : la personne retrouve ses réglages d'une
  réunion à l'autre.
- Salle d'attente avec admission : par défaut, toute personne autre que le
  créateur demande à entrer et attend l'accord de l'organisateur, qui peut
  aussi ouvrir la salle en entrée libre. Actions journalisées
  (`meet.lobby.request`, `meet.lobby.admit`, `meet.lobby.deny`).
- Erreurs de périphériques traduites en français actionnable (refus,
  périphérique absent ou déjà utilisé, contexte non sécurisé, navigateur
  incompatible) avec relance possible.

## Autorisations
Salles visibles des membres de l'organisation ; le secret LiveKit ne quitte
jamais le serveur (seul un jeton limité à la salle est émis). L'admission est
réservée au créateur de la salle, et seul un membre de l'organisation peut être
admis.

## Critères d'acceptation
Créer une salle, partager le lien, suppression par le créateur seulement ;
sans serveur média, la page explique la configuration ; le jeton est un JWT
conforme ; l'écran préparatoire affiche un aperçu et les erreurs de
périphériques sont actionnables ; la salle d'attente bloque puis admet.

## Hors périmètre
Enregistrement, transcription, effets, invités externes.

## Vague « participants et chat » (14 oct. 2026)
- **Panneau des participants** : liste en direct, rôle (hôte/invité), état micro/caméra, mute dispositif, admission depuis la salle d'attente (`participants.ts` + `participants-panel.tsx`) — logique pure testée.
- **Chat de réunion** : messages horodatés, longueur bornée, envoi optimiste, nettoyage à la fermeture (`chat.ts` + `chat-panel.tsx`).
