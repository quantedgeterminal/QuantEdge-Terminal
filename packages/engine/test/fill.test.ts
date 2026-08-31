import { describe, expect, it } from 'vitest'
import { execute } from '../src/fill.ts'
import { type Level, PRICE_SCALE, type Snapshot } from '../src/types.ts'

/** Price in quote atoms per base atom (integer), scaled to u128. */
const px = (n: number | bigint): bigint => BigInt(n) * PRICE_SCALE
const lvl = (price: number | bigint, size: number | bigint): Level => ({
  price: px(price),
  size: BigInt(size),
})

const book: Snapshot = {
  t: 0,
  bids: [lvl(99, 10), lvl(98, 20), lvl(97, 30)],
  asks: [lvl(101, 10), lvl(102, 20), lvl(103, 30)],
}

describe('execute (FR-011) — taker with a limit', () => {
  it('Δ = 0: saw what is there — zero slippage', () => {
    const e = execute(book, { side: 'buy', size: 5n, seenPrice: px(101), limitPrice: px(101) })
    expect(e).toEqual({ filled: 5n, notional: 505n, slippage: 0n, worstPrice: px(101) })
  })

  it('the level is gone, the next is within the limit — filled worse, positive slippage', () => {
    const moved: Snapshot = { ...book, asks: [lvl(102, 20), lvl(103, 30)] }
    const e = execute(moved, { side: 'buy', size: 5n, seenPrice: px(101), limitPrice: px(102) })
    expect(e.filled).toBe(5n)
    expect(e.notional).toBe(510n)
    expect(e.slippage).toBe(5n) // (102 − 101) × 5
    expect(e.worstPrice).toBe(px(102))
  })

  it('the level is gone, nothing within the limit — no fill', () => {
    const moved: Snapshot = { ...book, asks: [lvl(103, 30)] }
    const e = execute(moved, { side: 'buy', size: 5n, seenPrice: px(101), limitPrice: px(102) })
    expect(e).toEqual({ filled: 0n, notional: 0n, slippage: 0n, worstPrice: null })
  })

  it('the market moved in our favour — negative slippage, the limit does not interfere', () => {
    const better: Snapshot = { ...book, bids: [lvl(100, 10), ...book.bids] }
    const e = execute(better, { side: 'sell', size: 4n, seenPrice: px(99), limitPrice: px(98) })
    expect(e.filled).toBe(4n)
    expect(e.notional).toBe(400n)
    expect(e.slippage).toBe(-4n)
  })

  it('an order walks several levels and stops at the limit — partial fill', () => {
    const e = execute(book, { side: 'sell', size: 50n, seenPrice: px(99), limitPrice: px(98) })
    expect(e.filled).toBe(30n) // 10 @ 99 + 20 @ 98; 97 is beyond the limit
    expect(e.notional).toBe(990n + 1960n)
    expect(e.slippage).toBe(20n) // (99 − 98) × 20
    expect(e.worstPrice).toBe(px(98))
  })

  it('an empty book side — no fill', () => {
    const empty: Snapshot = { t: 0, bids: [], asks: [] }
    const e = execute(empty, { side: 'buy', size: 1n, seenPrice: px(101), limitPrice: px(999) })
    expect(e.filled).toBe(0n)
  })

  it('rounding: a buy pays the ceiling, a sell receives the floor', () => {
    // price 1.5 quote atoms per base atom × 1 atom → 1.5
    const half = PRICE_SCALE + PRICE_SCALE / 2n
    const b: Snapshot = {
      t: 0,
      bids: [{ price: half, size: 1n }],
      asks: [{ price: half, size: 1n }],
    }
    const buy = execute(b, { side: 'buy', size: 1n, seenPrice: half, limitPrice: half })
    const sell = execute(b, { side: 'sell', size: 1n, seenPrice: half, limitPrice: half })
    expect(buy.notional).toBe(2n)
    expect(sell.notional).toBe(1n)
  })

  it('size ≤ 0 is an error, not a silent zero', () => {
    expect(() =>
      execute(book, { side: 'buy', size: 0n, seenPrice: px(101), limitPrice: px(101) }),
    ).toThrow(RangeError)
  })

  it('does not depend on how many times it is called (pure function)', () => {
    const order = { side: 'buy' as const, size: 15n, seenPrice: px(101), limitPrice: px(103) }
    const a = execute(book, order)
    const b = execute(book, order)
    expect(a).toEqual(b)
    expect(book.asks[0]?.size).toBe(10n) // the book is unchanged
  })
})
