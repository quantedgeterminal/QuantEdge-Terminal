CREATE TYPE "public"."path_kind" AS ENUM('real', 'emulated');--> statement-breakpoint
CREATE TYPE "public"."run_status" AS ENUM('queued', 'running', 'done', 'failed');--> statement-breakpoint
CREATE TABLE "arrivals" (
	"book_update_id" bigint NOT NULL,
	"path_id" integer NOT NULL,
	"received_at" timestamp (6) with time zone NOT NULL,
	CONSTRAINT "arrivals_book_update_id_path_id_pk" PRIMARY KEY("book_update_id","path_id")
);
--> statement-breakpoint
CREATE TABLE "book_updates" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "book_updates_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"market_id" integer NOT NULL,
	"slot" bigint NOT NULL,
	"state_hash" "bytea" NOT NULL,
	"levels" "bytea" NOT NULL,
	"first_seen_at" timestamp (6) with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dataset_coverage" (
	"market_id" integer NOT NULL,
	"from_ts" timestamp (6) with time zone NOT NULL,
	"to_ts" timestamp (6) with time zone NOT NULL,
	"update_count" integer NOT NULL,
	CONSTRAINT "dataset_coverage_market_id_from_ts_pk" PRIMARY KEY("market_id","from_ts")
);
--> statement-breakpoint
CREATE TABLE "delivery_paths" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "delivery_paths_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"kind" "path_kind" NOT NULL,
	"provider" text,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "markets" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "markets_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"venue" text NOT NULL,
	"address" text NOT NULL,
	"base_mint" text NOT NULL,
	"quote_mint" text NOT NULL,
	"base_decimals" smallint NOT NULL,
	"quote_decimals" smallint NOT NULL,
	"label" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "backtest_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_key" text NOT NULL,
	"market_id" integer NOT NULL,
	"from_ts" timestamp (6) with time zone NOT NULL,
	"to_ts" timestamp (6) with time zone NOT NULL,
	"preset" text NOT NULL,
	"params" jsonb NOT NULL,
	"levels_ms" integer[] NOT NULL,
	"status" "run_status" DEFAULT 'queued' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "run_results" (
	"run_id" uuid NOT NULL,
	"latency_ms" integer NOT NULL,
	"pnl" bigint NOT NULL,
	"trades" integer NOT NULL,
	"unfilled" integer NOT NULL,
	"slippage_sum" bigint NOT NULL,
	"max_drawdown" bigint NOT NULL,
	CONSTRAINT "run_results_run_id_latency_ms_pk" PRIMARY KEY("run_id","latency_ms")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"key" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "strategies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_key" text NOT NULL,
	"preset" text NOT NULL,
	"params" jsonb NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "arrivals" ADD CONSTRAINT "arrivals_book_update_id_book_updates_id_fk" FOREIGN KEY ("book_update_id") REFERENCES "public"."book_updates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "arrivals" ADD CONSTRAINT "arrivals_path_id_delivery_paths_id_fk" FOREIGN KEY ("path_id") REFERENCES "public"."delivery_paths"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_updates" ADD CONSTRAINT "book_updates_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dataset_coverage" ADD CONSTRAINT "dataset_coverage_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backtest_runs" ADD CONSTRAINT "backtest_runs_session_key_sessions_key_fk" FOREIGN KEY ("session_key") REFERENCES "public"."sessions"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backtest_runs" ADD CONSTRAINT "backtest_runs_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_results" ADD CONSTRAINT "run_results_run_id_backtest_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."backtest_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strategies" ADD CONSTRAINT "strategies_session_key_sessions_key_fk" FOREIGN KEY ("session_key") REFERENCES "public"."sessions"("key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "book_updates_event_idx" ON "book_updates" USING btree ("market_id","slot","state_hash");--> statement-breakpoint
CREATE INDEX "book_updates_period_idx" ON "book_updates" USING btree ("market_id","first_seen_at");--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_paths_name_idx" ON "delivery_paths" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "markets_address_idx" ON "markets" USING btree ("address");--> statement-breakpoint
CREATE INDEX "backtest_runs_session_idx" ON "backtest_runs" USING btree ("session_key","created_at");--> statement-breakpoint
CREATE INDEX "strategies_session_idx" ON "strategies" USING btree ("session_key");