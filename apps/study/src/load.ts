import { createHash } from 'node:crypto'
import { createReadStream, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { createGunzip } from 'node:zlib'
import type { Level, Snapshot } from '@quantedge/engine'

/**
 * Reads the published `dataset-v1` release files — the CSV.gz form, because it needs nothing
 * beyond Node — into the snapshots the engine runs on. Nothing here talks to the collector's
 * database: anyone holding the thirteen release assets reproduces every figure of the study.
 */

export const DATASET = 'quantedge-dataset-v1'

export interface Market {
  readonly id: number
  readonly base: string
  readonly quote: string
  readonly baseDecimals: number
  readonly quoteDecimals: number
}

/** One book state as the study sees it: the engine snapshot plus what the grain figures need. */
export interface State {
  readonly id: bigint
  readonly slot: bigint
  /** `first_seen_at` in microseconds since the epoch, exact. */
  readonly us: bigint
}

export interface MarketData {
  readonly market: Market
  readonly states: readonly State[]
  /** Same order and length as `states`. */
  readonly snapshots: readonly Snapshot[]
}

export interface Dataset {
  readonly fromUs: bigint
  readonly toUs: bigint
  readonly markets: readonly MarketData[]
}

const ISO = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d{6})Z$/

/**
 * The export writes every time as `YYYY-MM-DDTHH:MM:SS.ffffffZ`. Microseconds stay exact here
 * (a `Date` would stop at milliseconds); the calendar part goes through `Date.UTC`, which is exact
 * for whole seconds.
 */
export function parseUs(s: string): bigint {
  const m = ISO.exec(s)
  if (!m) throw new RangeError(`not a dataset timestamp: ${s}`)
  const [, y, mo, d, h, mi, sec] = m.map(Number)
  const seconds = Date.UTC(y ?? 0, (mo ?? 1) - 1, d ?? 0, h ?? 0, mi ?? 0, sec ?? 0) / 1000
  return BigInt(seconds) * 1_000_000n + BigInt(m[7] ?? '0')
}

/**
 * Engine time is whole milliseconds, truncated — what the API hands the engine, since the
 * Postgres driver turns `first_seen_at` into a `Date`. Matching it keeps the study's runs and the
 * terminal's runs the same computation.
 */
export function engineMs(us: bigint): number {
  return Number(us / 1000n)
}

async function* rows(dir: string, table: string): AsyncGenerator<string[]> {
  const input = createReadStream(join(dir, `${DATASET}-${table}.csv.gz`)).pipe(createGunzip())
  let header: string | null = null
  for await (const line of createInterface({ input, crlfDelay: Number.POSITIVE_INFINITY })) {
    if (line === '') continue
    if (header === null) {
      header = line
      continue
    }
    // No field of the tables read here can hold a comma or a quote (symbols, mints and hashes
    // are base58 or hex), so a plain split is the whole CSV grammar they need.
    yield line.split(',')
  }
}

function field(row: readonly string[], i: number): string {
  const v = row[i]
  if (v === undefined) throw new RangeError(`short row: ${row.join(',')}`)
  return v
}

/**
 * Checks the files against the release's `SHA256SUMS` before reading them: a figure computed on
 * a different file than the one published is not a reproduction.
 */
export function verifySums(dir: string): void {
  const sums = readFileSync(join(dir, 'SHA256SUMS'), 'utf8')
  for (const line of sums.split('\n')) {
    const m = /^([0-9a-f]{64}) {2}(\S+\.csv\.gz)$/.exec(line.trim())
    if (!m?.[1] || !m[2]) continue
    const got = createHash('sha256')
      .update(readFileSync(join(dir, m[2])))
      .digest('hex')
    if (got !== m[1]) throw new Error(`${m[2]}: sha256 ${got} does not match SHA256SUMS`)
  }
}

async function readMarkets(dir: string): Promise<Market[]> {
  const out: Market[] = []
  for await (const r of rows(dir, 'markets')) {
    out.push({
      id: Number(field(r, 0)),
      base: field(r, 3),
      quote: field(r, 4),
      baseDecimals: Number(field(r, 7)),
      quoteDecimals: Number(field(r, 8)),
    })
  }
  return out.sort((a, b) => a.id - b.id)
}

async function readWindow(dir: string): Promise<{ fromUs: bigint; toUs: bigint }> {
  let window: { fromUs: bigint; toUs: bigint } | null = null
  for await (const r of rows(dir, 'coverage')) {
    const w = { fromUs: parseUs(field(r, 1)), toUs: parseUs(field(r, 2)) }
    if (window && (window.fromUs !== w.fromUs || window.toUs !== w.toUs)) {
      throw new RangeError('markets cover different windows; the study compares them side by side')
    }
    window = w
  }
  if (!window) throw new RangeError('coverage table is empty')
  return window
}

interface Book {
  readonly state: State
  readonly market: number
  readonly bids: Level[]
  readonly asks: Level[]
}

async function readBooks(dir: string): Promise<Book[]> {
  const byId = new Map<bigint, Book>()
  for await (const r of rows(dir, 'states')) {
    const id = BigInt(field(r, 0))
    byId.set(id, {
      state: { id, slot: BigInt(field(r, 2)), us: parseUs(field(r, 4)) },
      market: Number(field(r, 1)),
      bids: [],
      asks: [],
    })
  }
  for await (const r of rows(dir, 'levels')) {
    const b = byId.get(BigInt(field(r, 0)))
    if (!b) throw new RangeError(`level of unknown state ${field(r, 0)}`)
    const side = field(r, 2)
    const list = side === 'bid' ? b.bids : side === 'ask' ? b.asks : null
    if (!list) throw new RangeError(`unknown side ${side}`)
    // Levels arrive best first within a state; the index is checked rather than trusted.
    if (Number(field(r, 3)) !== list.length) throw new RangeError(`state ${b.state.id}: level gap`)
    list.push({ price: BigInt(field(r, 4)), size: BigInt(field(r, 5)) })
  }
  // The API's order: first_seen_at, then slot, then id.
  return [...byId.values()].sort(
    (a, b) =>
      cmp(a.state.us, b.state.us) || cmp(a.state.slot, b.state.slot) || cmp(a.state.id, b.state.id),
  )
}

export async function loadDataset(dir: string): Promise<Dataset> {
  const markets = await readMarkets(dir)
  const window = await readWindow(dir)
  const books = await readBooks(dir)
  const out = markets.map((market) => {
    const own = books.filter((b) => b.market === market.id)
    return {
      market,
      states: own.map((b) => b.state),
      snapshots: own.map((b) => ({ t: engineMs(b.state.us), bids: b.bids, asks: b.asks })),
    }
  })
  return { ...window, markets: out }
}

function cmp(a: bigint, b: bigint): number {
  return a < b ? -1 : a > b ? 1 : 0
}
