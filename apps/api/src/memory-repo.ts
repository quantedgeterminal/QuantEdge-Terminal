import type { LevelResult } from '@quantedge/engine'
import type { ArrivalRow, PathRow } from '@quantedge/shared'
import type {
  BookRow,
  CoverageRow,
  MarketRow,
  NewRun,
  NewStrategy,
  Repo,
  RunResolution,
  RunRow,
  RunTally,
  StrategyRow,
} from './repo.ts'

/** In-memory `Repo` for route tests: the same behaviour, no Postgres. */
export class MemoryRepo implements Repo {
  readonly markets: MarketRow[] = []
  readonly coverageRows = new Map<number, CoverageRow[]>()
  readonly books = new Map<number, BookRow[]>()
  readonly pathRows: PathRow[] = []
  /** Arrivals: market → rows; `bookUpdateId` here is the event index, the event's `tMs` is kept apart. */
  readonly arrivalRows = new Map<number, (ArrivalRow & { tMs: number })[]>()
  readonly sessions = new Set<string>()
  readonly runs = new Map<string, RunRow>()
  /** IP per run — kept apart from `RunRow` because it is never sent out. */
  readonly runIps = new Map<string, string | null>()
  /** Clock for `createdAtMs`; quota tests move it. */
  nowMs = 1_700_000_000_000
  readonly resultRows = new Map<string, LevelResult[]>()
  readonly strategies = new Map<string, StrategyRow>()
  private nextRun = 1
  private nextStrategy = 1
  /** How many times events were read — a run must read its data once. */
  bookReads = 0

  async listMarkets() {
    return [...this.markets]
  }
  async getMarket(id: number) {
    return this.markets.find((m) => m.id === id) ?? null
  }
  async coverage(marketId: number) {
    return [...(this.coverageRows.get(marketId) ?? [])]
  }
  async bookUpdates(marketId: number, fromMs: number, toMs: number) {
    this.bookReads++
    return (this.books.get(marketId) ?? [])
      .filter((r) => r.tMs >= fromMs && r.tMs <= toMs)
      .sort((a, b) => a.tMs - b.tMs)
  }
  async latestBook(marketId: number, notAfterMs: number) {
    const rows = this.books.get(marketId) ?? []
    let best: BookRow | null = null
    for (const r of rows) if (r.tMs <= notAfterMs && (best === null || r.tMs > best.tMs)) best = r
    return best
  }
  async paths() {
    return [...this.pathRows]
  }
  async arrivalsSince(marketId: number, sinceMs: number) {
    return (this.arrivalRows.get(marketId) ?? [])
      .filter((r) => r.tMs >= sinceMs)
      .map(({ bookUpdateId, pathId, receivedAtUs }) => ({ bookUpdateId, pathId, receivedAtUs }))
  }
  async touchSession(key: string) {
    this.sessions.add(key)
  }
  private tally(rows: RunRow[], sinceMs: number): RunTally {
    const inWindow = rows.filter((r) => r.createdAtMs >= sinceMs)
    return {
      count: inWindow.length,
      oldestMs: inWindow.length === 0 ? null : Math.min(...inWindow.map((r) => r.createdAtMs)),
    }
  }
  async runsBySession(sessionKey: string, sinceMs: number) {
    return this.tally(
      [...this.runs.values()].filter((r) => r.sessionKey === sessionKey),
      sinceMs,
    )
  }
  async runsByIp(clientIp: string, sinceMs: number) {
    return this.tally(
      [...this.runs.values()].filter((r) => this.runIps.get(r.id) === clientIp),
      sinceMs,
    )
  }
  async createRun(run: NewRun) {
    const id = `00000000-0000-4000-8000-${String(this.nextRun++).padStart(12, '0')}`
    const { clientIp, ...rest } = run
    const row: RunRow = {
      ...rest,
      id,
      status: 'running',
      error: null,
      createdAtMs: this.nowMs,
      finishedAtMs: null,
      resolution: null,
    }
    this.runs.set(id, row)
    this.runIps.set(id, clientIp)
    return row
  }
  async getRun(id: string) {
    return this.runs.get(id) ?? null
  }
  async finishRun(id: string, results: readonly LevelResult[], resolution: RunResolution) {
    const run = this.runs.get(id)
    if (!run) throw new Error('no such run')
    this.resultRows.set(id, [...results])
    this.runs.set(id, { ...run, status: 'done', finishedAtMs: 1_700_000_001_000, resolution })
  }
  async failRun(id: string, error: string) {
    const run = this.runs.get(id)
    if (!run) throw new Error('no such run')
    this.runs.set(id, { ...run, status: 'failed', error, finishedAtMs: 1_700_000_001_000 })
  }
  async results(runId: string) {
    return [...(this.resultRows.get(runId) ?? [])]
  }
  async listStrategies(sessionKey: string) {
    return [...this.strategies.values()]
      .filter((s) => s.sessionKey === sessionKey)
      .sort((a, b) => b.createdAtMs - a.createdAtMs)
  }
  async createStrategy(s: NewStrategy) {
    const n = this.nextStrategy++
    const row: StrategyRow = {
      ...s,
      id: `00000000-0000-4000-8000-1${String(n).padStart(11, '0')}`,
      createdAtMs: 1_700_000_000_000 + n,
    }
    this.strategies.set(row.id, row)
    return row
  }
  async deleteStrategy(id: string, sessionKey: string) {
    const row = this.strategies.get(id)
    if (!row || row.sessionKey !== sessionKey) return false
    this.strategies.delete(id)
    return true
  }
}
