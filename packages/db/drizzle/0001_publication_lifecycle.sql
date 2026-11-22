ALTER TABLE "price_publications" ALTER COLUMN "status" SET DEFAULT 'prepared';--> statement-breakpoint
ALTER TABLE "price_publications" ADD COLUMN "stock_token" text;--> statement-breakpoint
ALTER TABLE "price_publications" ADD COLUMN "reference_price_usdc_per_whole_token" numeric(78, 0);--> statement-breakpoint
ALTER TABLE "price_publications" ADD COLUMN "source_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "price_publications" ADD COLUMN "source_chain_id" integer;--> statement-breakpoint
ALTER TABLE "price_publications" ADD COLUMN "feed_address" text;--> statement-breakpoint
ALTER TABLE "price_publications" ADD COLUMN "simulated" boolean;--> statement-breakpoint
ALTER TABLE "price_publications" ADD COLUMN "observed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "price_publications" ADD COLUMN "transaction_hash" text;--> statement-breakpoint
ALTER TABLE "price_publications" ADD COLUMN "block_number" numeric(78, 0);--> statement-breakpoint
ALTER TABLE "price_publications" ADD COLUMN "block_hash" text;--> statement-breakpoint
ALTER TABLE "price_publications" ADD COLUMN "confirmations" integer;--> statement-breakpoint
ALTER TABLE "price_publications" ADD COLUMN "included_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "price_publications" ADD COLUMN "verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "price_publications" ADD COLUMN "failure_reason" text;--> statement-breakpoint
CREATE UNIQUE INDEX "price_publications_transaction_unique" ON "price_publications" USING btree ("transaction_hash");