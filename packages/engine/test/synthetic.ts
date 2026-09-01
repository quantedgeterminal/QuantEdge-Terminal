import { type Level, type MarketSpec, PRICE_SCALE, type Snapshot } from '../src/types.ts'

export const px = (n: number | bigint): bigint => BigInt(n) * PRICE_SCALE
export const lvl = (price: number, size: number): Level => ({
  price: px(price),
  size: BigInt(size),
})
export const market: MarketSpec = { tick: px(1), lot: 1n }

/** Indexing without `!`: a missing element is a test error, not `undefined`. */
export function at<T>(arr: readonly T[], i: number): T {
  const v = arr[i]
  if (v === undefined) throw new Error(`no element ${i}`)
  return v
}

/** Seeded mulberry32 — the synthetic market is reproducible. */
export function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Synthetic book: a random walk of the mid in ticks, 5 levels per side,
 * 10–50 ms between events, and now and then a thin best level that vanishes on
 * the next event. Enough for all three signals to fire.
 */
export function synthetic(seed: number, n: number): Snapshot[] {
  const next = rng(seed)
  const out: Snapshot[] = []
  let t = 0
  let ask = 1000
  for (let i = 0; i < n; i++) {
    t += 10 + Math.floor(next() * 40)
    const r = next()
    if (r < 0.25) ask += 1
    else if (r < 0.5) ask -= 1
    const thinAsk = next() < 0.15
    const thinBid = !thinAsk && next() < 0.15
    const asks = side(next, ask, 1, thinAsk)
    const bids = side(next, ask - 1, -1, thinBid)
    // Imbalance: now and then one side is noticeably heavier.
    if (next() < 0.2) heavier(next() < 0.5 ? asks : bids)
    out.push({ t, asks, bids })
  }
  return out
}

/** Five levels from `best` in direction `dir`; the first is thin if `thin`. */
function side(next: () => number, best: number, dir: 1 | -1, thin: boolean): Level[] {
  return Array.from({ length: 5 }, (_, k) => {
    const size = k === 0 && thin ? 1 + Math.floor(next() * 3) : 20 + Math.floor(next() * 80)
    return lvl(best + dir * k, size)
  })
}

function heavier(levels: Level[]): void {
  for (let k = 0; k < 3; k++) {
    const l = levels[k]
    if (l) levels[k] = { price: l.price, size: l.size * 4n }
  }
}

/** bigint does not serialise with JSON.stringify — substitute a string. */
export function serialize(v: unknown): string {
  return JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? `${x}n` : x))
}
