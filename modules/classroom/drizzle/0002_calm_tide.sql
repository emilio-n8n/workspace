CREATE TABLE "classroom_announcements" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"course_id" uuid NOT NULL,
	"author_id" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "classroom_announcement_comments" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"announcement_id" uuid NOT NULL,
	"author_id" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "classroom_announcements" ADD CONSTRAINT "classroom_announcements_course_id_classroom_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."classroom_courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "classroom_announcements" ADD CONSTRAINT "classroom_announcements_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "classroom_announcement_comments" ADD CONSTRAINT "classroom_announcement_comments_announcement_id_classroom_announcements_id_fk" FOREIGN KEY ("announcement_id") REFERENCES "public"."classroom_announcements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "classroom_announcement_comments" ADD CONSTRAINT "classroom_announcement_comments_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "classroom_announcements_course_idx" ON "classroom_announcements" USING btree ("course_id","created_at");--> statement-breakpoint
CREATE INDEX "classroom_announcement_comments_announcement_idx" ON "classroom_announcement_comments" USING btree ("announcement_id","created_at");
