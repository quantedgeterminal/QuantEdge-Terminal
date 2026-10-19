import { describe, expect, it } from 'vitest'
import { mean, round, sampleSd, signTest, tStat } from '../src/stats.ts'

describe('signTest', () => {
  it('gives the exact two-sided binomial p', () => {
    // 10 of 10 one way: 2 / 2^10.
    expect(signTest(Array(10).fill(-1)).p).toBe(2 / 1024)
    // 7 of 10: 2 × (1 + 10 + 45 + 120) / 1024.
    expect(signTest([1, 1, 1, 1, 1, 1, 1, -1, -1, -1]).p).toBe(352 / 1024)
  })

  it('drops ties instead of counting them against the direction', () => {
    const t = signTest([-3, -2, -1, -1, -1, -1, -1, -1, -1, 0])
    expect(t).toEqual({ negative: 9, positive: 0, ties: 1, p: 2 / 512 })
  })

  it('says nothing when no window has a sign', () => {
    expect(signTest([0, 0, 0]).p).toBe(1)
  })

  it('never reports p above one on an even split', () => {
    expect(signTest([1, -1, 1, -1]).p).toBe(1)
  })
})

describe('spread', () => {
  it('uses the sample standard deviation', () => {
    expect(mean([1, 2, 3, 4])).toBe(2.5)
    expect(sampleSd([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.13809, 5)
    expect(sampleSd([5])).toBe(0)
  })

  it('has no t statistic when the differences do not vary', () => {
    expect(tStat([3, 3, 3])).toBeNull()
    expect(tStat([1, 2, 3])).toBeCloseTo(2 / (1 / Math.sqrt(3)), 10)
  })

  it('rounds for publication', () => {
    expect(round(0.123456789, 4)).toBe(0.1235)
  })
})
