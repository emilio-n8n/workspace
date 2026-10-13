CREATE TABLE "classroom_submission_attachments" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"submission_id" uuid NOT NULL,
	"filename" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"storage_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "classroom_submission_attachments" ADD CONSTRAINT "classroom_submission_attachments_submission_id_classroom_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."classroom_submissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "classroom_submission_attachments_submission_idx" ON "classroom_submission_attachments" USING btree ("submission_id");