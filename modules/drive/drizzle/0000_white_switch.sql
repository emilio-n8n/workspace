CREATE TYPE "public"."drive_entry_kind" AS ENUM('folder', 'file');--> statement-breakpoint
CREATE TYPE "public"."drive_entry_status" AS ENUM('active', 'trashed');--> statement-breakpoint
CREATE TABLE "drive_file_versions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"file_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"storage_key" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"checksum" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "drive_files" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"parent_id" uuid,
	"kind" "drive_entry_kind" NOT NULL,
	"name" text NOT NULL,
	"mime_type" text,
	"size_bytes" bigint,
	"storage_key" text,
	"checksum" text,
	"status" "drive_entry_status" DEFAULT 'active' NOT NULL,
	"trashed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "drive_share_links" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"file_id" uuid NOT NULL,
	"role" "grant_role" NOT NULL,
	"token_hash" text NOT NULL,
	"created_by" text NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "drive_file_versions" ADD CONSTRAINT "drive_file_versions_file_id_drive_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."drive_files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drive_file_versions" ADD CONSTRAINT "drive_file_versions_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drive_files" ADD CONSTRAINT "drive_files_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drive_files" ADD CONSTRAINT "drive_files_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drive_share_links" ADD CONSTRAINT "drive_share_links_file_id_drive_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."drive_files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drive_share_links" ADD CONSTRAINT "drive_share_links_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "drive_versions_file_version_uidx" ON "drive_file_versions" USING btree ("file_id","version");--> statement-breakpoint
CREATE INDEX "drive_files_org_parent_idx" ON "drive_files" USING btree ("org_id","parent_id","status");--> statement-breakpoint
CREATE INDEX "drive_files_owner_idx" ON "drive_files" USING btree ("owner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "drive_files_name_uidx" ON "drive_files" USING btree ("org_id",coalesce(("parent_id")::text, 'root'),"name") WHERE "drive_files"."status" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "drive_share_links_hash_uidx" ON "drive_share_links" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "drive_share_links_file_idx" ON "drive_share_links" USING btree ("file_id");