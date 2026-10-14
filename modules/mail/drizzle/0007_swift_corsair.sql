CREATE TABLE "mail_labels" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" text NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"color" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mail_message_labels" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"message_id" uuid NOT NULL,
	"label_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mail_labels" ADD CONSTRAINT "mail_labels_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_labels" ADD CONSTRAINT "mail_labels_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_message_labels" ADD CONSTRAINT "mail_message_labels_message_id_mail_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."mail_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_message_labels" ADD CONSTRAINT "mail_message_labels_label_id_mail_labels_id_fk" FOREIGN KEY ("label_id") REFERENCES "public"."mail_labels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mail_labels_user_name_uidx" ON "mail_labels" USING btree ("user_id","name");--> statement-breakpoint
CREATE INDEX "mail_labels_org_user_idx" ON "mail_labels" USING btree ("org_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mail_message_labels_unique_idx" ON "mail_message_labels" USING btree ("message_id","label_id");--> statement-breakpoint
CREATE INDEX "mail_message_labels_label_idx" ON "mail_message_labels" USING btree ("label_id");
