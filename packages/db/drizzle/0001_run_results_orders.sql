ALTER TABLE "backtest_runs" ADD COLUMN "error" text;--> statement-breakpoint
ALTER TABLE "run_results" ADD COLUMN "orders" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "run_results" ADD COLUMN "filled_notional" bigint NOT NULL;--> statement-breakpoint
ALTER TABLE "run_results" ADD COLUMN "final_position" bigint NOT NULL;