import {
  bigint,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'
import { markets } from './markets.ts'

/** Anonymous session (FR-022a): a key and two timestamps, no personal data. */
export const sessions = pgTable('sessions', {
  key: text().primaryKey(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
})

/**
 * Preset parameters as JSON. The shape at the API boundary is set by the preset's Zod schema
 * (FR-016); here it is storage only; `unknown` is more honest than an invented type.
 */
type PresetParams = Record<string, unknown>

/** Saved configuration: preset + parameters (FR-015, FR-017). */
export const strategies = pgTable(
  'strategies',
  {
    id: uuid().primaryKey().defaultRandom(),
    sessionKey: text('session_key')
      .notNull()
      .references(() => sessions.key, { onDelete: 'cascade' }),
    preset: text().notNull(),
    params: jsonb().$type<PresetParams>().notNull(),
    name: text().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('strategies_session_idx').on(t.sessionKey)],
)

export const runStatus = pgEnum('run_status', ['queued', 'running', 'done', 'failed'])

/** A run (FR-007, FR-008): one launch over a set of delay levels; immutable once finished. */
export const backtestRuns = pgTable(
  'backtest_runs',
  {
    id: uuid().primaryKey().defaultRandom(),
    sessionKey: text('session_key')
      .notNull()
      .references(() => sessions.key),
    marketId: integer('market_id')
      .notNull()
      .references(() => markets.id),
    fromTs: timestamp('from_ts', { withTimezone: true, precision: 6 }).notNull(),
    toTs: timestamp('to_ts', { withTimezone: true, precision: 6 }).notNull(),
    preset: text().notNull(),
    params: jsonb().$type<PresetParams>().notNull(),
    levelsMs: integer('levels_ms').array().notNull(),
    status: runStatus().notNull().default('queued'),
    /** Reason for `failed` — user-facing text, not a stack trace. */
    error: text(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    /** Client IP for the quota (FR-023); `null` if the adapter does not know it. Not personal data in the FR-022a sense: not linked to a person and never sent out. */
    clientIp: text('client_ip'),
    /**
     * How the period's own resolution bounds the grid (FR-013a). `step_count` is the number of
     * book states the run walked — the denominator for `run_results.shifted_steps`; `median_gap_ms`
     * is the median time between neighbouring states, the reason levels below it cannot differ.
     * Both `null` on runs finished before the measure existed: absent, not zero.
     */
    stepCount: integer('step_count'),
    medianGapMs: integer('median_gap_ms'),
  },
  (t) => [
    index('backtest_runs_session_idx').on(t.sessionKey, t.createdAt),
    index('backtest_runs_ip_idx').on(t.clientIp, t.createdAt),
  ],
)

/**
 * Result of one delay level (FR-012). Money is in the smallest units of the
 * quote currency, `bigint`. Slippage is stored as a sum, not a mean:
 * the mean is a fraction and is computed at the API boundary as `slippage_sum / trades`.
 */
export const runResults = pgTable(
  'run_results',
  {
    runId: uuid('run_id')
      .notNull()
      .references(() => backtestRuns.id, { onDelete: 'cascade' }),
    latencyMs: integer('latency_ms').notNull(),
    pnl: bigint({ mode: 'bigint' }).notNull(),
    /** All orders sent; `trades` are those filled at least partially. */
    orders: integer().notNull(),
    trades: integer().notNull(),
    unfilled: integer().notNull(),
    slippageSum: bigint('slippage_sum', { mode: 'bigint' }).notNull(),
    /** Filled turnover — the denominator for slippage in bp. */
    filledNotional: bigint('filled_notional', { mode: 'bigint' }).notNull(),
    maxDrawdown: bigint('max_drawdown', { mode: 'bigint' }).notNull(),
    /** Position at the end of the period in base atoms; P&L already includes its mark at mid. */
    finalPosition: bigint('final_position', { mode: 'bigint' }).notNull(),
    /**
     * Steps where this level saw a different state than the next-faster level of the same grid
     * (FR-013a). `0` means the data cannot separate the two levels; `null` on the fastest level of
     * the grid, which has nothing to compare with, and on runs finished before the measure existed.
     */
    shiftedSteps: integer('shifted_steps'),
  },
  (t) => [primaryKey({ columns: [t.runId, t.latencyMs] })],
)
