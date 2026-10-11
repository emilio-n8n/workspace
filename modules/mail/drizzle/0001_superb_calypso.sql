ALTER TABLE "mail_messages" ADD COLUMN "external_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "mail_messages_external_id_uidx" ON "mail_messages" USING btree ("external_id");