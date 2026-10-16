import { unpackLevels } from '@quantedge/shared'

/**
 * The dataset is a handful of flat tables. Every column is required: a value the collector did not
 * record is not in the dataset at all, rather than a null a reader has to guess about.
 *
 * Money and sizes stay integers in the smallest on-chain units (rule 2). A price is a u128 on chain,
 * so it does not fit INT64; it goes out as DECIMAL(38, 0), which every Parquet reader keeps exact.
 */
export type Column =
  | { name: string; type: 'int32'; values: number[] }
  | { name: string; type: 'int64'; values: bigint[] }
  | { name: string; type: 'u128'; values: bigint[] }
  | { name: string; type: 'string'; values: string[] }
  | { name: string; type: 'timestamp_us'; values: bigint[] }

export type ColumnType = Column['type']

export interface Table {
  name: string
  columns: Column[]
}

const INT64_MAX = (1n << 63n) - 1n
/** DECIMAL(38, 0) holds 38 digits; a u128 can reach 39. Real prices are far below either bound. */
export const DECIMAL38_MAX = 10n ** 38n - 1n

export function rowCount(t: Table): number {
  const n = t.columns[0]?.values.length ?? 0
  for (const c of t.columns) {
    if (c.values.length !== n) {
      throw new Error(`${t.name}.${c.name} has ${c.values.length} values, expected ${n}`)
    }
  }
  return n
}

// ---------------------------------------------------------------- source rows

export interface MarketRow {
  id: number
  venue: string
  address: string
  baseMint: string
  quoteMint: string
  baseSymbol: string
  quoteSymbol: string
  baseDecimals: number
  quoteDecimals: number
}

export interface ChannelRow {
  id: number
  name: string
  kind: string
  provider: string
}

export interface CoverageRow {
  marketId: number
  fromUs: bigint
  toUs: bigint
}

export interface StateRow {
  id: bigint
  marketId: number
  slot: bigint
  /** sha256 of the raw account bytes, hex — the event key across channels (FR-003a). */
  stateHash: string
  firstSeenUs: bigint
  /** The packed top-N slice as stored in `book_updates.levels`. */
  levels: Uint8Array
}

export interface ArrivalRow {
  stateId: bigint
  channelId: number
  receivedUs: bigint
}

export interface Window {
  fromUs: bigint
  toUs: bigint
}

// ---------------------------------------------------------------- checks

/**
 * The window must sit inside one gap-free coverage segment per market (FR-014): an export over a
 * hole would hand out a book that silently skips time. The error names the market and the range
 * that is not covered instead of exporting what is there.
 */
export function checkCoverage(
  marketIds: readonly number[],
  coverage: readonly CoverageRow[],
  w: Window,
): void {
  if (w.fromUs >= w.toUs) throw new Error('the window must start before it ends')
  for (const m of marketIds) {
    const own = coverage.filter((c) => c.marketId === m)
    const inside = own.some((c) => c.fromUs <= w.fromUs && c.toUs >= w.toUs)
    if (inside) continue
    const covering = own
      .filter((c) => c.toUs > w.fromUs && c.fromUs < w.toUs)
      .sort((a, b) => (a.fromUs < b.fromUs ? -1 : 1))
    let cursor = w.fromUs
    for (const c of covering) {
      if (c.fromUs > cursor) break
      if (c.toUs > cursor) cursor = c.toUs
    }
    throw new Error(
      `market ${m}: no gap-free coverage from ${isoMicros(cursor)} to ${isoMicros(w.toUs)}`,
    )
  }
}

/** Rule 4 as data: only real channels go out, so every latency in the file is a measurement. */
export function checkChannels(channels: readonly ChannelRow[]): void {
  for (const c of channels) {
    if (c.kind !== 'real') {
      throw new Error(`channel ${c.name} is ${c.kind}: only real channels belong in the dataset`)
    }
  }
}

// ---------------------------------------------------------------- tables

export function marketsTable(rows: readonly MarketRow[]): Table {
  return {
    name: 'markets',
    columns: [
      { name: 'market_id', type: 'int32', values: rows.map((r) => r.id) },
      { name: 'venue', type: 'string', values: rows.map((r) => r.venue) },
      { name: 'address', type: 'string', values: rows.map((r) => r.address) },
      { name: 'base_symbol', type: 'string', values: rows.map((r) => r.baseSymbol) },
      { name: 'quote_symbol', type: 'string', values: rows.map((r) => r.quoteSymbol) },
      { name: 'base_mint', type: 'string', values: rows.map((r) => r.baseMint) },
      { name: 'quote_mint', type: 'string', values: rows.map((r) => r.quoteMint) },
      { name: 'base_decimals', type: 'int32', values: rows.map((r) => r.baseDecimals) },
      { name: 'quote_decimals', type: 'int32', values: rows.map((r) => r.quoteDecimals) },
    ],
  }
}

export function channelsTable(rows: readonly ChannelRow[]): Table {
  return {
    name: 'channels',
    columns: [
      { name: 'channel_id', type: 'int32', values: rows.map((r) => r.id) },
      { name: 'name', type: 'string', values: rows.map((r) => r.name) },
      { name: 'kind', type: 'string', values: rows.map((r) => r.kind) },
      { name: 'provider', type: 'string', values: rows.map((r) => r.provider) },
    ],
  }
}

