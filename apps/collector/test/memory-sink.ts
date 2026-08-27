import type { BookEvent, Sink } from '../src/sink.ts'

/** In-memory sink with the same upsert semantics as Postgres. */
export class MemorySink implements Sink {
  readonly updates = new Map<string, { id: bigint; event: BookEvent; firstSeenUs: bigint }>()
  readonly arrivals: { bookUpdateId: bigint; pathId: number; receivedAtUs: bigint }[] = []
  readonly coverage: { marketId: number; fromUs: bigint; toUs: bigint; count: number }[] = []
  private nextId = 1n

  private key(e: BookEvent): string {
    return `${e.marketId}:${e.slot}:${Buffer.from(e.stateHash).toString('hex')}`
  }

  async upsertBookUpdate(e: BookEvent): Promise<bigint> {
    const k = this.key(e)
    const existing = this.updates.get(k)
    if (existing) {
      if (e.receivedAtUs < existing.firstSeenUs) existing.firstSeenUs = e.receivedAtUs
      return existing.id
    }
    const id = this.nextId++
    this.updates.set(k, { id, event: e, firstSeenUs: e.receivedAtUs })
    return id
  }

  async insertArrival(bookUpdateId: bigint, pathId: number, receivedAtUs: bigint): Promise<void> {
    if (this.arrivals.some((a) => a.bookUpdateId === bookUpdateId && a.pathId === pathId)) return
    this.arrivals.push({ bookUpdateId, pathId, receivedAtUs })
  }

  async openCoverage(marketId: number, fromUs: bigint): Promise<void> {
    if (this.coverage.some((c) => c.marketId === marketId && c.fromUs === fromUs)) return
    this.coverage.push({ marketId, fromUs, toUs: fromUs, count: 0 })
  }

  async extendCoverage(
    marketId: number,
    fromUs: bigint,
    toUs: bigint,
    updateCount: number,
  ): Promise<void> {
    const row = this.coverage.find((c) => c.marketId === marketId && c.fromUs === fromUs)
    if (!row) throw new Error('extend without open')
    row.toUs = toUs
    row.count = updateCount
  }
}
