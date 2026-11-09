ALTER TABLE "user_preferences" ADD COLUMN "language" varchar(16) DEFAULT 'en' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD COLUMN "timezone" varchar(64) DEFAULT 'UTC' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD COLUMN "default_market_type" "asset_type" DEFAULT 'SPOT' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD COLUMN "default_trading_symbol_id" uuid;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD COLUMN "chart_type" varchar(20) DEFAULT 'CANDLES' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD COLUMN "ai_response_style" varchar(20) DEFAULT 'BALANCED' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD COLUMN "ai_explanation_level" varchar(20) DEFAULT 'BEGINNER' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD COLUMN "ai_language" varchar(16);--> statement-breakpoint
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_default_symbol_fk" FOREIGN KEY ("default_trading_symbol_id") REFERENCES "public"."trading_symbols"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_timeframe_chk" CHECK ("user_preferences"."default_timeframe" IN ('1m', '5m', '15m', '30m', '1h', '4h', '1d', '1w', '1M'));--> statement-breakpoint
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_market_type_chk" CHECK ("user_preferences"."default_market_type" IN ('SPOT', 'PERPETUAL', 'FUTURES', 'FOREX'));--> statement-breakpoint
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_chart_type_chk" CHECK ("user_preferences"."chart_type" IN ('CANDLES', 'HEIKIN_ASHI', 'BARS', 'LINE', 'AREA'));--> statement-breakpoint
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_ai_response_style_chk" CHECK ("user_preferences"."ai_response_style" IN ('CONCISE', 'BALANCED', 'DETAILED'));--> statement-breakpoint
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_ai_explanation_level_chk" CHECK ("user_preferences"."ai_explanation_level" IN ('BEGINNER', 'INTERMEDIATE', 'ADVANCED'));--> statement-breakpoint
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_currency_format_chk" CHECK ("user_preferences"."default_currency" ~ '^[A-Z]{3,10}$');