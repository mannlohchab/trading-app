ALTER TABLE "paper_accounts" ADD COLUMN "ledger_sequence" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "paper_positions" ADD COLUMN "collateral" numeric(30, 12) DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "paper_transactions" ADD COLUMN "sequence" integer NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "paper_transactions_account_sequence_uq" ON "paper_transactions" USING btree ("paper_account_id","sequence");