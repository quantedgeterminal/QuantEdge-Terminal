import { describe, expect, it } from 'vitest'
import { CoverageTracker } from '../src/coverage.ts'
import { type KeepPolicy, keptPieces, Retention } from '../src/retention.ts'
import type { CoverageRow, RetentionSink } from '../src/sink.ts'

const H = 3_600_000_000n
const silent = { info: () => {} }

/** In-memory retention sink: events are `first_seen` stamps, coverage is rows, as in Postgres. */
class MemoryRetentionSink implements RetentionSink {
  events: bigint[]
  coverage: { fromUs: bigint; toUs: bigint; count: number }[]
  constructor(events: bigint[], coverage: { fromUs: bigint; toUs: bigint; count: number }[]) {
    this.events = events
    this.coverage = coverage
  }
  async deleteBookUpdatesBefore(_m: number, keep: KeepPolicy, batch: number): Promise<number> {
    const f = keep.frozen
    const victim = (t: bigint) => t < keep.cutoffUs && !(f !== null && t >= f.fromUs && t <= f.toUs)
    const gone = this.events.filter(victim).slice(0, batch)
    this.events = this.events.filter((t) => !gone.includes(t))
    return gone.length
  }
  async listCoverage(): Promise<CoverageRow[]> {
    return [...this.coverage].sort((a, b) => (a.fromUs < b.fromUs ? -1 : 1))
  }
  async countBookUpdates(_m: number, fromUs: bigint, toUs: bigint): Promise<number> {
    return this.events.filter((t) => t >= fromUs && t <= toUs).length
  }
  async replaceCoverage(_m: number, fromUs: bigint, pieces: readonly CoverageRow[]): Promise<void> {
    this.coverage = this.coverage.filter((c) => c.fromUs !== fromUs)
    this.coverage.push(...pieces.map((p) => ({ ...p })))
  }
}

describe('keptPieces', () => {
  it('without a frozen interval the segment shrinks to cutoff', () => {
    expect(keptPieces({ fromUs: 0n, toUs: 10n * H }, { cutoffUs: 4n * H, frozen: null })).toEqual([
      { fromUs: 4n * H, toUs: 10n * H },
    ])
  })
  it('a segment entirely before cutoff disappears', () => {
    expect(keptPieces({ fromUs: 0n, toUs: 3n * H }, { cutoffUs: 4n * H, frozen: null })).toEqual([])
  })
  it('frozen in the middle — the segment splits into the reference and the live tail', () => {
    const frozen = { fromUs: 1n * H, toUs: 5n * H }
    expect(keptPieces({ fromUs: 0n, toUs: 30n * H }, { cutoffUs: 20n * H, frozen })).toEqual([
      { fromUs: 1n * H, toUs: 5n * H },
      { fromUs: 20n * H, toUs: 30n * H },
    ])
  })
  it('a frozen interval touching cutoff creates no empty gap', () => {
    const frozen = { fromUs: 1n * H, toUs: 25n * H }
    expect(keptPieces({ fromUs: 0n, toUs: 30n * H }, { cutoffUs: 20n * H, frozen })).toEqual([
      { fromUs: 1n * H, toUs: 30n * H },
    ])
  })
  it('a segment that only partly enters the frozen interval is cut along it', () => {
    const frozen = { fromUs: 1n * H, toUs: 5n * H }
    expect(keptPieces({ fromUs: 3n * H, toUs: 8n * H }, { cutoffUs: 20n * H, frozen })).toEqual([
      { fromUs: 3n * H, toUs: 5n * H },
    ])
  })
})

