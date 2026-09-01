import type { ParamSpec } from '../strategy.ts'
import type { Level, Side, Snapshot } from '../types.ts'
import type { Signal } from './common.ts'

export const imbalanceParams: readonly ParamSpec[] = [
  { key: 'triggerPct', label: 'Imbalance trigger', unit: '%', min: 51, max: 100, default: 65 },
  { key: 'depthLevels', label: 'Depth', unit: 'levels', min: 1, max: 15, default: 5 },
]

function sumSize(levels: readonly Level[], depth: number): bigint {
  let s = 0n
  const n = levels.length < depth ? levels.length : depth
  for (let i = 0; i < n; i++) s += levels[i]?.size ?? 0n
  return s
}

/**
 * Depth imbalance: the bid share of the total top-N size. Bids dominating
 * above the threshold — buy (upward pressure), asks — sell. Latency sensitivity:
 * the imbalance seen at `t − Δ` has already played out by `t` — the level is gone.
 */
export function imbalanceSignal(triggerPct: number, depthLevels: number): Signal<null> {
  const trigger = BigInt(triggerPct)
  return {
    init: () => null,
    signal(view: Snapshot) {
      const bid = sumSize(view.bids, depthLevels)
      const ask = sumSize(view.asks, depthLevels)
      const total = bid + ask
      let side: Side | null = null
      if (total > 0n) {
        if (bid * 100n >= trigger * total) side = 'buy'
        else if (ask * 100n >= trigger * total) side = 'sell'
      }
      return { state: null, side }
    },
  }
}
