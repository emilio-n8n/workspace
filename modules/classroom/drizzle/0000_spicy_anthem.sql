CREATE TABLE "classroom_assignments" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"course_id" uuid NOT NULL,
	"title" text NOT NULL,
	"instructions" text DEFAULT '' NOT NULL,
	"due_at" timestamp with time zone,
	"points" integer DEFAULT 100 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "classroom_courses" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"section" text,
	"join_code" text NOT NULL,
	"owner_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "classroom_members" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"course_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role" text DEFAULT 'student' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "classroom_submissions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"assignment_id" uuid NOT NULL,
	"student_id" text NOT NULL,
	"content" text NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"grade" integer,
	"feedback" text,
	"graded_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "classroom_assignments" ADD CONSTRAINT "classroom_assignments_course_id_classroom_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."classroom_courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "classroom_courses" ADD CONSTRAINT "classroom_courses_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "classroom_courses" ADD CONSTRAINT "classroom_courses_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "classroom_members" ADD CONSTRAINT "classroom_members_course_id_classroom_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."classroom_courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "classroom_members" ADD CONSTRAINT "classroom_members_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "classroom_submissions" ADD CONSTRAINT "classroom_submissions_assignment_id_classroom_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."classroom_assignments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "classroom_submissions" ADD CONSTRAINT "classroom_submissions_student_id_user_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "classroom_assignments_course_idx" ON "classroom_assignments" USING btree ("course_id");--> statement-breakpoint
CREATE UNIQUE INDEX "classroom_courses_code_uidx" ON "classroom_courses" USING btree ("join_code");--> statement-breakpoint
CREATE INDEX "classroom_courses_org_idx" ON "classroom_courses" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "classroom_members_course_user_uidx" ON "classroom_members" USING btree ("course_id","user_id");--> statement-breakpoint
CREATE INDEX "classroom_members_user_idx" ON "classroom_members" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "classroom_submissions_assignment_student_uidx" ON "classroom_submissions" USING btree ("assignment_id","student_id");