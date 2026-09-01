import type { LevelResult } from './run.ts'

/**
 * "Cost of 100 ms" (FR-013): the P&L change per 100 ms of delay, with an explicit note
 * of the level range it was computed over.
 */
export interface CostPer100Ms {
  /** Quote atoms per 100 ms; negative — latency costs money. */
  readonly costPer100Ms: bigint
  /** The level range the slope was taken over: from the lowest delay to the last "same strategy" one. */
  readonly fromMs: number
  readonly toMs: number
  /** Levels dropped as "not the same strategy" (unfilled share ≥ threshold). */
  readonly excludedMs: readonly number[]
}

/**
 * Share of unfilled orders in percent: 0…100. An integer, like everything in the engine.
 * Without orders — 0: nothing was tried, nothing failed.
 */
export function unfilledPct(r: LevelResult): number {
  return r.orders === 0 ? 0 : Number((BigInt(r.unfilled) * 100n) / BigInt(r.orders))
}

/**
 * The slope is taken between the lowest level and the highest level up to and including which
 * the share of unfilled orders at every level is below `maxUnfilledPct`.
 * Beyond that the strategy is no longer the same: most orders go unfilled, and the P&L there
 * describes not the delay but its lack of trades. Fewer than two levels — `null`.
 */
export function costPer100Ms(
  results: readonly LevelResult[],
  maxUnfilledPct = 50,
): CostPer100Ms | null {
  const sorted = [...results].sort((a, b) => a.latencyMs - b.latencyMs)
  const kept: LevelResult[] = []
  const excludedMs: number[] = []
  for (const r of sorted) {
    if (excludedMs.length === 0 && unfilledPct(r) < maxUnfilledPct) kept.push(r)
    else excludedMs.push(r.latencyMs)
  }
  const first = kept[0]
  const last = kept[kept.length - 1]
  if (first === undefined || last === undefined || first === last) return null
  const span = BigInt(last.latencyMs - first.latencyMs)
  if (span === 0n) return null
  return {
    costPer100Ms: ((last.pnl - first.pnl) * 100n) / span,
    fromMs: first.latencyMs,
    toMs: last.latencyMs,
    excludedMs,
  }
}
