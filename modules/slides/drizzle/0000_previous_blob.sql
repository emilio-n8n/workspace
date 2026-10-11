CREATE TABLE "presentation_slides" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"presentation_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"title" text,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "presentations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" text NOT NULL,
	"file_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "slide_elements" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"slide_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"kind" text NOT NULL,
	"x" real NOT NULL,
	"y" real NOT NULL,
	"w" real NOT NULL,
	"h" real NOT NULL,
	"text" text DEFAULT '' NOT NULL,
	"font_size" integer DEFAULT 24 NOT NULL,
	"bold" boolean DEFAULT false NOT NULL,
	"align" text DEFAULT 'left' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "presentation_slides" ADD CONSTRAINT "presentation_slides_presentation_id_presentations_id_fk" FOREIGN KEY ("presentation_id") REFERENCES "public"."presentations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "presentations" ADD CONSTRAINT "presentations_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "presentations" ADD CONSTRAINT "presentations_file_id_drive_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."drive_files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slide_elements" ADD CONSTRAINT "slide_elements_slide_id_presentation_slides_id_fk" FOREIGN KEY ("slide_id") REFERENCES "public"."presentation_slides"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "presentation_slides_presentation_idx" ON "presentation_slides" USING btree ("presentation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "presentations_file_uidx" ON "presentations" USING btree ("file_id");--> statement-breakpoint
CREATE INDEX "presentations_org_idx" ON "presentations" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "slide_elements_slide_idx" ON "slide_elements" USING btree ("slide_id");