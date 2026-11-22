CREATE TABLE "price_publication_transitions" (
	"id" serial PRIMARY KEY NOT NULL,
	"asset_symbol" text NOT NULL,
	"source_round_id" numeric(78, 0) NOT NULL,
	"from_status" text NOT NULL,
	"to_status" text NOT NULL,
	"transaction_hash" text,
	"reason" text,
	"occurred_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "price_publications" ADD COLUMN "last_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "price_publications" ADD COLUMN "reorg_detected" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "price_publications" ADD COLUMN "invalidated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "price_publications" ADD COLUMN "artifact_hash" text;--> statement-breakpoint
ALTER TABLE "price_publications" ADD COLUMN "artifact_json" text;--> statement-breakpoint
CREATE INDEX "price_publication_transitions_lookup_idx" ON "price_publication_transitions" USING btree ("asset_symbol","source_round_id","occurred_at");