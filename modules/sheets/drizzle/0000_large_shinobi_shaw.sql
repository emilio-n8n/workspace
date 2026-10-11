CREATE TABLE "sheet_cells" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tab_id" uuid NOT NULL,
	"row" integer NOT NULL,
	"col" integer NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sheet_tabs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"spreadsheet_id" uuid NOT NULL,
	"name" text NOT NULL,
	"position" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "spreadsheets" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" text NOT NULL,
	"file_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sheet_cells" ADD CONSTRAINT "sheet_cells_tab_id_sheet_tabs_id_fk" FOREIGN KEY ("tab_id") REFERENCES "public"."sheet_tabs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sheet_tabs" ADD CONSTRAINT "sheet_tabs_spreadsheet_id_spreadsheets_id_fk" FOREIGN KEY ("spreadsheet_id") REFERENCES "public"."spreadsheets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spreadsheets" ADD CONSTRAINT "spreadsheets_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spreadsheets" ADD CONSTRAINT "spreadsheets_file_id_drive_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."drive_files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sheet_cells_tab_row_col_uidx" ON "sheet_cells" USING btree ("tab_id","row","col");--> statement-breakpoint
CREATE INDEX "sheet_tabs_spreadsheet_idx" ON "sheet_tabs" USING btree ("spreadsheet_id");--> statement-breakpoint
CREATE UNIQUE INDEX "spreadsheets_file_uidx" ON "spreadsheets" USING btree ("file_id");--> statement-breakpoint
CREATE INDEX "spreadsheets_org_idx" ON "spreadsheets" USING btree ("org_id");