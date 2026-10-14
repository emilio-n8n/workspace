ALTER TABLE "sites_sites" ADD COLUMN "published_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sites_sites" ADD COLUMN "published_by" text;--> statement-breakpoint
ALTER TABLE "sites_sites" ADD COLUMN "navigation" jsonb;--> statement-breakpoint
ALTER TABLE "sites_sites" ADD CONSTRAINT "sites_sites_published_by_user_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;