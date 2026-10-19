import { delayedIndex, medianGapMs, type Snapshot } from '@quantedge/engine'
import type { MarketData } from './load.ts'

/**
 * How finely the data can tell delays apart. This is the study's central finding: a delay shorter
 * than the gap between book states sees the same state, whatever its size.
 */
export interface Grain {
  readonly states: number
  readonly medianGapMs: number | null
  /** States per distinct slot; `1` means every state is its own slot, the method's ceiling. */
  readonly statesPerSlot: number
  /** Per level of the grid: the share of steps (%) where it sees another state than 0 ms does. */
  readonly shiftedFromZeroPct: readonly number[]
  /** Per level: the share of steps (%) where it sees another state than the next-faster level. */
  readonly shiftedFromFasterPct: readonly (number | null)[]
}

function pct(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part * 10_000) / whole) / 100
}

export function grain(data: MarketData, levelsMs: readonly number[]): Grain {
  const snaps: readonly Snapshot[] = data.snapshots
  const cursors = levelsMs.map(() => -1)
  const fromZero = levelsMs.map(() => 0)
  const fromFaster = levelsMs.map(() => 0)
  for (let i = 0; i < snaps.length; i++) {
    levelsMs.forEach((ms, k) => {
      cursors[k] = delayedIndex(snaps, i, ms, cursors[k] ?? -1)
    })
    levelsMs.forEach((_, k) => {
      if (cursors[k] !== cursors[0]) fromZero[k] = (fromZero[k] ?? 0) + 1
      if (k > 0 && cursors[k] !== cursors[k - 1]) fromFaster[k] = (fromFaster[k] ?? 0) + 1
    })
  }
  const slots = new Set(data.states.map((s) => s.slot)).size
  return {
    states: snaps.length,
    medianGapMs: medianGapMs(snaps),
    statesPerSlot: slots === 0 ? 0 : Math.round((snaps.length * 1000) / slots) / 1000,
    shiftedFromZeroPct: fromZero.map((n) => pct(n, snaps.length)),
    shiftedFromFasterPct: fromFaster.map((n, k) => (k === 0 ? null : pct(n, snaps.length))),
  }
}
