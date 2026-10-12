# Module Chat

## Objectif
Des conversations d'équipe internes : canaux d'organisation et discussions
directes, avec compteurs de non-lus.

## Périmètre (livré)
- Canaux (créés par un membre, tous membres de l'organisation peuvent être
  ajoutés) et discussions directes à deux (idempotentes).
- Messages de 1 à 4 000 caractères, ordre chronologique, regroupés par auteur,
  horodatage local.
- Non-lus calculés depuis `last_read_at` ; marquage à l'ouverture.
- Messages en **temps réel par SSE** (`/api/chat/stream`, curseurs `since`/`sinceId`,
  keep-alive) avec **repli automatique** sur l'interrogation courte (2,5 s) si la
  connexion échoue ; la liste des canaux se rafraîchit toutes les 5 s.
- MCP : `chat.list`, `chat.send`.

## Modèle de données
`chat_channels` (kind : channel/dm), `chat_members` (appartenance +
last_read_at), `chat_messages`.

## Autorisations
Appartenance obligatoire pour lire et écrire (refus par défaut) ; une
discussion directe exige que l'autre personne soit membre de l'organisation ;
aucun franchissement d'organisation.

## Critères d'acceptation
Créer un canal, envoyer et relire des messages, compteur de non-lus remis à
zéro à la lecture, refus pour un non-membre et à l'échelle d'une autre
organisation (tests de service + E2E).

## Hors périmètre (assumé)
Temps réel bidirectionnel WebSocket (SSE livré ; WebSocket réservé aux accusés de frappe et réactions futures), réactions, fils de discussion, pièces jointes,
mentions.
