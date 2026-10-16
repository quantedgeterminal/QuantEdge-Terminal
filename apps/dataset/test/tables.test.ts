import { packLevels } from '@quantedge/shared'
import { describe, expect, it } from 'vitest'
import {
  arrivalsTable,
  type Column,
  checkChannels,
  checkCoverage,
  coverageTable,
  csvCell,
  DECIMAL38_MAX,
  isoMicros,
  levelsTable,
  parseIsoMicros,
  rowCount,
  type StateRow,
  statesTable,
} from '../src/tables.ts'

const S = 1_000_000n
const T0 = 1_789_147_860_800_000n // 2026-09-11T17:31:00.800Z

function state(id: bigint, marketId: number, bids: [bigint, bigint][], asks: [bigint, bigint][]) {
  const toLevels = (xs: [bigint, bigint][]) => xs.map(([price, size]) => ({ price, size }))
  return {
    id,
    marketId,
    slot: 446_214_199n + id,
    stateHash: id.toString(16).padStart(64, '0'),
    firstSeenUs: T0 + id * S,
    levels: packLevels({ bids: toLevels(bids), asks: toLevels(asks) }),
  } satisfies StateRow
}

function col(t: { columns: Column[] }, name: string): Column {
  const c = t.columns.find((x) => x.name === name)
  if (!c) throw new Error(`no column ${name}`)
  return c
}

describe('levelsTable', () => {
  it('unrolls each state into side × level rows, bids first, best level as 0', () => {
    const t = levelsTable([
      state(
        7n,
        1,
        [
          [101n, 5n],
          [100n, 6n],
        ],
        [[102n, 7n]],
      ),
      state(8n, 2, [], [[2n ** 100n, 1n]]),
    ])
    expect(rowCount(t)).toBe(4)
    expect(col(t, 'state_id').values).toEqual([7n, 7n, 7n, 8n])
    expect(col(t, 'market_id').values).toEqual([1, 1, 1, 2])
    expect(col(t, 'side').values).toEqual(['bid', 'bid', 'ask', 'ask'])
    expect(col(t, 'level').values).toEqual([0, 1, 0, 0])
    expect(col(t, 'price').values).toEqual([101n, 100n, 102n, 2n ** 100n])
    expect(col(t, 'size').values).toEqual([5n, 6n, 7n, 1n])
  })

  it('refuses a price that DECIMAL(38, 0) cannot hold instead of truncating it', () => {
    expect(() => levelsTable([state(1n, 1, [[DECIMAL38_MAX + 1n, 1n]], [])])).toThrow(
      /DECIMAL\(38, 0\)/,
    )
    expect(() => levelsTable([state(1n, 1, [[DECIMAL38_MAX, 1n]], [])])).not.toThrow()
  })

  it('refuses a size above INT64', () => {
    expect(() => levelsTable([state(1n, 1, [[1n, 1n << 63n]], [])])).toThrow(/INT64/)
  })
})

describe('statesTable', () => {
  it('counts levels per side from the packed slice', () => {
    const t = statesTable([state(3n, 1, [[1n, 1n]], [])])
    expect(col(t, 'bid_levels').values).toEqual([1])
    expect(col(t, 'ask_levels').values).toEqual([0])
    expect(col(t, 'first_seen_at').values).toEqual([T0 + 3n * S])
  })
})

describe('coverageTable', () => {
  it('reports the window per market with the number of states inside it', () => {
    const w = { fromUs: T0, toUs: T0 + 100n * S }
    const t = coverageTable([1, 2], w, [state(1n, 1, [], []), state(2n, 1, [], [])])
    expect(col(t, 'state_count').values).toEqual([2, 0])
    expect(col(t, 'from_ts').values).toEqual([T0, T0])
  })
})

describe('checkCoverage', () => {
  const w = { fromUs: T0, toUs: T0 + 100n * S }

  it('passes when one segment holds the whole window', () => {
    expect(() =>
      checkCoverage([1], [{ marketId: 1, fromUs: T0 - S, toUs: T0 + 200n * S }], w),
    ).not.toThrow()
  })

  it('names the first uncovered moment when segments leave a hole', () => {
    const coverage = [
      { marketId: 1, fromUs: T0, toUs: T0 + 40n * S },
      { marketId: 1, fromUs: T0 + 50n * S, toUs: T0 + 100n * S },
    ]
    expect(() => checkCoverage([1], coverage, w)).toThrow(
      `market 1: no gap-free coverage from ${isoMicros(T0 + 40n * S)}`,
    )
  })

  it('names a market with no coverage at all', () => {
    expect(() =>
      checkCoverage([1, 2], [{ marketId: 1, fromUs: T0, toUs: T0 + 100n * S }], w),
    ).toThrow(`market 2: no gap-free coverage from ${isoMicros(T0)}`)
  })
})

describe('checkChannels', () => {
  it('refuses an emulated channel: its latency is the profile written into it', () => {
    expect(() => checkChannels([{ id: 1, name: 'dz', kind: 'emulated', provider: '' }])).toThrow(
      /only real channels/,
    )
    expect(() =>
      checkChannels([{ id: 1, name: 'helius', kind: 'real', provider: 'helius' }]),
    ).not.toThrow()
  })
})

describe('text form', () => {
  it('parses a window bound down to the microsecond', () => {
    expect(parseIsoMicros('2026-09-11T17:31:00.800740Z')).toBe(T0 + 740n)
    expect(parseIsoMicros('2026-09-11T17:31:00.8Z')).toBe(T0)
    expect(parseIsoMicros('2026-09-11T17:31:00Z')).toBe(T0 - 800_000n)
    expect(isoMicros(parseIsoMicros('2026-09-11T17:31:00.800740Z'))).toBe(
      '2026-09-11T17:31:00.800740Z',
    )
    expect(() => parseIsoMicros('2026-09-11T17:31:00.8007401Z')).toThrow(/six fractional/)
    expect(() => parseIsoMicros('2026-09-11 17:31:00Z')).toThrow()
    expect(() => parseIsoMicros('2026-02-30T00:00:00Z')).toThrow(/not a valid time/)
  })

  it('keeps all six fractional digits of a timestamp', () => {
    expect(isoMicros(T0 + 7n)).toBe('2026-09-11T17:31:00.800007Z')
    expect(isoMicros(T0 + 349_123n)).toBe('2026-09-11T17:31:01.149123Z')
    expect(isoMicros(0n)).toBe('1970-01-01T00:00:00.000000Z')
  })

  it('writes integers in full and quotes only strings that need it', () => {
    const t = arrivalsTable([{ stateId: 2n ** 62n, channelId: 2, receivedUs: T0 }])
    expect(csvCell(col(t, 'state_id'), 0)).toBe('4611686018427387904')
    const s: Column = { name: 's', type: 'string', values: ['plain', 'a,b', 'say "hi"'] }
    expect([0, 1, 2].map((i) => csvCell(s, i))).toEqual(['plain', '"a,b"', '"say ""hi"""'])
    const p: Column = { name: 'p', type: 'u128', values: [2n ** 100n] }
    expect(csvCell(p, 0)).toBe('1267650600228229401496703205376')
  })
})
