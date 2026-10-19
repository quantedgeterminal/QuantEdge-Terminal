import type { Snapshot } from '@quantedge/engine'
import type { MarketData } from './load.ts'

export const HOUR_US = 3_600_000_000n

/**
 * A set of equal windows laid from the start of the reference. Two sets are used:
 *
 * - **A** — 10 × 6 h, each starting an hour after the previous one. The method of the first
 *   measurement; neighbouring windows share five of their six hours, so ten of them are not ten
 *   independent samples.
 * - **B** — 10 × 1.5 h back to back. Independent samples; the sign test and the standard error are
 *   read on these.
 */
export interface WindowSet {
  readonly name: 'A' | 'B'
  readonly count: number
  readonly lengthUs: bigint
  readonly strideUs: bigint
}

export const WINDOW_SETS: readonly WindowSet[] = [
  { name: 'A', count: 10, lengthUs: 6n * HOUR_US, strideUs: HOUR_US },
  { name: 'B', count: 10, lengthUs: (3n * HOUR_US) / 2n, strideUs: (3n * HOUR_US) / 2n },
]

export interface Window {
  readonly fromUs: bigint
  readonly toUs: bigint
}

export function windows(set: WindowSet, startUs: bigint, endUs: bigint): Window[] {
  const out: Window[] = []
  for (let k = 0n; k < BigInt(set.count); k++) {
    const fromUs = startUs + k * set.strideUs
    const toUs = fromUs + set.lengthUs
    if (toUs > endUs) throw new RangeError(`window set ${set.name} runs past the reference`)
    out.push({ fromUs, toUs })
  }
  return out
}

/**
 * The states of `[from, to)`, cut on microseconds. Cutting on the engine's milliseconds would move
 * a state sitting within a millisecond of a boundary into the wrong window.
 */
export function cut(data: MarketData, w: Window): Snapshot[] {
  const out: Snapshot[] = []
  data.states.forEach((s, i) => {
    const snap = data.snapshots[i]
    if (snap !== undefined && s.us >= w.fromUs && s.us < w.toUs) out.push(snap)
  })
  return out
}
