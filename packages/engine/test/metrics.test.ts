import { describe, expect, it } from 'vitest'
import { costPer100Ms, unfilledPct } from '../src/metrics.ts'
import type { LevelResult } from '../src/run.ts'

function level(latencyMs: number, pnl: bigint, orders = 100, unfilled = 0): LevelResult {
  return {
    latencyMs,
    pnl,
    trades: orders - unfilled,
    orders,
    unfilled,
    slippageSum: 0n,
    filledNotional: 0n,
    maxDrawdown: 0n,
    finalPosition: 0n,
    shiftedSteps: null,
  }
}

describe('costPer100Ms (FR-013)', () => {
  it('slope between the lowest and the highest level, the range is named', () => {
    const r = [level(0, 1000n), level(50, 900n), level(100, 700n), level(200, 500n)]
    expect(costPer100Ms(r)).toEqual({ costPer100Ms: -250n, fromMs: 0, toMs: 200, excludedMs: [] })
  })

  it('a level where ≥ 50 % of orders went unfilled, and everything past it, is dropped', () => {
    const r = [
      level(0, 1000n),
      level(100, 800n),
      level(200, 700n, 100, 50), // 50 % — no longer the same strategy
      level(400, 900n, 100, 10), // no coming back after a dropped level
    ]
    expect(costPer100Ms(r)).toEqual({
      costPer100Ms: -200n,
      fromMs: 0,
      toMs: 100,
      excludedMs: [200, 400],
    })
  })

  it('the threshold is configurable: 60 % lets a 50 % level through', () => {
    const r = [level(0, 1000n), level(200, 700n, 100, 50)]
    expect(costPer100Ms(r, 60)?.toMs).toBe(200)
  })

  it('fewer than two usable levels — null, not zero', () => {
    expect(costPer100Ms([level(0, 1n)])).toBeNull()
    expect(costPer100Ms([level(0, 1n), level(100, 2n, 10, 9)])).toBeNull()
    expect(costPer100Ms([])).toBeNull()
  })

  it('the order of input levels does not matter', () => {
    const a = costPer100Ms([level(200, 0n), level(0, 400n)])
    expect(a).toEqual({ costPer100Ms: -200n, fromMs: 0, toMs: 200, excludedMs: [] })
  })

  it('without orders the level stays (0 % unfilled) rather than being dropped', () => {
    const r = [level(0, 0n, 0, 0), level(100, 0n, 0, 0)]
    expect(costPer100Ms(r)).toEqual({ costPer100Ms: 0n, fromMs: 0, toMs: 100, excludedMs: [] })
  })
})

describe('unfilledPct', () => {
  it('integer percent, truncated down', () => {
    expect(unfilledPct(level(0, 0n, 3, 1))).toBe(33)
    expect(unfilledPct(level(0, 0n, 0, 0))).toBe(0)
    expect(unfilledPct(level(0, 0n, 4, 4))).toBe(100)
  })
})
