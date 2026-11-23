-- The paper-trading ledger is append-only: corrections are new, compensating entries.
-- UPDATE and DELETE are rejected unless the transaction deliberately enables a purge
-- (SET LOCAL paper.ledger_purge = 'on'), which only account/user data erasure may do.
CREATE OR REPLACE FUNCTION paper_transactions_append_only()
RETURNS TRIGGER AS $$
BEGIN
  IF current_setting('paper.ledger_purge', true) = 'on' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'paper_transactions is append-only (% rejected)', TG_OP USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER paper_transactions_append_only
  BEFORE UPDATE OR DELETE ON paper_transactions
  FOR EACH ROW EXECUTE FUNCTION paper_transactions_append_only();
--> statement-breakpoint
CREATE TRIGGER paper_strategy_instances_set_updated_at
  BEFORE UPDATE ON paper_strategy_instances
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER paper_signals_set_updated_at
  BEFORE UPDATE ON paper_signals
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
