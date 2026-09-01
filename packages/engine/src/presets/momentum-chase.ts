import type { ParamSpec } from '../strategy.ts'
import type { Side, Snapshot } from '../types.ts'
import type { Signal } from './common.ts'

export const momentumParams: readonly ParamSpec[] = [
  { key: 'moveTicks', label: 'Move threshold', unit: 'ticks', min: 1, max: 1000, default: 3 },
  { key: 'windowMs', label: 'Window', unit: 'ms', min: 1, max: 60_000, default: 500 },
]

interface Point {
  readonly t: number
  readonly mid: bigint
}

export interface MomentumState {
  /** Mids over the window, oldest to newest. */
  readonly points: readonly Point[]
}

function mid(view: Snapshot): bigint | null {
  const b = view.bids[0]
  const a = view.asks[0]
  if (b === undefined || a === undefined) return null
  return (b.price + a.price) / 2n
}

/**
 * Momentum chase: the mid moved by ≥ `moveTicks` within `windowMs` —
 * enter in the direction of the move. Latency sensitivity: the move seen at `t − Δ`
 * has gone further by `t`; the entry price is worse or the level is gone.
 */
export function momentumSignal(
  moveTicks: number,
  windowMs: number,
  tick: bigint,
): Signal<MomentumState> {
  const threshold = BigInt(moveTicks) * tick
  return {
    init: () => ({ points: [] }),
    signal(view, state) {
      const m = mid(view)
      if (m === null) return { state, side: null }
      const last = state.points[state.points.length - 1]
      if (last !== undefined && last.t === view.t) return { state, side: null }

      // Keep only points no older than the window; the array is small (a few dozen).
      const kept = state.points.filter((p) => view.t - p.t <= windowMs)
      const points = [...kept, { t: view.t, mid: m }]
      const oldest = points[0]
      let side: Side | null = null
      if (oldest !== undefined && points.length > 1) {
        const move = m - oldest.mid
        if (move >= threshold) side = 'buy'
        else if (-move >= threshold) side = 'sell'
      }
      return { state: { points }, side }
    },
  }
}
