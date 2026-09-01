import { describe, expect, it } from 'vitest'
import { costPer100Ms } from '../src/metrics.ts'
import { defaultParams, findPreset, presets } from '../src/presets/index.ts'
import { runBacktest } from '../src/run.ts'
import type { Snapshot } from '../src/types.ts'
import { at, lvl, market, synthetic } from './synthetic.ts'

function preset(id: string) {
  const p = findPreset(id)
  if (!p) throw new Error(`no preset ${id}`)
  return p
}

describe('runBacktest — accounting by hand', () => {
  // A thin level 101×1 before 102×100: queue-depletion buys for 1000 quote atoms.
  const snapshots: Snapshot[] = [
    { t: 0, asks: [lvl(101, 1), lvl(102, 100)], bids: [lvl(99, 100), lvl(98, 100)] },
    { t: 100, asks: [lvl(103, 100)], bids: [lvl(102, 100), lvl(101, 100)] },
    { t: 200, asks: [lvl(103, 100), lvl(104, 100)], bids: [lvl(102, 100)] },
  ]
  const params = {
    ...defaultParams(preset('queue-depletion').params),
    notionalQuote: 1000,
    holdMs: 0,
  }
  const strategy = preset('queue-depletion').build(params, market)
  const results = runBacktest({ snapshots, levelsMs: [0, 100], market, strategy })
  const fast = at(results, 0)
  const slow = at(results, 1)

  it('Δ = 0: 1 @101 + 8 @102, exit 9 @102 → P&L +1, slippage 8 (inside the book)', () => {
    expect(fast).toEqual({
      latencyMs: 0,
      pnl: 1n,
      trades: 2,
      orders: 2,
      unfilled: 0,
      slippageSum: 8n,
      filledNotional: 917n + 918n,
      maxDrawdown: 17n,
      finalPosition: 0n,
    })
  })

  it('Δ = 100: saw 101, arrived at 103 → 9 @103, exit 9 @102 → P&L −9, slippage 18', () => {
    expect(slow.pnl).toBe(-9n)
    expect(slow.slippageSum).toBe(18n)
    expect(slow.trades).toBe(2)
    expect(slow.finalPosition).toBe(0n)
  })

  it('cost of 100 ms over this range = −10 quote atoms', () => {
    const cost = costPer100Ms([fast, slow])
    expect(cost).toEqual({ costPer100Ms: -10n, fromMs: 0, toMs: 100, excludedMs: [] })
  })

  it('refuses unordered snapshots and a negative level', () => {
    const bad = [at(snapshots, 1), at(snapshots, 0)]
    expect(() => runBacktest({ snapshots: bad, levelsMs: [0], market, strategy })).toThrow(
      RangeError,
    )
    expect(() => runBacktest({ snapshots, levelsMs: [-1], market, strategy })).toThrow(RangeError)
    expect(() => runBacktest({ snapshots, levelsMs: [1.5], market, strategy })).toThrow(RangeError)
  })

  it('an empty period gives a zero row per level, no errors', () => {
    const r = runBacktest({ snapshots: [], levelsMs: [0, 50], market, strategy })
    expect(r.map((x) => [x.latencyMs, x.pnl, x.orders])).toEqual([
      [0, 0n, 0],
      [50, 0n, 0],
    ])
  })
})

const levelsMs = [0, 50, 100, 200, 400]

describe('presets are latency-sensitive (FR-015) on a synthetic market', () => {
  const snapshots = synthetic(7, 3000)

  for (const p of presets) {
    it(`${p.id}: trades; at Δ = 0 everything fills; at Δ = 400 slippage is larger, P&L differs`, () => {
      const params = { ...defaultParams(p.params), notionalQuote: 5000, holdMs: 300 }
      const results = runBacktest({
        snapshots,
        levelsMs,
        market,
        strategy: p.build(params, market),
      })
      const fast = at(results, 0)
      const slowest = at(results, results.length - 1)
      expect(fast.orders).toBeGreaterThan(20)
      // Δ = 0: the level that was seen is still there — zero unfilled. Slippage here
      // is not zero: the order is larger than the thin level and takes the rest from the next one (impact).
      expect(fast.unfilled).toBe(0)
      // Δ = 400: levels vanish before arrival — unfilled orders appear. Signed
      // slippage is not the indicator here: the limit cuts worse prices into no-fills and
      // lets better ones through, so among fills it is biased in our favour. P&L is the indicator.
      expect(slowest.unfilled).toBeGreaterThan(0)
      expect(slowest.pnl).not.toBe(fast.pnl)
    })
  }
})
