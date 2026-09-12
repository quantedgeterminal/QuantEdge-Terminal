import { randomUUID } from 'node:crypto'
import { serve } from '@hono/node-server'
import { PRICE_SCALE } from '@quantedge/engine'
import { type Level, packLevels } from '@quantedge/shared'
import { createApp } from './app.ts'
import { MemoryRepo } from './memory-repo.ts'

/**
 * Stand without Postgres: the same app over `MemoryRepo` with a synthetic
 * market. For working on the screens while there are no DB keys. The numbers are made up —
 * and they never leave this process.
 */

function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const QUOTE_DECIMALS = 6
const BASE_DECIMALS = 8
// cbBTC ≈ 110 000 USDC: quote atoms per base atom × 10^18 = 110000 × 10^6 / 10^8 × 10^18
const START_PRICE =
  (110_000n * 10n ** BigInt(QUOTE_DECIMALS) * PRICE_SCALE) / 10n ** BigInt(BASE_DECIMALS)
const STEP = START_PRICE / 20_000n // 0,5 bp

function synthetic(seed: number, fromMs: number, toMs: number) {
  const next = rng(seed)
  const rows = []
  let t = fromMs
  let ask = START_PRICE
  const lvl = (price: bigint, size: number): Level => ({ price, size: BigInt(size) })
  while (t < toMs) {
    t += 300 + Math.floor(next() * 900)
    const r = next()
    if (r < 0.3) ask += STEP
    else if (r < 0.6) ask -= STEP
    const thinAsk = next() < 0.2
    const thinBid = !thinAsk && next() < 0.2
    const size = () => 200_000 + Math.floor(next() * 2_000_000) // 0,002–0,02 BTC
    const asks = Array.from({ length: 10 }, (_, k) =>
      lvl(ask + BigInt(k) * STEP, k === 0 && thinAsk ? 10_000 : size()),
    )
    const bids = Array.from({ length: 10 }, (_, k) =>
      lvl(ask - BigInt(k + 1) * STEP, k === 0 && thinBid ? 10_000 : size()),
    )
    rows.push({ tMs: t, levels: packLevels({ bids, asks }) })
  }
  return rows
}

const repo = new MemoryRepo()
repo.markets.push({
  id: 1,
  venue: 'manifest',
  address: 'Bey9vLeeWbMpeUvj7eqxnJAtHtZePq6JbLSKpo3RCq8n',
  label: 'cbBTC/USDC',
  baseDecimals: BASE_DECIMALS,
  quoteDecimals: QUOTE_DECIMALS,
  baseSymbol: 'cbBTC',
  quoteSymbol: 'USDC',
  active: true,
})
const day = Date.parse('2026-09-01T00:00:00Z')
const H = 3_600_000
const segments = [
  [day + 8 * H, day + 14 * H],
  [day + 16 * H, day + 18 * H],
] as const
const books = segments.flatMap(([a, b], i) => synthetic(7 + i, a, b))
repo.books.set(1, books)
repo.coverageRows.set(
  1,
  segments.map(([a, b]) => ({
    fromMs: a,
    toMs: b,
    updateCount: books.filter((r) => r.tMs >= a && r.tMs <= b).length,
  })),
)

// Live tail for the terminal: a new event every second, two "real" channels lagging 20–80 ms.
repo.pathRows.push(
  { id: 1, name: 'helius', kind: 'real' },
  { id: 2, name: 'alchemy', kind: 'real' },
)
const live = rng(99)
let liveAsk = START_PRICE
let liveId = 1_000_000n
setInterval(() => {
  const now = Date.now()
  const r = live()
  if (r < 0.3) liveAsk += STEP
  else if (r < 0.6) liveAsk -= STEP
  const size = () => 200_000 + Math.floor(live() * 2_000_000)
  const asks = Array.from({ length: 10 }, (_, k) => ({
    price: liveAsk + BigInt(k) * STEP,
    size: BigInt(size()),
  }))
  const bids = Array.from({ length: 10 }, (_, k) => ({
    price: liveAsk - BigInt(k + 1) * STEP,
    size: BigInt(size()),
  }))
  books.push({ tMs: now, levels: packLevels({ bids, asks }) })
  const lagMs = 20 + Math.floor(live() * 60)
  const arrivals = repo.arrivalRows.get(1) ?? []
  arrivals.push(
    { bookUpdateId: liveId, pathId: 1, receivedAtUs: BigInt(now) * 1000n, tMs: now },
    { bookUpdateId: liveId, pathId: 2, receivedAtUs: BigInt(now + lagMs) * 1000n, tMs: now },
  )
  repo.arrivalRows.set(1, arrivals.slice(-400))
  liveId++
}, 1000)

const app = createApp(repo, randomUUID)
const port = Number(process.env.PORT ?? 8879)
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`api (memory stand, ${books.length} synthetic updates) listening on :${info.port}`)
})
