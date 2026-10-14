CREATE TABLE "meet_members" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"room_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role" text DEFAULT 'participant' NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"left_at" timestamp with time zone,
	"muted_at" timestamp with time zone,
	"muted_by" text,
	"removed_at" timestamp with time zone,
	"removed_by" text,
	"hand_raised_at" timestamp with time zone,
	"chat_read_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "meet_messages" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"room_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "meet_members" ADD CONSTRAINT "meet_members_room_id_meet_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."meet_rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meet_members" ADD CONSTRAINT "meet_members_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meet_members" ADD CONSTRAINT "meet_members_muted_by_user_id_fk" FOREIGN KEY ("muted_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meet_members" ADD CONSTRAINT "meet_members_removed_by_user_id_fk" FOREIGN KEY ("removed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meet_messages" ADD CONSTRAINT "meet_messages_room_id_meet_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."meet_rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meet_messages" ADD CONSTRAINT "meet_messages_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "meet_members_room_user_uidx" ON "meet_members" USING btree ("room_id","user_id");--> statement-breakpoint
CREATE INDEX "meet_members_room_role_idx" ON "meet_members" USING btree ("room_id","role");--> statement-breakpoint
CREATE INDEX "meet_members_room_hand_idx" ON "meet_members" USING btree ("room_id","hand_raised_at");--> statement-breakpoint
CREATE INDEX "meet_messages_room_created_idx" ON "meet_messages" USING btree ("room_id","created_at");