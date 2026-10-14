ALTER TABLE "form_questions" ADD COLUMN "condition" jsonb;--> statement-breakpoint
ALTER TABLE "forms" ADD COLUMN "accent" text DEFAULT 'forms' NOT NULL;