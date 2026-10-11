CREATE TABLE "sites_pages" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"site_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"position" integer NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sites_sites" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" text NOT NULL,
	"file_id" uuid NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sites_pages" ADD CONSTRAINT "sites_pages_site_id_sites_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites_sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sites_sites" ADD CONSTRAINT "sites_sites_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sites_sites" ADD CONSTRAINT "sites_sites_file_id_drive_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."drive_files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sites_sites" ADD CONSTRAINT "sites_sites_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sites_pages_site_slug_uidx" ON "sites_pages" USING btree ("site_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "sites_sites_file_uidx" ON "sites_sites" USING btree ("file_id");--> statement-breakpoint
CREATE INDEX "sites_sites_org_idx" ON "sites_sites" USING btree ("org_id");