CREATE TYPE "public"."task_label_color" AS ENUM('green', 'blue', 'amber', 'violet', 'red', 'slate');--> statement-breakpoint
ALTER TABLE "task_lists" ADD COLUMN "position" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE TABLE "task_labels" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" text NOT NULL,
	"created_by" text NOT NULL,
	"name" text NOT NULL,
	"color" "task_label_color" DEFAULT 'blue' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_label_links" (
	"task_id" uuid NOT NULL,
	"label_id" uuid NOT NULL,
	CONSTRAINT "task_label_links_task_id_label_id_pk" PRIMARY KEY("task_id","label_id")
);
--> statement-breakpoint
ALTER TABLE "task_labels" ADD CONSTRAINT "task_labels_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_labels" ADD CONSTRAINT "task_labels_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_label_links" ADD CONSTRAINT "task_label_links_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_label_links" ADD CONSTRAINT "task_label_links_label_id_task_labels_id_fk" FOREIGN KEY ("label_id") REFERENCES "public"."task_labels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "task_lists_org_position_idx" ON "task_lists" USING btree ("org_id","position");--> statement-breakpoint
CREATE INDEX "task_labels_org_idx" ON "task_labels" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "task_labels_org_name_unique" ON "task_labels" USING btree ("org_id","name");--> statement-breakpoint
CREATE INDEX "task_label_links_label_idx" ON "task_label_links" USING btree ("label_id");
