CREATE TABLE "sheet_dimensions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tab_id" uuid NOT NULL,
	"axis" text NOT NULL,
	"index" integer NOT NULL,
	"size" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sheet_dimensions" ADD CONSTRAINT "sheet_dimensions_tab_id_sheet_tabs_id_fk" FOREIGN KEY ("tab_id") REFERENCES "public"."sheet_tabs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sheet_dimensions_tab_axis_index_uidx" ON "sheet_dimensions" USING btree ("tab_id","axis","index");