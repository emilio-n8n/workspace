CREATE TABLE "meet_lobby" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"room_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"state" text DEFAULT 'waiting' NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by" text
);
--> statement-breakpoint
ALTER TABLE "meet_rooms" ADD COLUMN "require_admission" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "meet_lobby" ADD CONSTRAINT "meet_lobby_room_id_meet_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."meet_rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meet_lobby" ADD CONSTRAINT "meet_lobby_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meet_lobby" ADD CONSTRAINT "meet_lobby_resolved_by_user_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "meet_lobby_room_user_uidx" ON "meet_lobby" USING btree ("room_id","user_id");--> statement-breakpoint
CREATE INDEX "meet_lobby_room_state_idx" ON "meet_lobby" USING btree ("room_id","state");