import type { ParamSpec } from '../strategy.ts'
import type { Level, Side, Snapshot } from '../types.ts'
import type { Signal } from './common.ts'

export const depletionParams: readonly ParamSpec[] = [
  { key: 'thinRatioPct', label: 'Thin level ratio', unit: '%', min: 1, max: 100, default: 20 },
]

function isThin(best: Level | undefined, next: Level | undefined, ratio: bigint): boolean {
  if (best === undefined || next === undefined || next.size === 0n) return false
  return best.size * 100n <= ratio * next.size
}

/**
 * Queue depletion: the best level turned thin against the next one — it is
 * about to be taken out, and the price will move a tick. Take it while it is there. This is
 * the most direct check of FR-011: with latency the level that was seen disappears
 * before the order arrives.
 */
export function depletionSignal(thinRatioPct: number): Signal<null> {
  const ratio = BigInt(thinRatioPct)
  return {
    init: () => null,
    signal(view: Snapshot) {
      const askThin = isThin(view.asks[0], view.asks[1], ratio)
      const bidThin = isThin(view.bids[0], view.bids[1], ratio)
      let side: Side | null = null
      if (askThin && !bidThin) side = 'buy'
      else if (bidThin && !askThin) side = 'sell'
      return { state: null, side }
    },
  }
}