describe('Retention', () => {
  const events = (from: bigint, to: bigint, stepH = 1n) => {
    const out: bigint[] = []
    for (let t = from; t <= to; t += stepH * H) out.push(t)
    return out
  }

  it('deletes events outside the window in batches and shrinks coverage honestly', async () => {
    const sink = new MemoryRetentionSink(events(0n, 30n * H), [
      { fromUs: 0n, toUs: 30n * H, count: 31 },
    ])
    const r = new Retention(sink, { retentionUs: 24n * H, frozen: null, batch: 2 }, silent)
    const report = await r.run(1, 30n * H)
    expect(report).toEqual({
      marketId: 1,
      cutoffUs: 6n * H,
      deletedUpdates: 6,
      replacedSegments: 1,
    })
    expect(sink.events[0]).toBe(6n * H)
    expect(sink.coverage).toEqual([{ fromUs: 6n * H, toUs: 30n * H, count: 25 }])
  })

  it('the frozen interval stays with its events; the coverage segment splits', async () => {
    const frozen = { fromUs: 2n * H, toUs: 5n * H }
    const sink = new MemoryRetentionSink(events(0n, 40n * H), [
      { fromUs: 0n, toUs: 40n * H, count: 41 },
    ])
    const r = new Retention(sink, { retentionUs: 24n * H, frozen, batch: 100 }, silent)
    await r.run(1, 40n * H)
    expect(sink.events.filter((t) => t < 16n * H)).toEqual([2n * H, 3n * H, 4n * H, 5n * H])
    expect(sink.coverage).toEqual([
      { fromUs: 2n * H, toUs: 5n * H, count: 4 },
      { fromUs: 16n * H, toUs: 40n * H, count: 25 },
    ])
  })

  it('segments entirely before cutoff disappear, an already-correct one is untouched', async () => {
    const sink = new MemoryRetentionSink(events(10n * H, 12n * H), [
      { fromUs: 0n, toUs: 1n * H, count: 2 },
      { fromUs: 10n * H, toUs: 12n * H, count: 3 },
    ])
    const r = new Retention(sink, { retentionUs: 24n * H, frozen: null, batch: 100 }, silent)
    const report = await r.run(1, 30n * H)
    expect(report.replacedSegments).toBe(1)
    expect(sink.coverage).toEqual([{ fromUs: 10n * H, toUs: 12n * H, count: 3 }])
  })

  it('the recount fixes a closed segment counter', async () => {
    const sink = new MemoryRetentionSink(events(10n * H, 12n * H), [
      { fromUs: 10n * H, toUs: 12n * H, count: 6 }, // arrivals were counted, not states
    ])
    const r = new Retention(sink, { retentionUs: 24n * H, frozen: null, batch: 100 }, silent)
    await r.run(1, 30n * H)
    expect(sink.coverage).toEqual([{ fromUs: 10n * H, toUs: 12n * H, count: 3 }])
  })

  it('open segment: the tracker moves to the new start and does not lose events that arrived during the cleanup', async () => {
    const sink = new MemoryRetentionSink(events(0n, 30n * H), [
      { fromUs: 0n, toUs: 30n * H, count: 31 },
    ])
    const extended: { fromUs: bigint; toUs: bigint; count: number }[] = []
    const tracker = new CoverageTracker(
      {
        upsertBookUpdate: async () => ({ id: 0n, inserted: true }),
        insertArrival: async () => {},
        openCoverage: async () => {},
        extendCoverage: async (_m, fromUs, toUs, count) => {
          extended.push({ fromUs, toUs, count })
        },
      },
      1,
      { livenessTimeoutUs: 5n * H },
    )
    await tracker.pathAlive(10, 0n)
    for (let i = 0; i < 31; i++) tracker.stored()
    // One more event arrives during the count.
    let counted = false
    const original = sink.countBookUpdates.bind(sink)
    sink.countBookUpdates = async (m, f, t) => {
      const n = await original(m, f, t)
      if (!counted) {
        counted = true
        tracker.stored()
      }
      return n
    }
    const r = new Retention(sink, { retentionUs: 24n * H, frozen: null, batch: 100 }, silent)
    await r.run(1, 30n * H, tracker)
    expect(tracker.openFrom).toBe(6n * H)
    expect(sink.coverage).toEqual([{ fromUs: 6n * H, toUs: 30n * H, count: 26 }])
    // The next tick extends the new row.
    await tracker.pathAlive(10, 31n * H)
    await tracker.tick(31n * H)
    expect(extended.at(-1)).toEqual({ fromUs: 6n * H, toUs: 31n * H, count: 26 })
  })

  it('an open segment with the right geometry is not replaced, even if the DB counter lags', async () => {
    const sink = new MemoryRetentionSink(events(10n * H, 12n * H), [
      { fromUs: 10n * H, toUs: 12n * H, count: 0 },
    ])
    const tracker = new CoverageTracker(
      {
        upsertBookUpdate: async () => ({ id: 0n, inserted: true }),
        insertArrival: async () => {},
        openCoverage: async () => {},
        extendCoverage: async () => {},
      },
      1,
      { livenessTimeoutUs: 5n * H },
    )
    await tracker.pathAlive(10, 10n * H)
    const r = new Retention(sink, { retentionUs: 24n * H, frozen: null, batch: 100 }, silent)
    const report = await r.run(1, 30n * H, tracker)
    expect(report.replacedSegments).toBe(0)
    expect(tracker.openFrom).toBe(10n * H)
  })
})
