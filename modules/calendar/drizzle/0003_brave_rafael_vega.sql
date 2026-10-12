ALTER TABLE "calendar_events" ADD COLUMN "recurrence" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD COLUMN "recurrence_until" timestamp with time zone;