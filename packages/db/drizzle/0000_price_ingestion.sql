CREATE TABLE "price_ingestion_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"asset_symbol" text NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"outcome" text NOT NULL,
	"source_round_id" numeric(78, 0),
	"message" text
);
--> statement-breakpoint
CREATE TABLE "price_observations" (
	"id" serial PRIMARY KEY NOT NULL,
	"asset_symbol" text NOT NULL,
	"source_chain_id" integer NOT NULL,
	"feed_address" text NOT NULL,
	"raw_answer" numeric(78, 0) NOT NULL,
	"feed_decimals" smallint NOT NULL,
	"source_round_id" numeric(78, 0) NOT NULL,
	"source_updated_at" timestamp with time zone NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"reference_price_usdc_per_whole_token" numeric(78, 0),
	"source_description" text NOT NULL,
	"status" text NOT NULL,
	"validation_error" text
);
--> statement-breakpoint
CREATE TABLE "price_publications" (
	"id" serial PRIMARY KEY NOT NULL,
	"asset_symbol" text NOT NULL,
	"source_round_id" numeric(78, 0) NOT NULL,
	"exchange_address" text NOT NULL,
	"calldata_hash" text NOT NULL,
	"prepared_at" timestamp with time zone NOT NULL,
	"status" text NOT NULL
);
--> statement-breakpoint
CREATE INDEX "price_ingestion_events_asset_idx" ON "price_ingestion_events" USING btree ("asset_symbol","observed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "price_observations_source_round_unique" ON "price_observations" USING btree ("source_chain_id","feed_address","source_round_id");--> statement-breakpoint
CREATE INDEX "price_observations_asset_observed_idx" ON "price_observations" USING btree ("asset_symbol","observed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "price_publications_asset_round_unique" ON "price_publications" USING btree ("asset_symbol","source_round_id");