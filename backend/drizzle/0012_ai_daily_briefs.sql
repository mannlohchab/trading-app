CREATE TABLE "ai_market_briefs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brief_date" date NOT NULL,
	"content" text NOT NULL,
	"audio" bytea,
	"audio_content_type" varchar(80),
	"text_model" varchar(100),
	"audio_model" varchar(100),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_market_briefs_date_uq" UNIQUE("brief_date")
);
--> statement-breakpoint
CREATE INDEX "ai_market_briefs_created_idx" ON "ai_market_briefs" ("created_at" DESC);