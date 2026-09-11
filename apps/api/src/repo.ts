import type { LevelResult } from '@quantedge/engine'
import type { ArrivalRow, PathRow } from '@quantedge/shared'

/**
 * Boundary between routes and storage. Routes know only this interface: in tests
 * it is implemented in memory, in production it is Drizzle over Postgres (`repo-drizzle.ts`).
 */

export interface MarketRow {
  readonly id: number
  readonly venue: string
  readonly address: string
  readonly label: string
  readonly baseDecimals: number
  readonly quoteDecimals: number
  readonly active: boolean
}

/** Gap-free coverage segment (FR-006). Bounds are epoch ms. */
export interface CoverageRow {
  readonly fromMs: number
  readonly toMs: number
  readonly updateCount: number
}

/** A book event as the storage returns it: time and the packed level slice. */
export interface BookRow {
  readonly tMs: number
  readonly levels: Uint8Array
}

export type RunStatus = 'queued' | 'running' | 'done' | 'failed'

export interface RunRow {
  readonly id: string
  readonly sessionKey: string
  readonly marketId: number
  readonly fromMs: number
  readonly toMs: number
  readonly preset: string
  readonly params: Readonly<Record<string, number>>
  readonly levelsMs: readonly number[]
  readonly status: RunStatus
  readonly error: string | null
  readonly createdAtMs: number
  readonly finishedAtMs: number | null
}

/** What the quota needs (FR-023): how many runs are in the window and when the oldest was. */
export interface RunTally {
  readonly count: number
  readonly oldestMs: number | null
}

export interface NewRun {
  readonly sessionKey: string
  /** Client IP for the quota; `null` if unknown. */
  readonly clientIp: string | null
  readonly marketId: number
  readonly fromMs: number
  readonly toMs: number
  readonly preset: string
  readonly params: Readonly<Record<string, number>>
  readonly levelsMs: readonly number[]
}

/** Saved strategy configuration (FR-017), bound to a session key (FR-022a). */
export interface StrategyRow {
  readonly id: string
  readonly sessionKey: string
  readonly name: string
  readonly preset: string
  /** Full parameters: defaults already merged, same as in a run. */
  readonly params: Readonly<Record<string, number>>
  readonly createdAtMs: number
}

export interface NewStrategy {
  readonly sessionKey: string
  readonly name: string
  readonly preset: string
  readonly params: Readonly<Record<string, number>>
}

export interface Repo {
  listMarkets(): Promise<MarketRow[]>
  getMarket(id: number): Promise<MarketRow | null>
  coverage(marketId: number): Promise<CoverageRow[]>
  /** Events in `[fromMs, toMs]` in time order; read once per run. */
  bookUpdates(marketId: number, fromMs: number, toMs: number): Promise<BookRow[]>
  /** Latest book event of a market with `tMs ≤ notAfterMs` — for the live stream, including one shifted by emulation. */
  latestBook(marketId: number, notAfterMs: number): Promise<BookRow | null>
  /** All delivery channels from the table — with `kind`, because channel data never goes out without it. */
  paths(): Promise<PathRow[]>
  /** Arrivals of the market's events registered after `sinceMs` (by `first_seen_at`). */
  arrivalsSince(marketId: number, sinceMs: number): Promise<ArrivalRow[]>

  touchSession(key: string): Promise<void>
  /** Runs of a session created after `sinceMs` (quota, FR-023). */
  runsBySession(sessionKey: string, sinceMs: number): Promise<RunTally>
  /** Runs from an IP created after `sinceMs`. */
  runsByIp(clientIp: string, sinceMs: number): Promise<RunTally>
  createRun(run: NewRun): Promise<RunRow>
  getRun(id: string): Promise<RunRow | null>
  finishRun(id: string, results: readonly LevelResult[]): Promise<void>
  failRun(id: string, error: string): Promise<void>
  results(runId: string): Promise<LevelResult[]>

  /** Strategies of one session, newest first. Other sessions are invisible here. */
  listStrategies(sessionKey: string): Promise<StrategyRow[]>
  createStrategy(s: NewStrategy): Promise<StrategyRow>
  /** `false` if the strategy does not exist or belongs to another session. */
  deleteStrategy(id: string, sessionKey: string): Promise<boolean>
}
