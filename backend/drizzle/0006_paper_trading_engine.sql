ALTER TYPE "public"."paper_transaction_type" ADD VALUE 'ORDER_RESERVE';--> statement-breakpoint
ALTER TYPE "public"."paper_transaction_type" ADD VALUE 'ORDER_RELEASE';--> statement-breakpoint
ALTER TYPE "public"."paper_transaction_type" ADD VALUE 'POSITION_MARGIN';--> statement-breakpoint
ALTER TYPE "public"."paper_transaction_type" ADD VALUE 'POSITION_MARGIN_RELEASE';--> statement-breakpoint
CREATE TABLE "paper_strategy_instances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"paper_account_id" uuid NOT NULL,
	"strategy_id" uuid NOT NULL,
	"strategy_version_id" uuid NOT NULL,
	"symbol_id" uuid NOT NULL,
	"timeframe" varchar(10) NOT NULL,
	"status" varchar(10) DEFAULT 'CREATED' NOT NULL,
	"configuration" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_processed_candle_time" bigint,
	"last_signal_id" uuid,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"paused_at" timestamp with time zone,
	"stopped_at" timestamp with time zone,
	CONSTRAINT "paper_strategy_instances_status_chk" CHECK ("paper_strategy_instances"."status" IN ('CREATED', 'RUNNING', 'PAUSED', 'STOPPED', 'FAILED'))
);
--> statement-breakpoint
CREATE TABLE "paper_signals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"strategy_instance_id" uuid NOT NULL,
	"candle_open_time" bigint NOT NULL,
	"action" varchar(20) NOT NULL,
	"status" varchar(20) DEFAULT 'GENERATED' NOT NULL,
	"reason" text,
	"order_id" uuid,
	"evaluation" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "paper_signals_status_chk" CHECK ("paper_signals"."status" IN ('GENERATED', 'EXECUTED', 'REJECTED', 'SKIPPED'))
);
--> statement-breakpoint
ALTER TABLE "paper_positions" DROP CONSTRAINT "paper_positions_account_symbol_side_uq";--> statement-breakpoint
ALTER TABLE "paper_accounts" DROP CONSTRAINT "paper_accounts_status_chk";--> statement-breakpoint
ALTER TABLE "paper_positions" DROP CONSTRAINT "paper_positions_quantity_chk";--> statement-breakpoint
ALTER TABLE "paper_accounts" ADD COLUMN "reserved_balance" numeric(30, 12) DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "paper_accounts" ADD COLUMN "realized_pnl" numeric(30, 12) DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "paper_accounts" ADD COLUMN "total_fees" numeric(30, 12) DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "paper_accounts" ADD COLUMN "closed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "paper_orders" ADD COLUMN "user_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "paper_orders" ADD COLUMN "idempotency_key" varchar(120);--> statement-breakpoint
ALTER TABLE "paper_orders" ADD COLUMN "source" varchar(20) DEFAULT 'USER' NOT NULL;--> statement-breakpoint
ALTER TABLE "paper_orders" ADD COLUMN "strategy_instance_id" uuid;--> statement-breakpoint
ALTER TABLE "paper_orders" ADD COLUMN "reduce_only" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "paper_orders" ADD COLUMN "oco_group" uuid;--> statement-breakpoint
ALTER TABLE "paper_orders" ADD COLUMN "commission" numeric(30, 12) DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "paper_orders" ADD COLUMN "reserved_amount" numeric(30, 12) DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "paper_orders" ADD COLUMN "reject_reason" text;--> statement-breakpoint
ALTER TABLE "paper_orders" ADD COLUMN "triggered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "paper_orders" ADD COLUMN "filled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "paper_orders" ADD COLUMN "cancelled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "paper_positions" ADD COLUMN "total_fees" numeric(30, 12) DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "paper_positions" ADD COLUMN "status" varchar(10) DEFAULT 'OPEN' NOT NULL;--> statement-breakpoint
ALTER TABLE "paper_positions" ADD COLUMN "last_mark_price" numeric(30, 12);--> statement-breakpoint
ALTER TABLE "paper_positions" ADD COLUMN "last_mark_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "paper_positions" ADD COLUMN "closed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "paper_transactions" ADD COLUMN "reserved_delta" numeric(30, 12) DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "paper_transactions" ADD COLUMN "reserved_after" numeric(30, 12) DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "paper_transactions" ADD COLUMN "entry_key" varchar(150) NOT NULL;--> statement-breakpoint
ALTER TABLE "background_jobs" ADD COLUMN "dedupe_key" varchar(200);--> statement-breakpoint
ALTER TABLE "paper_strategy_instances" ADD CONSTRAINT "paper_strategy_instances_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paper_strategy_instances" ADD CONSTRAINT "paper_strategy_instances_paper_account_id_paper_accounts_id_fk" FOREIGN KEY ("paper_account_id") REFERENCES "public"."paper_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paper_strategy_instances" ADD CONSTRAINT "paper_strategy_instances_strategy_id_strategies_id_fk" FOREIGN KEY ("strategy_id") REFERENCES "public"."strategies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paper_strategy_instances" ADD CONSTRAINT "paper_strategy_instances_strategy_version_id_strategy_versions_id_fk" FOREIGN KEY ("strategy_version_id") REFERENCES "public"."strategy_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paper_strategy_instances" ADD CONSTRAINT "paper_strategy_instances_symbol_id_trading_symbols_id_fk" FOREIGN KEY ("symbol_id") REFERENCES "public"."trading_symbols"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paper_signals" ADD CONSTRAINT "paper_signals_strategy_instance_id_paper_strategy_instances_id_fk" FOREIGN KEY ("strategy_instance_id") REFERENCES "public"."paper_strategy_instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paper_signals" ADD CONSTRAINT "paper_signals_order_id_paper_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."paper_orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "paper_strategy_instances_live_uq" ON "paper_strategy_instances" USING btree ("paper_account_id","symbol_id") WHERE "paper_strategy_instances"."status" IN ('CREATED', 'RUNNING', 'PAUSED');--> statement-breakpoint
CREATE INDEX "paper_strategy_instances_user_created_idx" ON "paper_strategy_instances" USING btree ("user_id","created_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "paper_strategy_instances_live_idx" ON "paper_strategy_instances" USING btree ("symbol_id","timeframe") WHERE "paper_strategy_instances"."status" IN ('CREATED', 'RUNNING');--> statement-breakpoint
CREATE UNIQUE INDEX "paper_signals_instance_candle_uq" ON "paper_signals" USING btree ("strategy_instance_id","candle_open_time");--> statement-breakpoint
CREATE INDEX "paper_signals_pending_idx" ON "paper_signals" USING btree ("created_at") WHERE "paper_signals"."status" = 'GENERATED';--> statement-breakpoint
ALTER TABLE "paper_orders" ADD CONSTRAINT "paper_orders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "paper_orders_account_idempotency_uq" ON "paper_orders" USING btree ("paper_account_id","idempotency_key") WHERE "paper_orders"."idempotency_key" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "paper_orders_user_created_idx" ON "paper_orders" USING btree ("user_id","created_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "paper_orders_symbol_open_idx" ON "paper_orders" USING btree ("symbol_id") WHERE "paper_orders"."status" IN ('PENDING', 'OPEN', 'PARTIALLY_FILLED');--> statement-breakpoint
CREATE UNIQUE INDEX "paper_positions_one_open_uq" ON "paper_positions" USING btree ("paper_account_id","symbol_id") WHERE "paper_positions"."status" = 'OPEN';--> statement-breakpoint
CREATE INDEX "paper_positions_symbol_open_idx" ON "paper_positions" USING btree ("symbol_id") WHERE "paper_positions"."status" = 'OPEN';--> statement-breakpoint
CREATE UNIQUE INDEX "paper_transactions_account_entry_key_uq" ON "paper_transactions" USING btree ("paper_account_id","entry_key");--> statement-breakpoint
CREATE UNIQUE INDEX "background_jobs_active_dedupe_uq" ON "background_jobs" USING btree ("job_type","dedupe_key") WHERE "background_jobs"."dedupe_key" IS NOT NULL AND "background_jobs"."status" IN ('PENDING', 'RUNNING');--> statement-breakpoint
ALTER TABLE "paper_accounts" ADD CONSTRAINT "paper_accounts_reserved_chk" CHECK ("paper_accounts"."reserved_balance" >= 0 AND "paper_accounts"."total_fees" >= 0);--> statement-breakpoint
ALTER TABLE "paper_accounts" ADD CONSTRAINT "paper_accounts_status_chk" CHECK ("paper_accounts"."status" IN ('ACTIVE', 'PAUSED', 'CLOSED', 'ARCHIVED'));--> statement-breakpoint
ALTER TABLE "paper_orders" ADD CONSTRAINT "paper_orders_reserved_chk" CHECK ("paper_orders"."reserved_amount" >= 0 AND "paper_orders"."commission" >= 0);--> statement-breakpoint
ALTER TABLE "paper_positions" ADD CONSTRAINT "paper_positions_status_chk" CHECK ("paper_positions"."status" IN ('OPEN', 'CLOSED'));--> statement-breakpoint
ALTER TABLE "paper_positions" ADD CONSTRAINT "paper_positions_quantity_chk" CHECK (("paper_positions"."status" = 'OPEN' AND "paper_positions"."quantity" > 0) OR ("paper_positions"."status" = 'CLOSED' AND "paper_positions"."quantity" = 0));