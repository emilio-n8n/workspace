ALTER TABLE "chat_channels" ADD COLUMN "dm_key" text;--> statement-breakpoint
CREATE UNIQUE INDEX "chat_channels_dm_key_uidx" ON "chat_channels" USING btree ("dm_key");