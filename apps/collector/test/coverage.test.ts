import { describe, expect, it } from 'vitest'
import { CoverageTracker } from '../src/coverage.ts'
import { MemorySink } from './memory-sink.ts'

const SEC = 1_000_000n
const opts = { livenessTimeoutUs: 5n * SEC }

describe('CoverageTracker', () => {
  it('a segment opens on the first slot and follows the last live moment, not "now"', async () => {
    const sink = new MemorySink()
    const t = new CoverageTracker(sink, 1, opts)
    await t.pathAlive(10, 100n * SEC)
    expect(sink.coverage).toEqual([{ marketId: 1, fromUs: 100n * SEC, toUs: 100n * SEC, count: 0 }])
    t.stored()
    t.stored()
    await t.pathAlive(11, 103n * SEC)
    await t.tick(104n * SEC)
    expect(sink.coverage[0]).toEqual({
      marketId: 1,
      fromUs: 100n * SEC,
      toUs: 103n * SEC,
      count: 2,
    })
  })

  it('a quiet market without slots past the threshold is a gap; a new slot opens a new segment', async () => {
    const sink = new MemorySink()
    const t = new CoverageTracker(sink, 1, opts)
    await t.pathAlive(10, 100n * SEC)
    await t.pathAlive(10, 102n * SEC)
    await t.tick(110n * SEC) // 8 s of silence > 5 s
    expect(t.isOpen).toBe(false)
    expect(sink.coverage).toEqual([{ marketId: 1, fromUs: 100n * SEC, toUs: 102n * SEC, count: 0 }])
    await t.pathAlive(10, 111n * SEC)
    expect(sink.coverage).toHaveLength(2)
    expect(sink.coverage[1]?.fromUs).toBe(111n * SEC)
  })

  it('one live channel of two keeps the segment open', async () => {
    const sink = new MemorySink()
    const t = new CoverageTracker(sink, 1, opts)
    await t.pathAlive(10, 100n * SEC)
    await t.pathAlive(11, 100n * SEC)
    // Channel 10 went silent, 11 keeps ticking.
    await t.pathAlive(11, 104n * SEC)
    await t.pathAlive(11, 108n * SEC)
    await t.tick(109n * SEC)
    expect(t.isOpen).toBe(true)
    expect(sink.coverage[0]?.toUs).toBe(108n * SEC)
  })

  it('close persists the tail and does not write the same thing twice', async () => {
    const sink = new MemorySink()
    const t = new CoverageTracker(sink, 1, opts)
    await t.pathAlive(10, 100n * SEC)
    await t.pathAlive(10, 101n * SEC)
    await t.tick(101n * SEC)
    const before = JSON.stringify(sink.coverage, (_k, v) =>
      typeof v === 'bigint' ? v.toString() : v,
    )
    await t.close()
    const after = JSON.stringify(sink.coverage, (_k, v) =>
      typeof v === 'bigint' ? v.toString() : v,
    )
    expect(after).toBe(before)
    expect(t.isOpen).toBe(false)
  })

  it('tick without an open segment does nothing', async () => {
    const sink = new MemorySink()
    const t = new CoverageTracker(sink, 1, opts)
    await t.tick(5n * SEC)
    expect(sink.coverage).toEqual([])
  })
})
