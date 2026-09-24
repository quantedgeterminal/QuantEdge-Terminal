import { describe, expect, it } from 'vitest'
import { medianGapMs } from '../src/latency.ts'
import { defaultParams, findPreset } from '../src/presets/index.ts'
import { type LevelResult, runBacktest } from '../src/run.ts'
import type { Strategy } from '../src/strategy.ts'
import type { Snapshot } from '../src/types.ts'
import { lvl, market, synthetic } from './synthetic.ts'

/** A strategy that never orders: the run then measures nothing but the view each level had. */
const watcher: Strategy<null> = {
  init: () => null,
  decide: () => ({ state: null, orders: [] }),
}

const book = (t: number): Snapshot => ({ t, asks: [lvl(101, 100)], bids: [lvl(99, 100)] })

/** States 1600 ms apart — the grain of the real feed (cbBTC 1.48 s, RENDER 1.46 s, USDT 1.80 s). */
const slowFeed = Array.from({ length: 20 }, (_, i) => book(i * 1600))

function shifted(snapshots: readonly Snapshot[], levelsMs: readonly number[]) {
  return runBacktest({ snapshots, levelsMs, market, strategy: watcher }).map(
    (r) => [r.latencyMs, r.shiftedSteps] as const,
  )
}

describe('medianGapMs — the grain of the period', () => {
  it('fewer than two states — no gap to measure', () => {
    expect(medianGapMs([])).toBeNull()
    expect(medianGapMs([book(0)])).toBeNull()
  })

  it('odd count of gaps — the middle one', () => {
    // gaps 100, 150, 0, 150, 600 → sorted 0, 100, 150, 150, 600
    const s = [0, 100, 250, 250, 400, 1000].map(book)
    expect(medianGapMs(s)).toBe(150)
  })

  it('even count of gaps — the lower of the two middle ones, an element of the data', () => {
    // gaps 100, 150, 0, 150 → sorted 0, 100, 150, 150
    const s = [0, 100, 250, 250, 400].map(book)
    expect(medianGapMs(s)).toBe(100)
  })

  it('a steady feed measures as its own step', () => {
    expect(medianGapMs(slowFeed)).toBe(1600)
  })
})

describe('shiftedSteps — which levels the data can tell apart (FR-013a)', () => {
  it('the fastest level of the grid has nothing to compare against', () => {
    expect(shifted(slowFeed, [0, 50])[0]).toEqual([0, null])
    // Not the delay 0 in particular — whichever level of the grid is the fastest.
    expect(shifted(slowFeed, [200, 400])[0]).toEqual([200, null])
  })

  it('every delay below the gap collapses onto the first one that crosses a state', () => {
    // 50 ms already looks one state back, so it differs from 0 ms on every step; 100 and 200 ms
    // look at that same state and add nothing — the finding of 2026-09-22 in one assertion.
    expect(shifted(slowFeed, [0, 50, 100, 200])).toEqual([
      [0, null],
      [50, 20],
      [100, 0],
      [200, 0],
    ])
  })

  it('a delay past the gap does move the view and says so', () => {
    // 19 of 20, not 20: on the first step both levels are still blind, so they agree there.
    expect(shifted(slowFeed, [200, 1700])).toEqual([
      [200, null],
      [1700, 19],
    ])
  })

  it('rows come back in the caller`s order, not fastest first', () => {
    expect(shifted(slowFeed, [200, 0, 100]).map(([ms]) => ms)).toEqual([200, 0, 100])
  })
})

describe('shiftedSteps = 0 means the rows are identical by construction', () => {
  // A real trading book stretched ×100: 1000–5000 ms between states, like the collected data.
  const stretched = synthetic(7, 60).map((s) => ({ ...s, t: s.t * 100 }))
  const preset = findPreset('imbalance-momentum')
  if (!preset) throw new Error('no preset imbalance-momentum')
  const strategy = preset.build(defaultParams(preset.params), market)
  const results = runBacktest({
    snapshots: stretched,
    levelsMs: [0, 50, 100, 200],
    market,
    strategy,
  })
  const row = (ms: number): LevelResult => {
    const r = results.find((x) => x.latencyMs === ms)
    if (!r) throw new Error(`no level ${ms}`)
    return r
  }
  /** Everything the delay is supposed to change — the row minus its own two labels. */
  const body = ({ latencyMs: _ms, shiftedSteps: _s, ...rest }: LevelResult) => rest

  it('the strategy traded, so the comparison is about delay and not about an empty run', () => {
    expect(row(0).trades).toBeGreaterThan(0)
  })

  it('levels with shiftedSteps = 0 repeat the faster row in every field', () => {
    expect(row(100).shiftedSteps).toBe(0)
    expect(row(200).shiftedSteps).toBe(0)
    expect(body(row(100))).toEqual(body(row(50)))
    expect(body(row(200))).toEqual(body(row(50)))
  })

  it('the level that did move the view is the one whose row differs', () => {
    expect(row(50).shiftedSteps).toBeGreaterThan(0)
    expect(body(row(50))).not.toEqual(body(row(0)))
  })
})
