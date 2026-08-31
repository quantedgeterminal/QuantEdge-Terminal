import type { Snapshot } from './types.ts'

/**
 * Latency model (FR-010). Latency shifts the decision moment: at step `i`
 * (filled against the state at `t_i`) the strategy sees the latest snapshot `j ≤ i`
 * for which `t_j ≤ t_i − Δ`. This is the only place where the delay level affects
 * the result; from there every level takes the same path.
 *
 * `Δ = 0` gives `j = i`: the strategy sees what it is filled against, and slippage
 * is impossible by construction — that is the table's baseline row.
 *
 * The `j ≤ i` bound matters for equal `t`: without it, at `Δ = 0` the strategy
 * would see a later event with the same `t`, i.e. the future in array order.
 *
 * Snapshots must come in non-decreasing `t` order; the function does not check this on
 * every call — `assertOrdered` does it once before the run.
 */
export function delayedIndex(
  snapshots: readonly Snapshot[],
  i: number,
  delayMs: number,
  prev: number,
): number {
  const now = snapshots[i]
  if (now === undefined) throw new RangeError(`step ${i} out of bounds (${snapshots.length})`)
  const seenUntil = now.t - delayMs
  // The cursor is monotonic: once seen never disappears, so we only move forward from prev.
  let j = prev < 0 ? -1 : prev
  while (j + 1 <= i) {
    const next = snapshots[j + 1]
    if (next === undefined || next.t > seenUntil) break
    j++
  }
  return j
}

/** Snapshots must come in non-decreasing `t` order, otherwise the `t − Δ` shift is meaningless. */
export function assertOrdered(snapshots: readonly Snapshot[]): void {
  for (let i = 1; i < snapshots.length; i++) {
    const a = snapshots[i - 1]
    const b = snapshots[i]
    if (a === undefined || b === undefined) continue
    if (b.t < a.t)
      throw new RangeError(`snapshots are not ordered: t[${i}]=${b.t} < t[${i - 1}]=${a.t}`)
  }
}
