ALTER TABLE "slide_elements" ADD COLUMN "italic" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "slide_elements" ADD COLUMN "underline" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "slide_elements" ADD COLUMN "text_color" text DEFAULT 'default' NOT NULL;--> statement-breakpoint
ALTER TABLE "slide_elements" ADD COLUMN "placeholder" text;