import {
  type CostPer100Ms,
  costPer100Ms,
  defaultParams,
  findPreset,
  type LevelResult,
  medianGapMs,
  runBacktest,
  type Snapshot,
  unfilledPct,
} from '@quantedge/engine'
import { unpackLevels } from '@quantedge/shared'
import type { BookRow, MarketRow, Repo, RunRow } from './repo.ts'

/** Manifest has no lot size; the size rounds to a base atom. */
const MARKET_SPEC = { lot: 1n }

export function toSnapshot(row: BookRow): Snapshot {
  const book = unpackLevels(row.levels)
  return { t: row.tMs, bids: book.bids, asks: book.asks }
}

/**
 * Run execution: read the period once, build the strategy from
 * parameters, compute every level, save. Synchronously within the request:
 * the engine on 41 000 events × 5 levels takes tens of milliseconds; the SC-001 budget goes
 * to reading from the DB.
 */
export async function executeRun(repo: Repo, run: RunRow): Promise<void> {
  const preset = findPreset(run.preset)
  if (!preset) {
    await repo.failRun(run.id, `unknown preset ${run.preset}`)
    return
  }
  try {
    const rows = await repo.bookUpdates(run.marketId, run.fromMs, run.toMs)
    const snapshots = rows.map(toSnapshot)
    const strategy = preset.build(run.params, MARKET_SPEC)
    const results = runBacktest({
      snapshots,
      levelsMs: run.levelsMs,
      market: MARKET_SPEC,
      strategy,
    })
    // The resolution is measured here, where the period is in memory anyway: reading it back
    // later would cost a second full scan of the events for a figure that never changes.
    await repo.finishRun(run.id, results, {
      stepCount: snapshots.length,
      medianGapMs: medianGapMs(snapshots),
    })
  } catch (e) {
    await repo.failRun(run.id, e instanceof Error ? e.message : String(e))
  }
}

/** Full parameters: preset defaults overridden by the request. */
export function mergeParams(
  presetId: string,
  partial: Readonly<Record<string, number>>,
): Record<string, number> {
  const preset = findPreset(presetId)
  if (!preset) throw new RangeError(`unknown preset ${presetId}`)
  return { ...defaultParams(preset.params), ...partial }
}

/** Result row for the client: bigint → decimal string, derived values at the boundary (FR-012). */
export interface LevelResultDto {
  readonly latencyMs: number
  readonly pnl: string
  readonly orders: number
  readonly trades: number
  readonly unfilled: number
  readonly unfilledPct: number
  readonly slippageSum: string
  readonly filledNotional: string
  /** Mean slippage in bp of turnover, two decimals; `null` without turnover. */
  readonly avgSlippageBp: number | null
  readonly maxDrawdown: string
  readonly finalPosition: string
  /** The next-faster level of the same grid this row is measured against; `null` on the fastest. */
  readonly comparedWithMs: number | null
  /** Steps where this level saw a different book state than that one; `null` when not measured. */
  readonly shiftedSteps: number | null
  /**
   * The same as a share of the run's steps, two decimals. `0` is the load-bearing value: the delay
   * never moved the view, so this row repeats the faster one because the data has no finer grain —
   * not because the two delays cost the same.
   */
  readonly shiftedPct: number | null
}

/** What a level row needs from the run it belongs to in order to describe its own resolution. */
export interface LevelContext {
  readonly comparedWithMs: number | null
  readonly steps: number | null
}

export function toDto(r: LevelResult, ctx: LevelContext): LevelResultDto {
  const avgSlippageBp =
    r.filledNotional === 0n ? null : Number((r.slippageSum * 1_000_000n) / r.filledNotional) / 100
  const shiftedPct =
    r.shiftedSteps === null || ctx.steps === null || ctx.steps === 0
      ? null
      : Number((BigInt(r.shiftedSteps) * 10_000n) / BigInt(ctx.steps)) / 100
  return {
    latencyMs: r.latencyMs,
    pnl: r.pnl.toString(),
    orders: r.orders,
    trades: r.trades,
    unfilled: r.unfilled,
    unfilledPct: unfilledPct(r),
    slippageSum: r.slippageSum.toString(),
    filledNotional: r.filledNotional.toString(),
    avgSlippageBp,
    maxDrawdown: r.maxDrawdown.toString(),
    finalPosition: r.finalPosition.toString(),
    comparedWithMs: ctx.comparedWithMs,
    shiftedSteps: r.shiftedSteps,
    shiftedPct,
  }
}

/**
 * Which level each row is compared with: the next-faster one of the same grid. Storage keys
 * results by `(run, latencyMs)`, so the levels here are distinct and the order is a total one.
 */
export function comparedWith(results: readonly LevelResult[]): Map<number, number | null> {
  const ascending = [...results].sort((a, b) => a.latencyMs - b.latencyMs)
  const out = new Map<number, number | null>()
  let faster: number | null = null
  for (const r of ascending) {
    out.set(r.latencyMs, faster)
    faster = r.latencyMs
  }
  return out
}

export interface CostDto {
  readonly costPer100Ms: string
  readonly fromMs: number
  readonly toMs: number
  readonly excludedMs: readonly number[]
}

export function costDto(c: CostPer100Ms | null): CostDto | null {
  return c === null ? null : { ...c, costPer100Ms: c.costPer100Ms.toString() }
}

export function runDto(run: RunRow, market: MarketRow, results: readonly LevelResult[]) {
  const faster = comparedWith(results)
  const steps = run.resolution?.stepCount ?? null
  return {
    id: run.id,
    status: run.status,
    error: run.error,
    market: {
      id: market.id,
      label: market.label,
      baseDecimals: market.baseDecimals,
      quoteDecimals: market.quoteDecimals,
      baseSymbol: market.baseSymbol,
      quoteSymbol: market.quoteSymbol,
    },
    preset: run.preset,
    params: run.params,
    from: new Date(run.fromMs).toISOString(),
    to: new Date(run.toMs).toISOString(),
    levelsMs: run.levelsMs,
    results: results.map((r) =>
      toDto(r, { comparedWithMs: faster.get(r.latencyMs) ?? null, steps }),
    ),
    cost: run.status === 'done' ? costDto(costPer100Ms(results)) : null,
    /** What the period's own grain allows the grid above to say (FR-013a). */
    resolution:
      run.resolution === null
        ? null
        : { steps: run.resolution.stepCount, medianGapMs: run.resolution.medianGapMs },
    createdAt: new Date(run.createdAtMs).toISOString(),
    finishedAt: run.finishedAtMs === null ? null : new Date(run.finishedAtMs).toISOString(),
  }
}
