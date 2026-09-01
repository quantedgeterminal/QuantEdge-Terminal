/**
 * Engine types. The package has no dependencies (T004), so a book level is described
 * structurally here: it matches `Level` from `@quantedge/shared` by shape,
 * and a call across the boundary needs no conversion.
 */

/** One book level in the smallest units. */
export interface Level {
  /** Quote atoms per base atom × 10^18 — u128 as on chain. */
  readonly price: bigint
  /** Base atoms. */
  readonly size: bigint
}

/**
 * Book snapshot at `t`. Bids from the best price down, asks from
 * the best up. `t` is epoch milliseconds, an integer; it is the event's `first_seen_at`,
 * i.e. the earliest arrival across the real channels.
 */
export interface Snapshot {
  readonly t: number
  readonly bids: readonly Level[]
  readonly asks: readonly Level[]
}

/** Price scale: quote atoms per base atom × 10^18. */
export const PRICE_SCALE = 10n ** 18n

export type Side = 'buy' | 'sell'

/**
 * Order intent from the strategy. `seenPrice` is the price the strategy saw in
 * the delayed snapshot (`t − Δ`); `limitPrice` is the worst price it is
 * willing to accept. The difference between the fill price and `seenPrice` is slippage
 * (FR-011); nothing within the limit — no fill.
 */
export interface OrderIntent {
  readonly side: Side
  /** Base atoms, > 0. */
  readonly size: bigint
  readonly seenPrice: bigint
  readonly limitPrice: bigint
}

/**
 * Market parameters the strategy needs. There is no tick here: in Manifest a price is
 * mantissa × 10^exp without a step, so tolerances are given in basis points of
 * the seen price, not in ticks.
 */
export interface MarketSpec {
  /** Size step in base atoms; Manifest has no lot — `1n`. */
  readonly lot: bigint
}

/** Basis points per unit: 1 bp = 1/10 000. */
export const BP = 10_000n
