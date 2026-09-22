import { describe, expect, it } from 'vitest'
import {
  type ArrivalRow,
  aggregateLatency,
  type PathRow,
  percentile,
  recentArrivals,
} from '../src/latency.ts'

const A: PathRow = { id: 1, name: 'helius', kind: 'real' }
const B: PathRow = { id: 2, name: 'alchemy', kind: 'real' }
const E: PathRow = { id: 3, name: 'emu-fast', kind: 'emulated' }

const us = (ms: number): bigint => BigInt(ms) * 1000n

/** Event `id` that arrived over the channels at the given moments (ms). */
function event(id: number, at: Record<number, number>): ArrivalRow[] {
  return Object.entries(at).map(([pathId, ms]) => ({
    bookUpdateId: BigInt(id),
    pathId: Number(pathId),
    receivedAtUs: us(ms),
  }))
}

describe('percentile — nearest rank', () => {
  it('empty → null; one element → itself; p50 and p95 over ten', () => {
    expect(percentile([], 50)).toBeNull()
    expect(percentile([7], 95)).toBe(7)
    const ten = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    expect(percentile(ten, 50)).toBe(5)
    expect(percentile(ten, 95)).toBe(10)
    expect(percentile(ten, 0)).toBe(1)
  })
})

describe('aggregateLatency (FR-003, FR-003c)', () => {
  it('lag is measured from the earliest real channel of the same event', () => {
    const rows = [
      ...event(1, { 1: 1000, 2: 1040 }), // B lags by 40
      ...event(2, { 1: 2030, 2: 2000 }), // A lags by 30
      ...event(3, { 1: 3000, 2: 3100 }), // B lags by 100
    ]
    const s = aggregateLatency([A, B], rows, 60)
    expect(s.measurable).toBe(true)
    expect(s.sharedEvents).toBe(3)
    const [a, b] = s.paths
    expect(a).toMatchObject({ name: 'helius', kind: 'real', sampleCount: 3, laterPct: 33 })
    expect(a?.p50Ms).toBe(0)
    expect(a?.p95Ms).toBe(30)
    expect(b).toMatchObject({ name: 'alchemy', kind: 'real', sampleCount: 3, laterPct: 66 })
    expect(b?.p50Ms).toBe(40)
    expect(b?.p95Ms).toBe(100)
  })

  it('an emulated channel neither enters the minimum nor gets a lag', () => {
    // The emulation "arrived" before everyone — if it entered the minimum, both real channels would lag.
    const rows = [
      ...event(1, { 1: 1000, 2: 1020, 3: 900 }),
      ...event(2, { 1: 2000, 2: 2010, 3: 1900 }),
    ]
    const s = aggregateLatency([A, B, E], rows, 60)
    const a = s.paths.find((p) => p.pathId === 1)
    const e = s.paths.find((p) => p.pathId === 3)
    expect(a?.p50Ms).toBe(0)
    expect(e).toMatchObject({ kind: 'emulated', p50Ms: null, p95Ms: null, sampleCount: 0 })
  })

  it('an event that arrived over one real channel is not measured', () => {
    const rows = [...event(1, { 1: 1000 }), ...event(2, { 1: 2000, 2: 2050 })]
    const s = aggregateLatency([A, B], rows, 60)
    expect(s.sharedEvents).toBe(1)
    expect(s.paths.find((p) => p.pathId === 2)?.sampleCount).toBe(1)
  })

  it('T036: fewer than two real channels → measurable: false, even with emulation', () => {
    const rows = [...event(1, { 1: 1000, 3: 990 })]
    const s = aggregateLatency([A, E], rows, 60)
    expect(s.measurable).toBe(false)
    expect(s.paths.map((p) => p.kind)).toEqual(['real', 'emulated'])
  })

  it('two real channels without shared events — measurable, but sharedEvents 0', () => {
    const s = aggregateLatency([A, B], [], 60)
    expect(s).toMatchObject({ measurable: true, sharedEvents: 0, windowSec: 60 })
    expect(s.paths.every((p) => p.p50Ms === null)).toBe(true)
  })

  it('a channel in the table with no arrivals in the window is still in the response — with kind', () => {
    const s = aggregateLatency([A, B, E], event(1, { 1: 1000, 2: 1001 }), 60)
    expect(s.paths.map((p) => [p.name, p.kind])).toEqual([
      ['helius', 'real'],
      ['alchemy', 'real'],
      ['emu-fast', 'emulated'],
    ])
  })
})

describe('aggregateLatency — per-channel state (T057)', () => {
  it('a channel with no arrivals in the window is null, not zero: it is not delivering', () => {
    const rows = [...event(1, { 2: 100 }), ...event(2, { 2: 200 })]
    const out = aggregateLatency([A, B], rows, 60)
    expect(out.paths.find((p) => p.pathId === 1)?.lastEventAtMs).toBeNull()
    expect(out.paths.find((p) => p.pathId === 2)?.lastEventAtMs).toBe(200)
  })

  it('the latest arrival wins regardless of row order', () => {
    const rows = [...event(2, { 1: 500 }), ...event(1, { 1: 100 })]
    expect(aggregateLatency([A], rows, 60).paths[0]?.lastEventAtMs).toBe(500)
  })

  it('an emulated channel reports its state too — the mark rides along, not instead', () => {
    const out = aggregateLatency([A, E], event(1, { 3: 700 }), 60)
    const emu = out.paths.find((p) => p.pathId === 3)
    expect(emu?.kind).toBe('emulated')
    expect(emu?.lastEventAtMs).toBe(700)
  })
})

describe('recentArrivals (FR-021, FR-003c)', () => {
  it('events with ≥ 2 real channels, newest first, lag from the earliest real one; emulation without lag', () => {
    const rows = [
      ...event(1, { 1: 1000, 2: 1040, 3: 900 }), // emulation "before everyone" does not move the reference point
      ...event(2, { 1: 2030, 2: 2000 }),
      ...event(3, { 1: 3000 }), // only one real channel — not a compare row
      ...event(4, { 1: 4000, 2: 4100 }),
    ]
    const ev = recentArrivals([A, B, E], rows, 10)
    expect(ev.map((e) => e.eventId)).toEqual(['4', '2', '1'])
    expect(ev[2]).toEqual({
      eventId: '1',
      firstRealMs: 1000,
      arrivals: [
        { pathId: 1, kind: 'real', lagMs: 0 },
        { pathId: 2, kind: 'real', lagMs: 40 },
        { pathId: 3, kind: 'emulated', lagMs: null },
      ],
    })
    expect(ev[1]?.arrivals).toEqual([
      { pathId: 1, kind: 'real', lagMs: 30 },
      { pathId: 2, kind: 'real', lagMs: 0 },
    ])
  })

  it('trims to the `limit` newest', () => {
    const rows = [1, 2, 3, 4, 5].flatMap((i) => event(i, { 1: i * 1000, 2: i * 1000 + i }))
    const ev = recentArrivals([A, B], rows, 2)
    expect(ev.map((e) => e.eventId)).toEqual(['5', '4'])
  })
})
