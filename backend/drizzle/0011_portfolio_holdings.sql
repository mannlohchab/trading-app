CREATE TABLE "portfolio_holdings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"asset" varchar(30) NOT NULL,
	"quantity" numeric(30, 12) NOT NULL,
	"bought_on" date NOT NULL,
	"buy_price" numeric(30, 12),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "portfolio_holdings_user_position_uq" UNIQUE("user_id","position"),
	CONSTRAINT "portfolio_holdings_quantity_chk" CHECK ("portfolio_holdings"."quantity" > 0),
	CONSTRAINT "portfolio_holdings_buy_price_chk" CHECK ("portfolio_holdings"."buy_price" IS NULL OR "portfolio_holdings"."buy_price" > 0),
	CONSTRAINT "portfolio_holdings_position_chk" CHECK ("portfolio_holdings"."position" >= 0)
);
--> statement-breakpoint
ALTER TABLE "portfolio_holdings" ADD CONSTRAINT "portfolio_holdings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE TRIGGER portfolio_holdings_set_updated_at
  BEFORE UPDATE ON portfolio_holdings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
