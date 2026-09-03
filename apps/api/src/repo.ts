import type { LevelResult } from '@quantedge/engine'

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

export interface NewRun {
  readonly sessionKey: string
  readonly marketId: number
  readonly fromMs: number
  readonly toMs: number
  readonly preset: string
  readonly params: Readonly<Record<string, number>>
  readonly levelsMs: readonly number[]
}

export interface Repo {
  listMarkets(): Promise<MarketRow[]>
  getMarket(id: number): Promise<MarketRow | null>
  coverage(marketId: number): Promise<CoverageRow[]>
  /** Events in `[fromMs, toMs]` in time order; read once per run. */
  bookUpdates(marketId: number, fromMs: number, toMs: number): Promise<BookRow[]>

  touchSession(key: string): Promise<void>
  createRun(run: NewRun): Promise<RunRow>
  getRun(id: string): Promise<RunRow | null>
  finishRun(id: string, results: readonly LevelResult[]): Promise<void>
  failRun(id: string, error: string): Promise<void>
  results(runId: string): Promise<LevelResult[]>
}
