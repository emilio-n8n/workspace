ALTER TABLE "chat_channels" ADD COLUMN "visibility" text DEFAULT 'public' NOT NULL;--> statement-breakpoint
ALTER TABLE "chat_channels" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
CREATE TABLE "chat_pins" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"channel_id" uuid NOT NULL,
	"message_id" uuid NOT NULL,
	"pinned_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chat_pins" ADD CONSTRAINT "chat_pins_channel_id_chat_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."chat_channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_pins" ADD CONSTRAINT "chat_pins_message_id_chat_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."chat_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_pins" ADD CONSTRAINT "chat_pins_pinned_by_user_id_fk" FOREIGN KEY ("pinned_by") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "chat_pins_channel_message_uidx" ON "chat_pins" USING btree ("channel_id","message_id");--> statement-breakpoint
CREATE INDEX "chat_pins_channel_created_idx" ON "chat_pins" USING btree ("channel_id","created_at");
