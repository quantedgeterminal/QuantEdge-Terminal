-- How the period's own resolution bounds the delay grid (FR-013a). All three columns are
-- nullable on purpose: runs finished before the measure existed keep reading, and `null` there
-- says "not measured" rather than the false "0 steps apart".
ALTER TABLE "backtest_runs" ADD COLUMN "step_count" integer;--> statement-breakpoint
ALTER TABLE "backtest_runs" ADD COLUMN "median_gap_ms" integer;--> statement-breakpoint
ALTER TABLE "run_results" ADD COLUMN "shifted_steps" integer;
