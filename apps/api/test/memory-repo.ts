import type { LevelResult } from '@quantedge/engine'
import type { BookRow, CoverageRow, MarketRow, NewRun, Repo, RunRow } from '../src/repo.ts'

/** In-memory `Repo` for route tests: the same behaviour, no Postgres. */
export class MemoryRepo implements Repo {
  readonly markets: MarketRow[] = []
  readonly coverageRows = new Map<number, CoverageRow[]>()
  readonly books = new Map<number, BookRow[]>()
  readonly sessions = new Set<string>()
  readonly runs = new Map<string, RunRow>()
  readonly resultRows = new Map<string, LevelResult[]>()
  private nextRun = 1
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
  async touchSession(key: string) {
    this.sessions.add(key)
  }
  async createRun(run: NewRun) {
    const id = `00000000-0000-4000-8000-${String(this.nextRun++).padStart(12, '0')}`
    const row: RunRow = {
      ...run,
      id,
      status: 'running',
      error: null,
      createdAtMs: 1_700_000_000_000,
      finishedAtMs: null,
    }
    this.runs.set(id, row)
    return row
  }
  async getRun(id: string) {
    return this.runs.get(id) ?? null
  }
  async finishRun(id: string, results: readonly LevelResult[]) {
    const run = this.runs.get(id)
    if (!run) throw new Error('no such run')
    this.resultRows.set(id, [...results])
    this.runs.set(id, { ...run, status: 'done', finishedAtMs: 1_700_000_001_000 })
  }
  async failRun(id: string, error: string) {
    const run = this.runs.get(id)
    if (!run) throw new Error('no such run')
    this.runs.set(id, { ...run, status: 'failed', error, finishedAtMs: 1_700_000_001_000 })
  }
  async results(runId: string) {
    return [...(this.resultRows.get(runId) ?? [])]
  }
}
