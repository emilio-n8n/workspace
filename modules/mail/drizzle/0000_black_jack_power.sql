CREATE TABLE "mail_mailboxes" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" text NOT NULL,
	"user_id" text NOT NULL,
	"address" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mail_messages" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" text NOT NULL,
	"mailbox_id" uuid NOT NULL,
	"folder" text DEFAULT 'inbox' NOT NULL,
	"trashed_from" text,
	"from_address" text NOT NULL,
	"from_name" text,
	"to_addresses" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"cc_addresses" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"subject" text DEFAULT '' NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"read_at" timestamp with time zone,
	"starred" boolean DEFAULT false NOT NULL,
	"send_error" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mail_mailboxes" ADD CONSTRAINT "mail_mailboxes_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_mailboxes" ADD CONSTRAINT "mail_mailboxes_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_messages" ADD CONSTRAINT "mail_messages_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_messages" ADD CONSTRAINT "mail_messages_mailbox_id_mail_mailboxes_id_fk" FOREIGN KEY ("mailbox_id") REFERENCES "public"."mail_mailboxes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mail_mailboxes_address_uidx" ON "mail_mailboxes" USING btree ("address");--> statement-breakpoint
CREATE UNIQUE INDEX "mail_mailboxes_org_user_uidx" ON "mail_mailboxes" USING btree ("org_id","user_id");--> statement-breakpoint
CREATE INDEX "mail_messages_mailbox_folder_idx" ON "mail_messages" USING btree ("mailbox_id","folder");