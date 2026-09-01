import type { Decision, ParamSpec, ParamValues, Strategy, StrategyContext } from '../strategy.ts'
import { BP, type OrderIntent, PRICE_SCALE, type Side, type Snapshot } from '../types.ts'

/**
 * Shared skeleton of the taker presets: a signal opens a position with a taker
 * order at the price it sees, and after `holdMs` the position is closed the same way.
 * Presets differ only in the signal. Latency bites twice: on entry (the level
 * that was seen is gone by arrival) and on exit (the same).
 */
export interface Signal<S> {
  init(): S
  /** Which way to enter from flat; `null` — do not enter. */
  signal(view: Snapshot, state: S, ctx: StrategyContext): { state: S; side: Side | null }
}

/** Parameters shared by all taker presets. */
export const commonParams: readonly ParamSpec[] = [
  {
    key: 'notionalQuote',
    label: 'Order size',
    unit: 'quote atoms',
    min: 1,
    max: 1_000_000_000_000_000,
    default: 100_000_000,
  },
  { key: 'holdMs', label: 'Hold time', unit: 'ms', min: 0, max: 3_600_000, default: 800 },
  { key: 'maxSlippageBp', label: 'Max slippage', unit: 'bp', min: 0, max: 10_000, default: 10 },
]

export interface HoldState<S> {
  readonly inner: S
  /** Moment the position first became non-zero; `null` — flat. */
  readonly entryT: number | null
  /** Last snapshot the signal was evaluated on (by identity, since `t` may coincide). */
  readonly lastView: Snapshot | null
}

/** Size in base atoms for a given quote amount, rounded down to the lot. */
export function sizeForNotional(notionalQuote: bigint, price: bigint, lot: bigint): bigint {
  if (price <= 0n) return 0n
  const raw = (notionalQuote * PRICE_SCALE) / price
  return raw - (raw % lot)
}

function abs(v: bigint): bigint {
  return v < 0n ? -v : v
}

/** The limit is the seen price shifted by `slippageBp` towards worse; rounding in the strategy's favour. */
function takerOrder(
  view: Snapshot,
  side: Side,
  size: bigint,
  slippageBp: bigint,
): OrderIntent | null {
  const best = side === 'buy' ? view.asks[0] : view.bids[0]
  if (best === undefined || size <= 0n) return null
  const limitPrice =
    side === 'buy' ? (best.price * (BP + slippageBp)) / BP : (best.price * (BP - slippageBp)) / BP
  return { side, size, seenPrice: best.price, limitPrice }
}

export function holdAndExit<S>(signal: Signal<S>, params: ParamValues): Strategy<HoldState<S>> {
  const notional = BigInt(params.notionalQuote ?? 0)
  const holdMs = params.holdMs ?? 0
  const slippageBp = BigInt(params.maxSlippageBp ?? 0)
  const none = (state: HoldState<S>): Decision<HoldState<S>> => ({ state, orders: [] })

  // In a position: wait out the hold, then exit as a taker. An unfilled exit
  // is retried on the next step — the position simply stays non-zero.
  function inPosition(view: Snapshot, state: HoldState<S>, ctx: StrategyContext) {
    const entryT = state.entryT ?? ctx.now
    const next = state.entryT === entryT ? state : { ...state, entryT }
    if (ctx.now - entryT < holdMs) return none(next)
    const side: Side = ctx.position > 0n ? 'sell' : 'buy'
    const order = takerOrder(view, side, abs(ctx.position), slippageBp)
    return { state: next, orders: order ? [order] : [] }
  }

  // Flat position. The signal is evaluated once per snapshot: a slow trader sees
  // the same snapshot for several steps in a row and has nothing to base a new decision on.
  function flat(view: Snapshot, state: HoldState<S>, ctx: StrategyContext) {
    const reset = state.entryT === null ? state : { ...state, entryT: null }
    if (reset.lastView === view) return none(reset)
    const s = signal.signal(view, reset.inner, ctx)
    const next = { ...reset, inner: s.state, lastView: view }
    const best = s.side === 'buy' ? view.asks[0] : view.bids[0]
    if (s.side === null || best === undefined) return none(next)
    const size = sizeForNotional(notional, best.price, ctx.market.lot)
    const order = takerOrder(view, s.side, size, slippageBp)
    return { state: next, orders: order ? [order] : [] }
  }

  return {
    init: () => ({ inner: signal.init(), entryT: null, lastView: null }),
    decide: (view, state, ctx) =>
      ctx.position !== 0n ? inPosition(view, state, ctx) : flat(view, state, ctx),
  }
}
