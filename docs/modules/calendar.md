# Module Calendar

## Objectif
Offrir un agenda partagé par organisation : agendas personnels et agendas
d'organisation, événements, invités avec réponse (accepter / refuser).

## Périmètre (livré)
- Agendas personnels (« Mon agenda », créé à la première utilisation) et
  agendas d'organisation visibles de tous les membres.
- Événements avec titre, lieu, description, journée entière, plage horaire.
- Invités par e-mail (membres reliés à leur compte), statuts
  invité / accepté / refusé ; visibilité des invitations reçues dans `listEvents`.
- Vues mois et semaine dans l'application Calendar (port 3004).
- MCP : `calendar.list` (plage de dates), `calendar.create`.

## Modèle de données
`calendars` (propriétaire ou organisation), `calendar_events` (org_id,
calendar_id, plage horaire), `calendar_attendees` (e-mail unique par
événement, lien utilisateur facultatif).

## Autorisations
Refus par défaut : un événement n'est visible que par les agendas visibles
(mien / organisation) ou par invitation nominative ; modification réservée au
créateur ou au propriétaire de l'agenda. Aucune opération ne franchit
l'organisation.

## Critères d'acceptation
Créer un événement, le retrouver par plage, inviter un membre qui le voit et
répond ; un membre ne peut pas modifier l'événement personnel d'un autre ;
isolation entre organisations (tests de service).

## Hors périmètre (assumé, documenté)
CalDAV, récurrences avancées (RRULE), fuseaux par événement, disponibilité.
