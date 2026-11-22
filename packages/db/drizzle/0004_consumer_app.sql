CREATE TABLE "app_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"level" text NOT NULL,
	"event" text NOT NULL,
	"message" text NOT NULL,
	"context" text,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_nonces" (
	"nonce" text PRIMARY KEY NOT NULL,
	"address" text,
	"issued_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "auth_sessions" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"address" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "issued_quotes" (
	"id" text PRIMARY KEY NOT NULL,
	"trader" text NOT NULL,
	"asset_symbol" text NOT NULL,
	"quote_json" text NOT NULL,
	"observation_json" text NOT NULL,
	"freshness_json" text NOT NULL,
	"bounds_json" text NOT NULL,
	"market_session" text NOT NULL,
	"max_slippage_bps" integer NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trade_intents" (
	"id" text PRIMARY KEY NOT NULL,
	"quote_id" text NOT NULL,
	"trader" text NOT NULL,
	"asset_symbol" text NOT NULL,
	"side" text NOT NULL,
	"amount_in" numeric(78, 0) NOT NULL,
	"min_amount_out" numeric(78, 0) NOT NULL,
	"deadline" numeric(78, 0) NOT NULL,
	"calldata" text NOT NULL,
	"intent_hash" text NOT NULL,
	"tx_hash" text,
	"status" text DEFAULT 'prepared' NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "app_events_event_idx" ON "app_events" USING btree ("event","created_at");--> statement-breakpoint
CREATE INDEX "issued_quotes_trader_idx" ON "issued_quotes" USING btree ("trader","issued_at");--> statement-breakpoint
CREATE INDEX "trade_intents_trader_idx" ON "trade_intents" USING btree ("trader","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "trade_intents_quote_unique" ON "trade_intents" USING btree ("quote_id");