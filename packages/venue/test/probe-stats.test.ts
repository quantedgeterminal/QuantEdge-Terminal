import { describe, expect, it } from 'vitest'
import { activityStats, instrumentPasses } from '../src/probe-stats.ts'

const sample = (blockTime: number | null, failed = false) => ({ blockTime, failed })

describe('activityStats', () => {
  it('computes tx/s over the span between the outermost signatures', () => {
    // 5 signatures over 4 seconds: 1.25 tx/s; two failed.
    const s = activityStats([
      sample(104, true),
      sample(103),
      sample(102),
      sample(101, true),
      sample(100),
    ])
    expect(s.count).toBe(5)
    expect(s.windowSec).toBe(4)
    expect(s.txPerSec).toBeCloseTo(1.25)
    expect(s.okPerSec).toBeCloseTo(0.75)
    expect(s.failShare).toBeCloseTo(0.4)
  })

  it('ignores signatures without blockTime', () => {
    const s = activityStats([sample(null), sample(110), sample(null), sample(100)])
    expect(s.count).toBe(2)
    expect(s.windowSec).toBe(10)
  })

  it('an empty sample — zero without division', () => {
    expect(activityStats([])).toEqual({
      count: 0,
      windowSec: 0,
      txPerSec: null,
      okPerSec: null,
      failShare: 0,
    })
  })

  it('all signatures within one second — the rate is undefined, not infinite', () => {
    const s = activityStats([sample(7), sample(7), sample(7)])
    expect(s.count).toBe(3)
    expect(s.txPerSec).toBeNull()
  })
})

describe('instrumentPasses', () => {
  it('an empty sample on the reference — the instrument is broken', () => {
    expect(instrumentPasses(activityStats([]), 1)).toBe(false)
  })

  it('a sample within a zero span — the instrument sees activity', () => {
    expect(instrumentPasses(activityStats([sample(7), sample(7)]), 1)).toBe(true)
  })

  it('the threshold applies to txPerSec', () => {
    const slow = activityStats([sample(100), sample(0)]) // 0.02 tx/s
    expect(instrumentPasses(slow, 1)).toBe(false)
    expect(instrumentPasses(slow, 0.01)).toBe(true)
  })
})