/** Coverage as exported: the window itself, per market, with the number of states inside it. */
export function coverageTable(
  marketIds: readonly number[],
  w: Window,
  states: readonly StateRow[],
): Table {
  const counts = new Map<number, number>()
  for (const s of states) counts.set(s.marketId, (counts.get(s.marketId) ?? 0) + 1)
  return {
    name: 'coverage',
    columns: [
      { name: 'market_id', type: 'int32', values: [...marketIds] },
      { name: 'from_ts', type: 'timestamp_us', values: marketIds.map(() => w.fromUs) },
      { name: 'to_ts', type: 'timestamp_us', values: marketIds.map(() => w.toUs) },
      { name: 'state_count', type: 'int32', values: marketIds.map((m) => counts.get(m) ?? 0) },
    ],
  }
}

export function statesTable(rows: readonly StateRow[]): Table {
  const bidLevels: number[] = []
  const askLevels: number[] = []
  for (const r of rows) {
    const book = unpackLevels(r.levels)
    bidLevels.push(book.bids.length)
    askLevels.push(book.asks.length)
  }
  return {
    name: 'states',
    columns: [
      { name: 'state_id', type: 'int64', values: rows.map((r) => r.id) },
      { name: 'market_id', type: 'int32', values: rows.map((r) => r.marketId) },
      { name: 'slot', type: 'int64', values: rows.map((r) => r.slot) },
      { name: 'state_hash', type: 'string', values: rows.map((r) => r.stateHash) },
      { name: 'first_seen_at', type: 'timestamp_us', values: rows.map((r) => r.firstSeenUs) },
      { name: 'bid_levels', type: 'int32', values: bidLevels },
      { name: 'ask_levels', type: 'int32', values: askLevels },
    ],
  }
}

/**
 * The long format: one row per state × side × level. Level 0 is the best price on its side; the
 * collector stores levels best first, aggregated by price.
 */
export function levelsTable(rows: readonly StateRow[]): Table {
  const stateId: bigint[] = []
  const marketId: number[] = []
  const side: string[] = []
  const level: number[] = []
  const price: bigint[] = []
  const size: bigint[] = []
  for (const r of rows) {
    const book = unpackLevels(r.levels)
    for (const [name, levels] of [
      ['bid', book.bids],
      ['ask', book.asks],
    ] as const) {
      levels.forEach((l, i) => {
        if (l.price > DECIMAL38_MAX) {
          throw new RangeError(`state ${r.id}: price ${l.price} does not fit DECIMAL(38, 0)`)
        }
        if (l.size > INT64_MAX) {
          throw new RangeError(`state ${r.id}: size ${l.size} does not fit INT64`)
        }
        stateId.push(r.id)
        marketId.push(r.marketId)
        side.push(name)
        level.push(i)
        price.push(l.price)
        size.push(l.size)
      })
    }
  }
  return {
    name: 'levels',
    columns: [
      { name: 'state_id', type: 'int64', values: stateId },
      { name: 'market_id', type: 'int32', values: marketId },
      { name: 'side', type: 'string', values: side },
      { name: 'level', type: 'int32', values: level },
      { name: 'price', type: 'u128', values: price },
      { name: 'size', type: 'int64', values: size },
    ],
  }
}

export function arrivalsTable(rows: readonly ArrivalRow[]): Table {
  return {
    name: 'arrivals',
    columns: [
      { name: 'state_id', type: 'int64', values: rows.map((r) => r.stateId) },
      { name: 'channel_id', type: 'int32', values: rows.map((r) => r.channelId) },
      { name: 'received_at', type: 'timestamp_us', values: rows.map((r) => r.receivedUs) },
    ],
  }
}

// ---------------------------------------------------------------- text form

/**
 * ISO 8601 UTC → microseconds since the epoch. `Date.parse` stops at milliseconds, and the frozen
 * window starts at a microsecond the collector recorded (17:31:00.800740), not at a round number.
 */
export function parseIsoMicros(s: string): bigint {
  const m = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?Z$/.exec(s)
  if (!m)
    throw new RangeError(`expected an ISO 8601 UTC time with at most six fractional digits: ${s}`)
  const ms = Date.parse(`${m[1]}Z`)
  // Date.parse rolls 30 February over into March; the round trip refuses it.
  if (Number.isNaN(ms) || new Date(ms).toISOString().slice(0, 19) !== m[1]) {
    throw new RangeError(`not a valid time: ${s}`)
  }
  return BigInt(ms) * 1000n + BigInt((m[2] ?? '').padEnd(6, '0'))
}

/** Microseconds since the epoch → ISO 8601 UTC with six fractional digits. Exact, no float. */
export function isoMicros(us: bigint): string {
  if (us < 0n) throw new RangeError(`timestamp before 1970: ${us}`)
  const ms = us / 1000n
  const rest = (us % 1000n).toString().padStart(3, '0')
  return new Date(Number(ms)).toISOString().replace('Z', `${rest}Z`)
}

function csvString(s: string): string {
  return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s
}

export function csvCell(c: Column, i: number): string {
  switch (c.type) {
    case 'int32':
    case 'int64':
    case 'u128':
      return String(c.values[i])
    case 'string':
      return csvString(c.values[i] as string)
    case 'timestamp_us':
      return isoMicros(c.values[i] as bigint)
  }
}
