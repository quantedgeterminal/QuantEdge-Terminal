import type { Level, Snapshot } from '@quantedge/engine'
import { describe, expect, it } from 'vitest'
import { grain } from '../src/grain.ts'
import { engineMs, type MarketData, parseUs } from '../src/load.ts'
import { staleQuoteSignal } from '../src/stale-quote.ts'
import { GRID } from '../src/study.ts'
import { cut, HOUR_US, WINDOW_SETS, windows } from '../src/windows.ts'

const P = 10n ** 18n

function book(bid: bigint, ask: bigint, t = 0): Snapshot {
  const lv = (price: bigint): Level[] => [{ price, size: 1_000_000n }]
  return { t, bids: lv(bid * P), asks: lv(ask * P) }
}

/** States `gapUs` apart, one per slot, starting at `startUs`. */
function market(count: number, gapUs: bigint, startUs = 0n): MarketData {
  const states = Array.from({ length: count }, (_, i) => ({
    id: BigInt(i),
    slot: BigInt(i),
    us: startUs + BigInt(i) * gapUs,
  }))
  return {
    market: { id: 1, base: 'X', quote: 'USDC', baseDecimals: 6, quoteDecimals: 6 },
    states,
    snapshots: states.map((s) => ({ ...book(100n, 101n), t: engineMs(s.us) })),
  }
}

describe('dataset time', () => {
  it('keeps microseconds exact', () => {
    expect(parseUs('2026-09-11T17:31:00.800740Z')).toBe(1_789_147_860_800_740n)
  })

  it('truncates to the engine millisecond the way the API does', () => {
    expect(engineMs(1_789_147_860_800_740n)).toBe(1_789_147_860_800)
  })

  it('refuses a time without six fractional digits', () => {
    expect(() => parseUs('2026-09-11T17:31:00.800Z')).toThrow(RangeError)
  })
})

describe('windows', () => {
  it('lays set B back to back and set A an hour apart', () => {
    const [a, b] = WINDOW_SETS
    if (!a || !b) throw new Error('two window sets expected')
    const wb = windows(b, 0n, 16n * HOUR_US)
    expect(wb).toHaveLength(10)
    expect(wb[1]?.fromUs).toBe(wb[0]?.toUs)
    const wa = windows(a, 0n, 16n * HOUR_US)
    expect(wa[1]?.fromUs).toBe(HOUR_US)
    expect(wa[9]?.toUs).toBe(15n * HOUR_US)
  })

  it('refuses a set that runs past the reference', () => {
    const [a] = WINDOW_SETS
    if (!a) throw new Error('window set expected')
    expect(() => windows(a, 0n, 14n * HOUR_US)).toThrow(/past the reference/)
  })

  it('cuts on microseconds, half-open', () => {
    // Two states inside the same engine millisecond, on either side of the boundary.
    const m = market(3, 400n, 999_600n)
    const got = cut(m, { fromUs: 1_000_000n, toUs: 1_000_400n })
    expect(got).toHaveLength(1)
    expect(got[0]).toBe(m.snapshots[1])
  })
})

describe('grain', () => {
  it('shows every level below the state gap seeing the previous state, and no finer', () => {
    const g = grain(market(100, 1_500_000n), GRID)
    expect(g.medianGapMs).toBe(1500)
    expect(g.statesPerSlot).toBe(1)
    expect(g.shiftedFromZeroPct).toEqual([0, 100, 100, 100, 100])
    // 50, 100, 200 and 400 ms all land on the previous state: nothing between them to tell apart.
    expect(g.shiftedFromFasterPct).toEqual([null, 100, 0, 0, 0])
  })
})

describe('stale-quote control', () => {
  it('takes an ask that has come down to the old mid, and only once per state', () => {
    const s = staleQuoteSignal(0)
    const first = s.signal(book(100n, 102n), s.init(), {
      now: 0,
      position: 0n,
      market: { lot: 1n },
    })
    expect(first.side).toBeNull()
    const stale = book(99n, 101n)
    const hit = s.signal(stale, first.state, { now: 1, position: 0n, market: { lot: 1n } })
    expect(hit.side).toBe('buy')
    const again = s.signal(stale, hit.state, { now: 2, position: 0n, market: { lot: 1n } })
    expect(again.side).toBeNull()
  })

  it('sells a bid that has come up to the old mid', () => {
    const s = staleQuoteSignal(0)
    const ctx = { now: 0, position: 0n, market: { lot: 1n } }
    const first = s.signal(book(100n, 102n), s.init(), ctx)
    expect(s.signal(book(101n, 103n), first.state, ctx).side).toBe('sell')
  })

  it('waits for the edge', () => {
    const s = staleQuoteSignal(100) // 1 %
    const ctx = { now: 0, position: 0n, market: { lot: 1n } }
    const first = s.signal(book(100n, 102n), s.init(), ctx)
    expect(s.signal(book(99n, 101n), first.state, ctx).side).toBeNull()
    expect(s.signal(book(98n, 99n), first.state, ctx).side).toBe('buy')
  })
})
