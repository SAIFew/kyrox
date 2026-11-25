CREATE TABLE "admin_audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"admin_wallet" text NOT NULL,
	"action" text NOT NULL,
	"target" text,
	"before_json" text,
	"after_json" text,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admin_roles" (
	"wallet" text PRIMARY KEY NOT NULL,
	"role" text NOT NULL,
	"added_by" text,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_users" (
	"id" serial PRIMARY KEY NOT NULL,
	"address" text NOT NULL,
	"email" text,
	"referral_code" text NOT NULL,
	"referred_by" text,
	"signup_source" text,
	"signup_ip_hash" text,
	"status" text DEFAULT 'active' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone NOT NULL,
	"last_active_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feedback_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"address" text,
	"topic" text NOT NULL,
	"message" text NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "indexed_claims" (
	"id" serial PRIMARY KEY NOT NULL,
	"chain_id" integer NOT NULL,
	"tx_hash" text NOT NULL,
	"log_index" integer NOT NULL,
	"block_number" numeric(78, 0) NOT NULL,
	"block_hash" text NOT NULL,
	"block_time" timestamp with time zone NOT NULL,
	"user_address" text NOT NULL,
	"amount" numeric(78, 0) NOT NULL,
	"kind" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "indexed_trades" (
	"id" serial PRIMARY KEY NOT NULL,
	"chain_id" integer NOT NULL,
	"tx_hash" text NOT NULL,
	"log_index" integer NOT NULL,
	"block_number" numeric(78, 0) NOT NULL,
	"block_hash" text NOT NULL,
	"block_time" timestamp with time zone NOT NULL,
	"user_address" text NOT NULL,
	"stock_token" text NOT NULL,
	"asset_symbol" text NOT NULL,
	"side" text NOT NULL,
	"usdc_amount" numeric(78, 0) NOT NULL,
	"stock_amount" numeric(78, 0) NOT NULL,
	"price_usdc_per_whole_token" numeric(78, 0) NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "indexer_checkpoints" (
	"stream" text PRIMARY KEY NOT NULL,
	"chain_id" integer NOT NULL,
	"block_number" numeric(78, 0) NOT NULL,
	"block_hash" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "points_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"quest" text NOT NULL,
	"points" integer NOT NULL,
	"source_key" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "policy_config" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"updated_by" text,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "referrals" (
	"id" serial PRIMARY KEY NOT NULL,
	"referrer_user_id" integer NOT NULL,
	"referee_user_id" integer NOT NULL,
	"code" text NOT NULL,
	"qualified_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"address" text,
	"name" text NOT NULL,
	"props" text,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "feedback_entries" ADD CONSTRAINT "feedback_entries_user_id_app_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "points_entries" ADD CONSTRAINT "points_entries_user_id_app_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referrer_user_id_app_users_id_fk" FOREIGN KEY ("referrer_user_id") REFERENCES "public"."app_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referee_user_id_app_users_id_fk" FOREIGN KEY ("referee_user_id") REFERENCES "public"."app_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_events" ADD CONSTRAINT "user_events_user_id_app_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "admin_audit_wallet_idx" ON "admin_audit_log" USING btree ("admin_wallet","created_at");--> statement-breakpoint
CREATE INDEX "admin_audit_action_idx" ON "admin_audit_log" USING btree ("action","created_at");--> statement-breakpoint
CREATE INDEX "admin_roles_role_idx" ON "admin_roles" USING btree ("role");--> statement-breakpoint
CREATE UNIQUE INDEX "app_users_address_unique" ON "app_users" USING btree ("address");--> statement-breakpoint
CREATE UNIQUE INDEX "app_users_referral_unique" ON "app_users" USING btree ("referral_code");--> statement-breakpoint
CREATE INDEX "app_users_referred_idx" ON "app_users" USING btree ("referred_by");--> statement-breakpoint
CREATE INDEX "app_users_created_idx" ON "app_users" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "feedback_status_idx" ON "feedback_entries" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "indexed_claims_log_unique" ON "indexed_claims" USING btree ("chain_id","tx_hash","log_index");--> statement-breakpoint
CREATE INDEX "indexed_claims_user_idx" ON "indexed_claims" USING btree ("user_address","block_time");--> statement-breakpoint
CREATE INDEX "indexed_claims_block_idx" ON "indexed_claims" USING btree ("chain_id","block_number");--> statement-breakpoint
CREATE UNIQUE INDEX "indexed_trades_log_unique" ON "indexed_trades" USING btree ("chain_id","tx_hash","log_index");--> statement-breakpoint
CREATE INDEX "indexed_trades_user_idx" ON "indexed_trades" USING btree ("user_address","block_time");--> statement-breakpoint
CREATE INDEX "indexed_trades_asset_idx" ON "indexed_trades" USING btree ("asset_symbol","block_time");--> statement-breakpoint
CREATE INDEX "indexed_trades_block_idx" ON "indexed_trades" USING btree ("chain_id","block_number");--> statement-breakpoint
CREATE UNIQUE INDEX "points_entries_unique" ON "points_entries" USING btree ("user_id","quest","source_key");--> statement-breakpoint
CREATE INDEX "points_entries_user_idx" ON "points_entries" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "points_entries_created_idx" ON "points_entries" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "referrals_referee_unique" ON "referrals" USING btree ("referee_user_id");--> statement-breakpoint
CREATE INDEX "referrals_referrer_idx" ON "referrals" USING btree ("referrer_user_id");--> statement-breakpoint
CREATE INDEX "user_events_name_idx" ON "user_events" USING btree ("name","created_at");--> statement-breakpoint
CREATE INDEX "user_events_user_idx" ON "user_events" USING btree ("user_id","created_at");