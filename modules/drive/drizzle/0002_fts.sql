-- Recherche plein texte française (`websearch_to_tsquery('french', …)`) :
-- drizzle-kit ne peut pas exprimer un index d'expression sur `to_tsvector`.
-- Cet index est ajouté à la main (comme l'index trigram de 0001) et reste
-- volontairement absent du snapshot `meta/` — le prochain `db:generate` ne le
-- régénérera donc pas. La fonction `to_tsvector('french', name)` est IMMUTABLE
-- (config textuelle) : l'index d'expression est valide.
CREATE INDEX IF NOT EXISTS drive_files_name_fts_idx ON drive_files USING gin (to_tsvector('french', name));
