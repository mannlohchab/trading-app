CREATE TABLE "news_articles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"canonical_url" varchar(2048) NOT NULL,
	"url" varchar(2048) NOT NULL,
	"title" varchar(500) NOT NULL,
	"summary" text,
	"image_url" varchar(2048),
	"author" varchar(200),
	"publisher" varchar(100) NOT NULL,
	"publisher_key" varchar(50) NOT NULL,
	"published_at" timestamp with time zone NOT NULL,
	"breaking_at" timestamp with time zone,
	"categories" text[] DEFAULT '{}'::text[] NOT NULL,
	"assets" text[] DEFAULT '{}'::text[] NOT NULL,
	"providers" text[] DEFAULT '{}'::text[] NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"search" "tsvector" GENERATED ALWAYS AS (to_tsvector('english', "news_articles"."title" || ' ' || coalesce("news_articles"."summary", ''))) STORED,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "news_articles_url_http_chk" CHECK ("news_articles"."url" ~ '^https?://' AND ("news_articles"."image_url" IS NULL OR "news_articles"."image_url" ~ '^https?://'))
);
--> statement-breakpoint
CREATE TABLE "news_sources" (
	"id" varchar(50) PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"kind" varchar(20) NOT NULL,
	"next_run_at" timestamp with time zone NOT NULL,
	"last_attempt_at" timestamp with time zone,
	"last_success_at" timestamp with time zone,
	"last_error" text,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"last_item_count" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "news_sources_failures_chk" CHECK ("news_sources"."consecutive_failures" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "news_articles_canonical_url_uq" ON "news_articles" USING btree ("canonical_url");--> statement-breakpoint
CREATE INDEX "news_articles_published_idx" ON "news_articles" USING btree ("published_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "news_articles_publisher_idx" ON "news_articles" USING btree ("publisher_key","published_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "news_articles_assets_idx" ON "news_articles" USING gin ("assets");--> statement-breakpoint
CREATE INDEX "news_articles_search_idx" ON "news_articles" USING gin ("search");--> statement-breakpoint
CREATE INDEX "news_articles_breaking_idx" ON "news_articles" USING btree ("breaking_at") WHERE "news_articles"."breaking_at" IS NOT NULL;--> statement-breakpoint
CREATE TRIGGER news_articles_set_updated_at
  BEFORE UPDATE ON news_articles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER news_sources_set_updated_at
  BEFORE UPDATE ON news_sources
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
