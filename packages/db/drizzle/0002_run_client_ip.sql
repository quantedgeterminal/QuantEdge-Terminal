ALTER TABLE "backtest_runs" ADD COLUMN "client_ip" text;--> statement-breakpoint
CREATE INDEX "backtest_runs_ip_idx" ON "backtest_runs" USING btree ("client_ip","created_at");