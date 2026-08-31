import { type OrderIntent, PRICE_SCALE, type Snapshot } from './types.ts'

/** Result of filling one order against the book state at arrival. */
export interface Execution {
  /** Base atoms filled; 0 — no fill. */
  readonly filled: bigint
  /** Quote atoms paid (buy) or received (sell). */
  readonly notional: bigint
  /**
   * Slippage against `seenPrice`, in quote atoms, signed: positive is worse
   * than the strategy saw; negative is better. Summed over the book levels the order walked.
   */
  readonly slippage: bigint
  /** Worst price at which part of the order went through; `null` on no fill. */
  readonly worstPrice: bigint | null
}

const NONE: Execution = { filled: 0n, notional: 0n, slippage: 0n, worstPrice: null }

function ceilDiv(a: bigint, b: bigint): bigint {
  return (a + b - 1n) / b
}

/**
 * Fill model (FR-011): a taker order with a limit against the book at
 * the arrival moment `t`. The order walks the levels from the best while the price is no worse
 * than `limitPrice` and the size is not exhausted. A level the strategy saw at
 * `t − Δ` may be gone by `t` — then the price is worse (slippage) or within
 * the limit there is nothing (no fill).
 *
 * Rounding is conservative: a buy pays the ceiling, a sell receives the floor.
 * This is a fixed order of integer operations — a condition of SC-002.
 */
export function execute(book: Snapshot, order: OrderIntent): Execution {
  if (order.size <= 0n) throw new RangeError(`order size must be > 0: ${order.size}`)
  // The side sets the book side, the "worse" sign and the rounding direction.
  const sign = order.side === 'buy' ? 1n : -1n
  const levels = order.side === 'buy' ? book.asks : book.bids

  let remaining = order.size
  let notional = 0n
  let slippage = 0n
  let worstPrice: bigint | null = null

  for (const level of levels) {
    if (remaining === 0n) break
    if (level.size <= 0n) continue
    // For a buy the price must be ≤ the limit, for a sell ≥; the sign folds both into one.
    if ((level.price - order.limitPrice) * sign > 0n) break

    const qty = level.size < remaining ? level.size : remaining
    const gross = level.price * qty
    notional += sign > 0n ? ceilDiv(gross, PRICE_SCALE) : gross / PRICE_SCALE
    slippage += ((level.price - order.seenPrice) * sign * qty) / PRICE_SCALE
    worstPrice = level.price
    remaining -= qty
  }

  const filled = order.size - remaining
  if (filled === 0n) return NONE
  return { filled, notional, slippage, worstPrice }
}
