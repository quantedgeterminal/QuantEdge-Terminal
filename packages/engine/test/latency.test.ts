import { describe, expect, it } from 'vitest'
import { assertOrdered, delayedIndex } from '../src/latency.ts'
import type { Snapshot } from '../src/types.ts'

const at = (t: number): Snapshot => ({ t, bids: [], asks: [] })

/** Reference without a cursor: the latest j ≤ i with t_j ≤ t_i − Δ. */
function reference(s: readonly Snapshot[], i: number, delay: number): number {
  const now = s[i]
  if (now === undefined) throw new Error('i out of bounds')
  for (let j = i; j >= 0; j--) {
    const c = s[j]
    if (c !== undefined && c.t <= now.t - delay) return j
  }
  return -1
}

describe('delayedIndex (FR-010)', () => {
  const s = [0, 100, 250, 250, 400, 1000].map(at)

  it('Δ = 0 sees itself, even with equal t', () => {
    for (let i = 0; i < s.length; i++) expect(delayedIndex(s, i, 0, i - 1)).toBe(i)
  })

  it('Δ larger than the elapsed time → nothing visible (-1)', () => {
    expect(delayedIndex(s, 0, 1, -1)).toBe(-1)
    expect(delayedIndex(s, 2, 300, -1)).toBe(-1)
  })

  it('sees the latest snapshot no later than t − Δ', () => {
    // i=4 (t=400), Δ=150 → visible up to 250 → index 3 (the last of the two t=250)
    expect(delayedIndex(s, 4, 150, -1)).toBe(3)
    // i=5 (t=1000), Δ=600 → visible up to 400 → index 4
    expect(delayedIndex(s, 5, 600, 3)).toBe(4)
    // i=1 (t=100), Δ=100 → visible up to 0 → index 0
    expect(delayedIndex(s, 1, 100, -1)).toBe(0)
  })

  it('the cursor is monotonic and matches the reference on every step', () => {
    const times = [0, 5, 5, 5, 20, 21, 22, 60, 61, 100, 100, 130]
    const snaps = times.map(at)
    for (const delay of [0, 1, 5, 15, 40, 100, 1000]) {
      let prev = -1
      for (let i = 0; i < snaps.length; i++) {
        const j = delayedIndex(snaps, i, delay, prev)
        expect(j).toBe(reference(snaps, i, delay))
        expect(j).toBeGreaterThanOrEqual(prev)
        prev = j
      }
    }
  })

  it('a step out of bounds is an error, not -1', () => {
    expect(() => delayedIndex(s, 6, 0, -1)).toThrow(RangeError)
  })
})

describe('assertOrdered', () => {
  it('accepts a non-decreasing series, including equal t', () => {
    expect(() => assertOrdered([0, 1, 1, 2].map(at))).not.toThrow()
    expect(() => assertOrdered([])).not.toThrow()
  })

  it('catches a decrease and names the index', () => {
    expect(() => assertOrdered([0, 5, 4].map(at))).toThrow(/t\[2\]=4 < t\[1\]=5/)
  })
})
