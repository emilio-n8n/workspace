ALTER TABLE "presentations" ADD COLUMN "transition" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "presentations" ADD COLUMN "transition_ms" integer DEFAULT 400 NOT NULL;