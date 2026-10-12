CREATE TABLE "docs_comments" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"document_id" uuid NOT NULL,
	"author_id" text NOT NULL,
	"body" text NOT NULL,
	"quote" text,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "docs_comments" ADD CONSTRAINT "docs_comments_document_id_docs_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."docs_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "docs_comments" ADD CONSTRAINT "docs_comments_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "docs_comments_document_created_idx" ON "docs_comments" USING btree ("document_id","created_at");