import type { CoverageTracker } from './coverage.ts'
import type { CoverageRow, RetentionSink } from './sink.ts'

/** Closed time interval in epoch µs. */
export interface Interval {
  readonly fromUs: bigint
  readonly toUs: bigint
}

/**
 * What remains after the cleanup (FR-006, T054): everything from `cutoffUs` onwards, plus
 * the frozen interval — the reference dataset on which SC-001…SC-003 were measured and
 * which must stay reproducible after the sliding window has passed it.
 */
export interface KeepPolicy {
  readonly cutoffUs: bigint
  readonly frozen: Interval | null
}

/** The "keep" set as a list of disjoint intervals; `toUs === null` — to infinity. */
function keepSet(keep: KeepPolicy): { fromUs: bigint; toUs: bigint | null }[] {
  const tail = { fromUs: keep.cutoffUs, toUs: null }
  const f = keep.frozen
  if (f === null) return [tail]
  // The frozen interval touches the tail — that is one segment, not two with an empty gap.
  if (f.toUs >= keep.cutoffUs)
    return [{ fromUs: f.fromUs < keep.cutoffUs ? f.fromUs : keep.cutoffUs, toUs: null }]
  return [f, tail]
}

/**
 * Intersection of a coverage segment with the "keep" set: up to two pieces. Coverage
 * must shrink honestly — a segment cannot claim data where it has
 * already been deleted (FR-014 names the gap between the pieces by itself).
 */
export function keptPieces(seg: Interval, keep: KeepPolicy): Interval[] {
  const out: Interval[] = []
  for (const k of keepSet(keep)) {
    const fromUs = seg.fromUs > k.fromUs ? seg.fromUs : k.fromUs
    const toUs = k.toUs === null || seg.toUs < k.toUs ? seg.toUs : k.toUs
    if (fromUs <= toUs) out.push({ fromUs, toUs })
  }
  return out
}

export interface RetentionOptions {
  readonly retentionUs: bigint
  readonly frozen: Interval | null
  /** How many `book_updates` rows to delete per statement. */
  readonly batch: number
}

export interface RetentionReport {
  readonly marketId: number
  readonly cutoffUs: bigint
  readonly deletedUpdates: number
  /** Coverage segments that had to be replaced (shortened, split or removed). */
  readonly replacedSegments: number
}

export interface RetentionLogger {
  info(obj: Record<string, unknown>, msg: string): void
}

/**
 * Hourly cleanup of one market. Lives in the collector process rather than as a separate
 * script, because the open coverage segment is driven by `CoverageTracker` in memory:
 * when the cleanup moves its start, the tracker must learn about it right here,
 * otherwise it keeps extending a row that no longer exists.
 */
export class Retention {
  private readonly sink: RetentionSink
  private readonly opts: RetentionOptions
  private readonly log: RetentionLogger

  constructor(sink: RetentionSink, opts: RetentionOptions, log: RetentionLogger) {
    this.sink = sink
    this.opts = opts
    this.log = log
  }

  async run(marketId: number, nowUs: bigint, tracker?: CoverageTracker): Promise<RetentionReport> {
    const keep: KeepPolicy = { cutoffUs: nowUs - this.opts.retentionUs, frozen: this.opts.frozen }

    let deletedUpdates = 0
    for (;;) {
      const n = await this.sink.deleteBookUpdatesBefore(marketId, keep, this.opts.batch)
      deletedUpdates += n
      if (n < this.opts.batch) break
    }

    let replacedSegments = 0
    for (const row of await this.sink.listCoverage(marketId)) {
      const open = tracker !== undefined && tracker.openFrom === row.fromUs ? tracker : undefined
      if (await this.recut(marketId, row, keep, open)) replacedSegments += 1
    }

    const report = { marketId, cutoffUs: keep.cutoffUs, deletedUpdates, replacedSegments }
    this.log.info(report, 'retention')
    return report
  }

  /** Recuts one coverage segment; `open` — the tracker, if it is currently driving this segment. */
  private async recut(
    marketId: number,
    row: CoverageRow,
    keep: KeepPolicy,
    open: CoverageTracker | undefined,
  ): Promise<boolean> {
    const storedBefore = open?.storedCount ?? 0
    const pieces: CoverageRow[] = []
    for (const p of keptPieces(row, keep)) {
      pieces.push({ ...p, count: await this.sink.countBookUpdates(marketId, p.fromUs, p.toUs) })
    }
    const only = pieces.length === 1 ? pieces[0] : undefined
    const sameShape = only !== undefined && only.fromUs === row.fromUs && only.toUs === row.toUs
    // The open segment's counter is driven by the tracker, so the DB may lag — no reason to replace the row.
    if (sameShape && (open !== undefined || only.count === row.count)) return false

    const live = open === undefined ? undefined : pieces[pieces.length - 1]
    const liveCount =
      live === undefined || open === undefined ? 0 : live.count + (open.storedCount - storedBefore) // what arrived during the count
    await this.sink.replaceCoverage(
      marketId,
      row.fromUs,
      pieces.map((p) => (p === live ? { ...p, count: liveCount } : p)),
    )
    if (live !== undefined && open !== undefined) open.rebase(live.fromUs, liveCount)
    return true
  }
}
