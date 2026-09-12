import type { Sink } from './sink.ts'

export interface CoverageOptions {
  /** Microseconds without a slot after which a channel is dead. */
  livenessTimeoutUs: bigint
}

/**
 * Coverage tracking for one market (FR-006, FR-014). A segment stays open while
 * at least one real channel is alive — liveness is measured by slots, not by
 * book updates: a quiet market is not a gap, a dead channel is.
 * a segment's `to_ts` is the last moment a channel was known alive, not "now":
 * if the process dies between ticks, the segment's tail is not invented.
 */
export class CoverageTracker {
  private readonly sink: Sink
  private readonly marketId: number
  private readonly timeoutUs: bigint
  private readonly lastSlotAt = new Map<number, bigint>()
  private openFromUs: bigint | null = null
  private count = 0
  private persistedToUs: bigint | null = null

  constructor(sink: Sink, marketId: number, opts: CoverageOptions) {
    this.sink = sink
    this.marketId = marketId
    this.timeoutUs = opts.livenessTimeoutUs
  }

  get isOpen(): boolean {
    return this.openFromUs !== null
  }

  /** Start of the open segment — the key of the `dataset_coverage` row the tracker extends. */
  get openFrom(): bigint | null {
    return this.openFromUs
  }

  get storedCount(): number {
    return this.count
  }

  /**
   * The cleanup (T054) moved the start of the open segment: from here on we extend the new
   * row. `persistedToUs` is reset so the next tick writes `to_ts` immediately.
   */
  rebase(fromUs: bigint, count: number): void {
    if (this.openFromUs === null) return
    this.openFromUs = fromUs
    this.count = count
    this.persistedToUs = null
  }

  /** A slot from a channel proves the channel is alive at that moment. */
  async pathAlive(pathId: number, atUs: bigint): Promise<void> {
    this.lastSlotAt.set(pathId, atUs)
    if (this.openFromUs === null) {
      this.openFromUs = atUs
      this.count = 0
      this.persistedToUs = null
      await this.sink.openCoverage(this.marketId, atUs)
    }
  }

  /** A book event has been stored. */
  stored(): void {
    this.count += 1
  }

  private lastAliveUs(): bigint | null {
    let max: bigint | null = null
    for (const t of this.lastSlotAt.values()) if (max === null || t > max) max = t
    return max
  }

  /**
   * Periodic check: if every channel has been silent longer than the threshold — close
   * the segment at the last live moment; otherwise extend it up to that moment.
   */
  async tick(nowUs: bigint): Promise<void> {
    if (this.openFromUs === null) return
    const last = this.lastAliveUs()
    if (last === null) return
    const dead = nowUs - last > this.timeoutUs
    if (last !== this.persistedToUs) {
      await this.sink.extendCoverage(this.marketId, this.openFromUs, last, this.count)
      this.persistedToUs = last
    }
    if (dead) {
      this.openFromUs = null
      this.lastSlotAt.clear()
    }
  }

  /** Process shutdown: the segment closes at the last live moment. */
  async close(): Promise<void> {
    if (this.openFromUs === null) return
    const last = this.lastAliveUs()
    if (last !== null && last !== this.persistedToUs) {
      await this.sink.extendCoverage(this.marketId, this.openFromUs, last, this.count)
    }
    this.openFromUs = null
    this.lastSlotAt.clear()
  }
}
