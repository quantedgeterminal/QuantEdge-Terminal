import { execute } from './fill.ts'
import { assertOrdered, delayedIndex } from './latency.ts'
import type { Strategy } from './strategy.ts'
import { type MarketSpec, PRICE_SCALE, type Snapshot } from './types.ts'

export interface RunInput {
  /** Snapshots of the period in non-decreasing `t` order. Read once for all levels. */
  readonly snapshots: readonly Snapshot[]
  /** Delay levels in ms; any order, the result comes back in the same order. */
  readonly levelsMs: readonly number[]
  readonly market: MarketSpec
  readonly strategy: Strategy<unknown>
}

/** Result of one delay level (FR-012). Money is quote atoms, `bigint`. */
export interface LevelResult {
  readonly latencyMs: number
  /** Cash plus the position marked at the last book mid. */
  readonly pnl: bigint
  /** Orders filled at least partially. */
  readonly trades: number
  /** All orders sent. */
  readonly orders: number
  /** Orders with no fill at all. */
  readonly unfilled: number
  /** Signed slippage total (quote atoms). The mean is taken at the API boundary. */
  readonly slippageSum: bigint
  /** Filled turnover total (quote atoms); the denominator for slippage in bp. */
  readonly filledNotional: bigint
  /** Largest equity drop from the previous peak (quote atoms, ≥ 0). */
  readonly maxDrawdown: bigint
  /** Position at the end of the period in base atoms; non-zero — marked at mid. */
  readonly finalPosition: bigint
}

/** One level's account: what changes on every step. */
interface Ledger {
  cursor: number
  state: unknown
  cash: bigint
  position: bigint
  trades: number
  orders: number
  unfilled: number
  slippageSum: bigint
  filledNotional: bigint
  peak: bigint
  maxDrawdown: bigint
}

function midOf(s: Snapshot): bigint | null {
  const b = s.bids[0]
  const a = s.asks[0]
  if (b === undefined || a === undefined) return null
  return (b.price + a.price) / 2n
}

function equity(l: Ledger, mid: bigint | null): bigint {
  return mid === null ? l.cash : l.cash + (l.position * mid) / PRICE_SCALE
}

/**
 * A run (FR-008, FR-009): one pass over the data, `N` independent states — one
 * per delay level. At step `i` every level sees its own delayed
 * snapshot (FR-010) and is filled against snapshot `i` (FR-011). The data is the same for every
 * level by construction, so the only difference between rows is the delay.
 *
 * No I/O, clock or randomness: the same inputs → the same output (SC-002).
 */
export function runBacktest(input: RunInput): LevelResult[] {
  const { snapshots, levelsMs, market, strategy } = input
  assertOrdered(snapshots)
  for (const ms of levelsMs) {
    if (!Number.isInteger(ms) || ms < 0)
      throw new RangeError(`delay level must be an integer ≥ 0: ${ms}`)
  }

  const ledgers = levelsMs.map((delayMs) => ({ delayMs, ledger: freshLedger(strategy.init()) }))
  let lastMid: bigint | null = null

  for (let i = 0; i < snapshots.length; i++) {
    const now = snapshots[i]
    if (now === undefined) continue
    lastMid = midOf(now) ?? lastMid
    for (const { delayMs, ledger } of ledgers) {
      step(ledger, delayMs, snapshots, i, now, lastMid, market, strategy)
    }
  }

  return ledgers.map(({ delayMs, ledger: l }) => ({
    latencyMs: delayMs,
    pnl: equity(l, lastMid),
    trades: l.trades,
    orders: l.orders,
    unfilled: l.unfilled,
    slippageSum: l.slippageSum,
    filledNotional: l.filledNotional,
    maxDrawdown: l.maxDrawdown,
    finalPosition: l.position,
  }))
}

function freshLedger(state: unknown): Ledger {
  return {
    cursor: -1,
    state,
    cash: 0n,
    position: 0n,
    trades: 0,
    orders: 0,
    unfilled: 0,
    slippageSum: 0n,
    filledNotional: 0n,
    peak: 0n,
    maxDrawdown: 0n,
  }
}

/** One step of one level: delayed snapshot → decision → fill at `now` → equity accounting. */
function step(
  l: Ledger,
  delayMs: number,
  snapshots: readonly Snapshot[],
  i: number,
  now: Snapshot,
  lastMid: bigint | null,
  market: MarketSpec,
  strategy: Strategy<unknown>,
): void {
  l.cursor = delayedIndex(snapshots, i, delayMs, l.cursor)
  const view = l.cursor < 0 ? undefined : snapshots[l.cursor]
  if (view !== undefined) {
    const decision = strategy.decide(view, l.state, { now: now.t, position: l.position, market })
    l.state = decision.state
    for (const order of decision.orders) settle(l, now, order)
  }
  const eq = equity(l, lastMid)
  if (eq > l.peak) l.peak = eq
  const dd = l.peak - eq
  if (dd > l.maxDrawdown) l.maxDrawdown = dd
}

function settle(l: Ledger, book: Snapshot, order: Parameters<typeof execute>[1]): void {
  const e = execute(book, order)
  l.orders++
  if (e.filled === 0n) {
    l.unfilled++
    return
  }
  l.trades++
  if (order.side === 'buy') {
    l.cash -= e.notional
    l.position += e.filled
  } else {
    l.cash += e.notional
    l.position -= e.filled
  }
  l.slippageSum += e.slippage
  l.filledNotional += e.notional
}
