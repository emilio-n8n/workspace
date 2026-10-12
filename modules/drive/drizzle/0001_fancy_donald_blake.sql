CREATE INDEX "drive_files_org_trashed_idx" ON "drive_files" USING btree ("org_id","trashed_at");--> statement-breakpoint
-- Recherche trigram (`name ILIKE '%…%'`) : drizzle-kit ne peut pas exprimer
-- `gin_trgm_ops`. Cet index est ajouté à la main et reste volontairement absent
-- du snapshot `meta/` — le prochain `db:generate` ne le régénérera donc pas.
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE INDEX "drive_files_name_trgm_idx" ON "drive_files" USING gin ("name" gin_trgm_ops);