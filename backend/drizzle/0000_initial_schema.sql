CREATE TYPE "public"."asset_type" AS ENUM('SPOT', 'PERPETUAL', 'FUTURES', 'FOREX', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."auth_provider" AS ENUM('GOOGLE', 'APPLE', 'EMAIL');--> statement-breakpoint
CREATE TYPE "public"."background_job_status" AS ENUM('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."backtest_status" AS ENUM('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."consent_type" AS ENUM('TERMS_OF_SERVICE', 'PRIVACY_POLICY', 'MARKETING_COMMUNICATIONS', 'AI_DATA_PROCESSING');--> statement-breakpoint
CREATE TYPE "public"."conversation_status" AS ENUM('ACTIVE', 'ARCHIVED', 'DELETED');--> statement-breakpoint
CREATE TYPE "public"."exchange_type" AS ENUM('CRYPTO', 'FOREX', 'STOCKS', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."message_role" AS ENUM('USER', 'ASSISTANT', 'SYSTEM');--> statement-breakpoint
CREATE TYPE "public"."paper_order_status" AS ENUM('PENDING', 'OPEN', 'PARTIALLY_FILLED', 'FILLED', 'CANCELLED', 'REJECTED', 'EXPIRED');--> statement-breakpoint
CREATE TYPE "public"."paper_order_type" AS ENUM('MARKET', 'LIMIT', 'STOP_MARKET', 'STOP_LIMIT');--> statement-breakpoint
CREATE TYPE "public"."paper_position_side" AS ENUM('LONG', 'SHORT');--> statement-breakpoint
CREATE TYPE "public"."paper_transaction_type" AS ENUM('INITIAL_DEPOSIT', 'ORDER_FILL', 'TRADING_FEE', 'FUNDING_FEE', 'REALIZED_PNL', 'ADJUSTMENT');--> statement-breakpoint
CREATE TYPE "public"."phone_verification_purpose" AS ENUM('REGISTRATION', 'LOGIN', 'PHONE_CHANGE', 'ACCOUNT_RECOVERY');--> statement-breakpoint
CREATE TYPE "public"."strategy_source" AS ENUM('AI_GENERATED', 'USER_CREATED');--> statement-breakpoint
CREATE TYPE "public"."strategy_status" AS ENUM('ACTIVE', 'ARCHIVED', 'DELETED');--> statement-breakpoint
CREATE TYPE "public"."strategy_visibility" AS ENUM('PRIVATE', 'PUBLIC');--> statement-breakpoint
CREATE TYPE "public"."trade_side" AS ENUM('BUY', 'SELL', 'LONG', 'SHORT');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('PENDING_PHONE_VERIFICATION', 'ACTIVE', 'SUSPENDED', 'DELETED');--> statement-breakpoint
CREATE TABLE "auth_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" "auth_provider" NOT NULL,
	"provider_account_id" varchar(255) NOT NULL,
	"password_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_accounts_provider_account_uq" UNIQUE("provider","provider_account_id"),
	CONSTRAINT "auth_accounts_email_password_chk" CHECK (("auth_accounts"."provider" = 'EMAIL' AND "auth_accounts"."password_hash" IS NOT NULL) OR ("auth_accounts"."provider" <> 'EMAIL' AND "auth_accounts"."password_hash" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "background_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_type" varchar(50) NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "background_job_status" DEFAULT 'PENDING' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	"locked_by" varchar(100),
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "background_jobs_attempts_chk" CHECK ("background_jobs"."attempts" >= 0 AND "background_jobs"."max_attempts" > 0)
);
--> statement-breakpoint
CREATE TABLE "backtest_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"strategy_version_id" uuid NOT NULL,
	"symbol_id" uuid NOT NULL,
	"timeframe" varchar(10) NOT NULL,
	"start_time" bigint NOT NULL,
	"end_time" bigint NOT NULL,
	"initial_balance" numeric(30, 12) NOT NULL,
	"fee_rate" numeric(18, 12) DEFAULT 0 NOT NULL,
	"slippage_rate" numeric(18, 12) DEFAULT 0 NOT NULL,
	"configuration" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "backtest_status" DEFAULT 'PENDING' NOT NULL,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	CONSTRAINT "backtest_jobs_time_chk" CHECK ("backtest_jobs"."end_time" > "backtest_jobs"."start_time"),
	CONSTRAINT "backtest_jobs_balance_chk" CHECK ("backtest_jobs"."initial_balance" > 0),
	CONSTRAINT "backtest_jobs_costs_chk" CHECK ("backtest_jobs"."fee_rate" >= 0 AND "backtest_jobs"."slippage_rate" >= 0)
);
--> statement-breakpoint
CREATE TABLE "backtest_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"backtest_job_id" uuid NOT NULL,
	"final_balance" numeric(30, 12),
	"net_profit" numeric(30, 12),
	"total_return" numeric(18, 8),
	"win_rate" numeric(18, 8),
	"profit_factor" numeric(18, 8),
	"max_drawdown" numeric(18, 8),
	"total_trades" integer DEFAULT 0 NOT NULL,
	"winning_trades" integer DEFAULT 0 NOT NULL,
	"losing_trades" integer DEFAULT 0 NOT NULL,
	"average_profit" numeric(30, 12),
	"average_loss" numeric(30, 12),
	"metrics" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "backtest_results_backtest_job_id_key" UNIQUE("backtest_job_id"),
	CONSTRAINT "backtest_results_counts_chk" CHECK ("backtest_results"."total_trades" >= 0 AND "backtest_results"."winning_trades" >= 0 AND "backtest_results"."losing_trades" >= 0 AND "backtest_results"."winning_trades" + "backtest_results"."losing_trades" <= "backtest_results"."total_trades")
);
--> statement-breakpoint
CREATE TABLE "backtest_trades" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"backtest_result_id" uuid NOT NULL,
	"symbol_id" uuid NOT NULL,
	"side" "trade_side" NOT NULL,
	"entry_time" bigint NOT NULL,
	"exit_time" bigint,
	"entry_price" numeric(30, 12) NOT NULL,
	"exit_price" numeric(30, 12),
	"quantity" numeric(30, 12) NOT NULL,
	"profit_loss" numeric(30, 12),
	"fees" numeric(30, 12) DEFAULT 0 NOT NULL,
	"exit_reason" varchar(50),
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "backtest_trades_quantity_chk" CHECK ("backtest_trades"."quantity" > 0),
	CONSTRAINT "backtest_trades_entry_price_chk" CHECK ("backtest_trades"."entry_price" > 0),
	CONSTRAINT "backtest_trades_exit_time_chk" CHECK ("backtest_trades"."exit_time" IS NULL OR "backtest_trades"."exit_time" >= "backtest_trades"."entry_time")
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"title" varchar(255),
	"status" "conversation_status" DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exchanges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(100) NOT NULL,
	"code" varchar(30) NOT NULL,
	"exchange_type" "exchange_type" DEFAULT 'CRYPTO' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exchanges_code_key" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "market_candles" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "market_candles_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"symbol_id" uuid NOT NULL,
	"timeframe" varchar(10) NOT NULL,
	"open_time" bigint NOT NULL,
	"close_time" bigint NOT NULL,
	"open" numeric(30, 12) NOT NULL,
	"high" numeric(30, 12) NOT NULL,
	"low" numeric(30, 12) NOT NULL,
	"close" numeric(30, 12) NOT NULL,
	"volume" numeric(30, 12) DEFAULT 0 NOT NULL,
	"quote_volume" numeric(30, 12),
	"trades_count" integer,
	"is_closed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "market_candles_symbol_tf_open_uq" UNIQUE("symbol_id","timeframe","open_time"),
	CONSTRAINT "market_candles_time_chk" CHECK ("market_candles"."close_time" >= "market_candles"."open_time"),
	CONSTRAINT "market_candles_ohlc_chk" CHECK ("market_candles"."high" >= "market_candles"."low" AND "market_candles"."high" >= "market_candles"."open" AND "market_candles"."high" >= "market_candles"."close" AND "market_candles"."low" <= "market_candles"."open" AND "market_candles"."low" <= "market_candles"."close"),
	CONSTRAINT "market_candles_volume_chk" CHECK ("market_candles"."volume" >= 0 AND ("market_candles"."quote_volume" IS NULL OR "market_candles"."quote_volume" >= 0))
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"role" "message_role" NOT NULL,
	"content" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"model_provider" varchar(50),
	"model_name" varchar(100),
	"token_usage" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "paper_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" varchar(100) NOT NULL,
	"initial_balance" numeric(30, 12) NOT NULL,
	"current_balance" numeric(30, 12) NOT NULL,
	"currency" varchar(10) DEFAULT 'USDT' NOT NULL,
	"status" varchar(20) DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "paper_accounts_initial_balance_chk" CHECK ("paper_accounts"."initial_balance" >= 0),
	CONSTRAINT "paper_accounts_status_chk" CHECK ("paper_accounts"."status" IN ('ACTIVE', 'PAUSED', 'ARCHIVED'))
);
--> statement-breakpoint
CREATE TABLE "paper_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"paper_account_id" uuid NOT NULL,
	"symbol_id" uuid NOT NULL,
	"side" "trade_side" NOT NULL,
	"order_type" "paper_order_type" NOT NULL,
	"quantity" numeric(30, 12) NOT NULL,
	"price" numeric(30, 12),
	"stop_price" numeric(30, 12),
	"status" "paper_order_status" DEFAULT 'PENDING' NOT NULL,
	"filled_quantity" numeric(30, 12) DEFAULT 0 NOT NULL,
	"average_fill_price" numeric(30, 12),
	"time_in_force" varchar(10) DEFAULT 'GTC' NOT NULL,
	"strategy_version_id" uuid,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "paper_orders_quantity_chk" CHECK ("paper_orders"."quantity" > 0 AND "paper_orders"."filled_quantity" >= 0 AND "paper_orders"."filled_quantity" <= "paper_orders"."quantity"),
	CONSTRAINT "paper_orders_price_chk" CHECK (("paper_orders"."price" IS NULL OR "paper_orders"."price" > 0) AND ("paper_orders"."stop_price" IS NULL OR "paper_orders"."stop_price" > 0) AND ("paper_orders"."average_fill_price" IS NULL OR "paper_orders"."average_fill_price" > 0)),
	CONSTRAINT "paper_orders_tif_chk" CHECK ("paper_orders"."time_in_force" IN ('GTC', 'IOC', 'FOK'))
);
--> statement-breakpoint
CREATE TABLE "paper_positions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"paper_account_id" uuid NOT NULL,
	"symbol_id" uuid NOT NULL,
	"side" "paper_position_side" NOT NULL,
	"quantity" numeric(30, 12) NOT NULL,
	"average_entry_price" numeric(30, 12) NOT NULL,
	"realized_pnl" numeric(30, 12) DEFAULT 0 NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "paper_positions_account_symbol_side_uq" UNIQUE("paper_account_id","symbol_id","side"),
	CONSTRAINT "paper_positions_quantity_chk" CHECK ("paper_positions"."quantity" > 0),
	CONSTRAINT "paper_positions_entry_price_chk" CHECK ("paper_positions"."average_entry_price" > 0)
);
--> statement-breakpoint
CREATE TABLE "paper_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"paper_account_id" uuid NOT NULL,
	"order_id" uuid,
	"transaction_type" "paper_transaction_type" NOT NULL,
	"amount" numeric(30, 12) NOT NULL,
	"balance_after" numeric(30, 12) NOT NULL,
	"description" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "phone_verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"phone_number" varchar(20) NOT NULL,
	"otp_hash" text NOT NULL,
	"purpose" "phone_verification_purpose" NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"verified_at" timestamp with time zone,
	"consumed_at" timestamp with time zone,
	"provider" varchar(50),
	"request_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "phone_verifications_phone_format_chk" CHECK ("phone_verifications"."phone_number" ~ '^\+[1-9][0-9]{7,14}$'),
	CONSTRAINT "phone_verifications_attempts_chk" CHECK ("phone_verifications"."attempts" >= 0 AND "phone_verifications"."max_attempts" > 0)
);
--> statement-breakpoint
CREATE TABLE "strategies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"source" "strategy_source" NOT NULL,
	"visibility" "strategy_visibility" DEFAULT 'PRIVATE' NOT NULL,
	"status" "strategy_status" DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "strategy_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"strategy_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"definition" jsonb NOT NULL,
	"parameters" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"risk_settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"engine_version" varchar(30) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "strategy_versions_strategy_version_uq" UNIQUE("strategy_id","version"),
	CONSTRAINT "strategy_versions_version_chk" CHECK ("strategy_versions"."version" > 0),
	CONSTRAINT "strategy_versions_definition_object_chk" CHECK (jsonb_typeof("strategy_versions"."definition") = 'object')
);
--> statement-breakpoint
CREATE TABLE "trading_symbols" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"exchange_id" uuid NOT NULL,
	"symbol" varchar(50) NOT NULL,
	"base_asset" varchar(30) NOT NULL,
	"quote_asset" varchar(30) NOT NULL,
	"asset_type" "asset_type" DEFAULT 'SPOT' NOT NULL,
	"price_precision" integer,
	"quantity_precision" integer,
	"price_tick_size" numeric(30, 12),
	"quantity_step_size" numeric(30, 12),
	"is_active" boolean DEFAULT true NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trading_symbols_exchange_symbol_uq" UNIQUE("exchange_id","symbol"),
	CONSTRAINT "trading_symbols_precision_chk" CHECK (("trading_symbols"."price_precision" IS NULL OR "trading_symbols"."price_precision" >= 0) AND ("trading_symbols"."quantity_precision" IS NULL OR "trading_symbols"."quantity_precision" >= 0))
);
--> statement-breakpoint
CREATE TABLE "user_consents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"consent_type" "consent_type" NOT NULL,
	"document_version" varchar(30) NOT NULL,
	"accepted_at" timestamp with time zone,
	"withdrawn_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_preferences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"default_exchange_id" uuid,
	"default_timeframe" varchar(10) DEFAULT '1h' NOT NULL,
	"default_currency" varchar(10) DEFAULT 'USDT' NOT NULL,
	"theme" varchar(20) DEFAULT 'SYSTEM' NOT NULL,
	"notifications_enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_preferences_user_id_key" UNIQUE("user_id"),
	CONSTRAINT "user_preferences_theme_chk" CHECK ("user_preferences"."theme" IN ('LIGHT', 'DARK', 'SYSTEM'))
);
--> statement-breakpoint
CREATE TABLE "user_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"first_name" varchar(100),
	"last_name" varchar(100),
	"profile_image_url" text,
	"bio" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_profiles_user_id_key" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "user_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"refresh_token_hash" text NOT NULL,
	"device_name" varchar(255),
	"device_type" varchar(30),
	"ip_address" "inet",
	"user_agent" text,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_sessions_refresh_token_hash_key" UNIQUE("refresh_token_hash")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"phone_number" varchar(20),
	"phone_verified_at" timestamp with time zone,
	"email" varchar(255),
	"email_verified_at" timestamp with time zone,
	"username" varchar(30),
	"status" "user_status" DEFAULT 'PENDING_PHONE_VERIFICATION' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "users_phone_number_format_chk" CHECK ("users"."phone_number" IS NULL OR "users"."phone_number" ~ '^\+[1-9][0-9]{7,14}$'),
	CONSTRAINT "users_username_format_chk" CHECK ("users"."username" IS NULL OR "users"."username" ~ '^[A-Za-z0-9_]{3,30}$'),
	CONSTRAINT "users_active_requires_verified_phone_chk" CHECK ("users"."status" <> 'ACTIVE' OR "users"."phone_verified_at" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "auth_accounts" ADD CONSTRAINT "auth_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backtest_jobs" ADD CONSTRAINT "backtest_jobs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backtest_jobs" ADD CONSTRAINT "backtest_jobs_strategy_version_id_strategy_versions_id_fk" FOREIGN KEY ("strategy_version_id") REFERENCES "public"."strategy_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backtest_jobs" ADD CONSTRAINT "backtest_jobs_symbol_id_trading_symbols_id_fk" FOREIGN KEY ("symbol_id") REFERENCES "public"."trading_symbols"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backtest_results" ADD CONSTRAINT "backtest_results_backtest_job_id_backtest_jobs_id_fk" FOREIGN KEY ("backtest_job_id") REFERENCES "public"."backtest_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backtest_trades" ADD CONSTRAINT "backtest_trades_backtest_result_id_backtest_results_id_fk" FOREIGN KEY ("backtest_result_id") REFERENCES "public"."backtest_results"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backtest_trades" ADD CONSTRAINT "backtest_trades_symbol_id_trading_symbols_id_fk" FOREIGN KEY ("symbol_id") REFERENCES "public"."trading_symbols"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_candles" ADD CONSTRAINT "market_candles_symbol_id_trading_symbols_id_fk" FOREIGN KEY ("symbol_id") REFERENCES "public"."trading_symbols"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paper_accounts" ADD CONSTRAINT "paper_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paper_orders" ADD CONSTRAINT "paper_orders_paper_account_id_paper_accounts_id_fk" FOREIGN KEY ("paper_account_id") REFERENCES "public"."paper_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paper_orders" ADD CONSTRAINT "paper_orders_symbol_id_trading_symbols_id_fk" FOREIGN KEY ("symbol_id") REFERENCES "public"."trading_symbols"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paper_orders" ADD CONSTRAINT "paper_orders_strategy_version_id_strategy_versions_id_fk" FOREIGN KEY ("strategy_version_id") REFERENCES "public"."strategy_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paper_positions" ADD CONSTRAINT "paper_positions_paper_account_id_paper_accounts_id_fk" FOREIGN KEY ("paper_account_id") REFERENCES "public"."paper_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paper_positions" ADD CONSTRAINT "paper_positions_symbol_id_trading_symbols_id_fk" FOREIGN KEY ("symbol_id") REFERENCES "public"."trading_symbols"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paper_transactions" ADD CONSTRAINT "paper_transactions_paper_account_id_paper_accounts_id_fk" FOREIGN KEY ("paper_account_id") REFERENCES "public"."paper_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paper_transactions" ADD CONSTRAINT "paper_transactions_order_id_paper_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."paper_orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "phone_verifications" ADD CONSTRAINT "phone_verifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strategies" ADD CONSTRAINT "strategies_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strategy_versions" ADD CONSTRAINT "strategy_versions_strategy_id_strategies_id_fk" FOREIGN KEY ("strategy_id") REFERENCES "public"."strategies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trading_symbols" ADD CONSTRAINT "trading_symbols_exchange_id_exchanges_id_fk" FOREIGN KEY ("exchange_id") REFERENCES "public"."exchanges"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_consents" ADD CONSTRAINT "user_consents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_default_exchange_fk" FOREIGN KEY ("default_exchange_id") REFERENCES "public"."exchanges"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auth_accounts_user_id_idx" ON "auth_accounts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "background_jobs_claim_idx" ON "background_jobs" USING btree ("available_at","created_at") WHERE "background_jobs"."status" = 'PENDING';--> statement-breakpoint
CREATE INDEX "background_jobs_stale_lock_idx" ON "background_jobs" USING btree ("locked_at") WHERE "background_jobs"."status" = 'RUNNING';--> statement-breakpoint
CREATE INDEX "backtest_jobs_user_created_idx" ON "backtest_jobs" USING btree ("user_id","created_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "backtest_jobs_status_created_idx" ON "backtest_jobs" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "backtest_trades_result_entry_idx" ON "backtest_trades" USING btree ("backtest_result_id","entry_time");--> statement-breakpoint
CREATE INDEX "conversations_user_updated_idx" ON "conversations" USING btree ("user_id","updated_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "market_candles_range_idx" ON "market_candles" USING btree ("symbol_id","timeframe","open_time" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "messages_conversation_created_idx" ON "messages" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "paper_accounts_user_created_idx" ON "paper_accounts" USING btree ("user_id","created_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "paper_orders_account_created_idx" ON "paper_orders" USING btree ("paper_account_id","created_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "paper_orders_open_status_idx" ON "paper_orders" USING btree ("paper_account_id","status") WHERE "paper_orders"."status" IN ('PENDING', 'OPEN', 'PARTIALLY_FILLED');--> statement-breakpoint
CREATE INDEX "paper_positions_account_idx" ON "paper_positions" USING btree ("paper_account_id");--> statement-breakpoint
CREATE INDEX "paper_transactions_account_created_idx" ON "paper_transactions" USING btree ("paper_account_id","created_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "phone_verifications_lookup_idx" ON "phone_verifications" USING btree ("phone_number","purpose","created_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "phone_verifications_user_idx" ON "phone_verifications" USING btree ("user_id","created_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "strategies_user_updated_idx" ON "strategies" USING btree ("user_id","updated_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "strategy_versions_strategy_created_idx" ON "strategy_versions" USING btree ("strategy_id","created_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "trading_symbols_base_quote_idx" ON "trading_symbols" USING btree ("base_asset","quote_asset");--> statement-breakpoint
CREATE INDEX "user_consents_user_type_idx" ON "user_consents" USING btree ("user_id","consent_type","created_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "user_sessions_user_active_idx" ON "user_sessions" USING btree ("user_id","expires_at" DESC NULLS FIRST) WHERE "user_sessions"."revoked_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "users_phone_number_uq" ON "users" USING btree ("phone_number") WHERE "users"."phone_number" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_lower_uq" ON "users" USING btree (lower("email")) WHERE "users"."email" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "users_username_lower_uq" ON "users" USING btree (lower("username")) WHERE "users"."username" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "users_status_created_at_idx" ON "users" USING btree ("status","created_at" DESC NULLS FIRST);