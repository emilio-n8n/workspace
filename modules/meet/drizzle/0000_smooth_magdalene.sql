CREATE TABLE "meet_rooms" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" text NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "meet_rooms" ADD CONSTRAINT "meet_rooms_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meet_rooms" ADD CONSTRAINT "meet_rooms_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "meet_rooms_slug_uidx" ON "meet_rooms" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "meet_rooms_org_idx" ON "meet_rooms" USING btree ("org_id");