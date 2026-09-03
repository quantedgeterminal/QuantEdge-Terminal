import { describe, expect, it } from 'vitest'
import { missingRanges } from '../src/coverage.ts'

const seg = (fromMs: number, toMs: number) => ({ fromMs, toMs, updateCount: 1 })

describe('missingRanges (FR-014)', () => {
  const coverage = [seg(100, 200), seg(200, 300), seg(400, 500)]

  it('a period inside one segment is complete', () => {
    expect(missingRanges(coverage, { fromMs: 120, toMs: 180 })).toEqual([])
  })

  it('two segments touching without a gap — complete', () => {
    expect(missingRanges(coverage, { fromMs: 150, toMs: 250 })).toEqual([])
  })

  it('names the range between segments exactly', () => {
    expect(missingRanges(coverage, { fromMs: 250, toMs: 450 })).toEqual([
      { fromMs: 300, toMs: 400 },
    ])
  })

  it('names the tail and the head outside coverage', () => {
    expect(missingRanges(coverage, { fromMs: 50, toMs: 150 })).toEqual([{ fromMs: 50, toMs: 100 }])
    expect(missingRanges(coverage, { fromMs: 450, toMs: 600 })).toEqual([
      { fromMs: 500, toMs: 600 },
    ])
  })

  it('without coverage — the whole period is missing', () => {
    expect(missingRanges([], { fromMs: 0, toMs: 10 })).toEqual([{ fromMs: 0, toMs: 10 }])
  })

  it('overlaps and unordered input create no false holes', () => {
    const messy = [seg(400, 500), seg(100, 250), seg(200, 300)]
    expect(missingRanges(messy, { fromMs: 100, toMs: 500 })).toEqual([{ fromMs: 300, toMs: 400 }])
  })

  it('an empty or inverted period is an error', () => {
    expect(() => missingRanges(coverage, { fromMs: 10, toMs: 10 })).toThrow(RangeError)
    expect(() => missingRanges(coverage, { fromMs: 20, toMs: 10 })).toThrow(RangeError)
  })
})
