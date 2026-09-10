import { describe, expect, it } from 'vitest'
import type { ArrivalEvent } from '../src/api/schemas.ts'
import {
  clock,
  emulatedCell,
  emulatedLabel,
  histogram,
  readProfile,
  realCell,
  realLanes,
} from '../src/compare.ts'
import { EMULATED_DISCLAIMER, NOTHING_TO_COMPARE } from '../src/pages/CompareScreen.tsx'

const ev = (id: number, a: number | null, b: number | null): ArrivalEvent => ({
  eventId: String(id),
  firstRealMs: 1_700_000_000_000 + id,
  arrivals: [
    { pathId: 1, kind: 'real', lagMs: a },
    { pathId: 2, kind: 'real', lagMs: b },
    { pathId: 3, kind: 'emulated', lagMs: null },
  ],
})

describe('emulated lane profile (T048, FR-005a, SC-007)', () => {
  it('from the query — only a complete pair within bounds; otherwise no lane', () => {
    expect(readProfile(new URLSearchParams('offsetMs=-100&source=vendor%20claim'))).toEqual({
      offsetMs: -100,
      source: 'vendor claim',
    })
    expect(readProfile(new URLSearchParams('offsetMs=-100'))).toBeNull()
    expect(readProfile(new URLSearchParams('source=x'))).toBeNull()
    expect(readProfile(new URLSearchParams('offsetMs=1.5&source=x'))).toBeNull()
    expect(readProfile(new URLSearchParams('offsetMs=999999&source=x'))).toBeNull()
  })

  it('the lane label contains "EMULATED" and the source; the cell says "profile", not a measured number', () => {
    const p = { offsetMs: -100, source: 'vendor claim, link' }
    expect(emulatedLabel(p)).toBe('EMULATED · profile -100 ms · source: vendor claim, link')
    expect(emulatedLabel({ offsetMs: 40, source: 'guess' })).toMatch(/^EMULATED · profile \+40 ms/)
    expect(emulatedCell(p)).toBe('-100 ms (profile)')
  })

  it('the disclaimer and the "nothing to compare" state name the reason (FR-003c)', () => {
    expect(EMULATED_DISCLAIMER).toMatch(/not a measurement/)
    expect(EMULATED_DISCLAIMER).toMatch(/No provider is claimed/)
    expect(NOTHING_TO_COMPARE).toMatch(/^Nothing to compare/)
    expect(NOTHING_TO_COMPARE).toMatch(/Fewer than two real channels/)
    expect(NOTHING_TO_COMPARE).toMatch(/emulated channel would only repeat the profile/)
  })
})

describe('lanes and distribution (T047, FR-021)', () => {
  it('real cell: first / +N ms / —', () => {
    expect(realCell(0)).toBe('first')
    expect(realCell(35)).toBe('+35 ms')
    expect(realCell(null)).toBe('—')
  })

  it('two lanes — real only, by id; with one real channel — null', () => {
    expect(
      realLanes([
        { pathId: 3, name: 'emu', kind: 'emulated' },
        { pathId: 2, name: 'b', kind: 'real' },
        { pathId: 1, name: 'a', kind: 'real' },
      ])?.map((p) => p.name),
    ).toEqual(['a', 'b'])
    expect(
      realLanes([
        { pathId: 1, name: 'a', kind: 'real' },
        { pathId: 3, name: 'emu', kind: 'emulated' },
      ]),
    ).toBeNull()
  })

  it('histogram buckets the lag of one channel; emulation is not counted', () => {
    const events = [ev(1, 0, 5), ev(2, 0, 30), ev(3, 12, 0), ev(4, 0, 300), ev(5, 0, 0)]
    const bins = histogram(events, 2)
    expect(bins.map((b) => [b.label, b.count])).toEqual([
      ['0 ms', 2],
      ['1–10 ms', 1],
      ['11–25 ms', 0],
      ['26–50 ms', 1],
      ['51–100 ms', 0],
      ['101–250 ms', 0],
      ['251+ ms', 1],
    ])
    expect(histogram(events, 3).reduce((s, b) => s + b.count, 0)).toBe(0)
  })

  it('row clock is UTC with milliseconds', () => {
    expect(clock(Date.parse('2026-09-09T12:34:56.789Z'))).toBe('12:34:56.789')
  })
})
