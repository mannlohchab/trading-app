CREATE TABLE "backtest_datasets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" varchar(120) NOT NULL,
	"checksum" varchar(64) NOT NULL,
	"summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "backtest_experiments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"dataset_id" uuid NOT NULL,
	"kind" varchar(30) NOT NULL,
	"status" varchar(20) DEFAULT 'PENDING' NOT NULL,
	"request" jsonb NOT NULL,
	"result" jsonb,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "backtest_snapshots" (
	"backtest_job_id" uuid PRIMARY KEY NOT NULL,
	"checksum" varchar(64) NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "backtest_datasets" ADD CONSTRAINT "backtest_datasets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backtest_experiments" ADD CONSTRAINT "backtest_experiments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backtest_experiments" ADD CONSTRAINT "backtest_experiments_dataset_id_backtest_datasets_id_fk" FOREIGN KEY ("dataset_id") REFERENCES "public"."backtest_datasets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backtest_snapshots" ADD CONSTRAINT "backtest_snapshots_backtest_job_id_backtest_jobs_id_fk" FOREIGN KEY ("backtest_job_id") REFERENCES "public"."backtest_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "backtest_datasets_user_created_idx" ON "backtest_datasets" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "backtest_experiments_user_created_idx" ON "backtest_experiments" USING btree ("user_id","created_at");
--> statement-breakpoint
CREATE FUNCTION reject_backtest_artifact_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Backtest input artifacts are immutable; create a new dataset or run';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER backtest_snapshots_immutable BEFORE UPDATE ON backtest_snapshots
FOR EACH ROW EXECUTE FUNCTION reject_backtest_artifact_update();
--> statement-breakpoint
CREATE TRIGGER backtest_datasets_immutable BEFORE UPDATE ON backtest_datasets
FOR EACH ROW EXECUTE FUNCTION reject_backtest_artifact_update();
