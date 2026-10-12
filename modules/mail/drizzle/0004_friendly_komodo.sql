ALTER TABLE "mail_messages" ADD COLUMN "thread_key" text;--> statement-breakpoint
CREATE INDEX "mail_messages_mailbox_thread_idx" ON "mail_messages" USING btree ("mailbox_id","thread_key");