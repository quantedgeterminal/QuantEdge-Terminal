import {
  type CostPer100Ms,
  costPer100Ms,
  defaultParams,
  findPreset,
  type LevelResult,
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
    const strategy = preset.build(run.params, MARKET_SPEC)
    const results = runBacktest({
      snapshots: rows.map(toSnapshot),
      levelsMs: run.levelsMs,
      market: MARKET_SPEC,
      strategy,
    })
    await repo.finishRun(run.id, results)
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
}

export function toDto(r: LevelResult): LevelResultDto {
  const avgSlippageBp =
    r.filledNotional === 0n ? null : Number((r.slippageSum * 1_000_000n) / r.filledNotional) / 100
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
  }
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
  return {
    id: run.id,
    status: run.status,
    error: run.error,
    market: {
      id: market.id,
      label: market.label,
      baseDecimals: market.baseDecimals,
      quoteDecimals: market.quoteDecimals,
    },
    preset: run.preset,
    params: run.params,
    from: new Date(run.fromMs).toISOString(),
    to: new Date(run.toMs).toISOString(),
    levelsMs: run.levelsMs,
    results: results.map(toDto),
    cost: run.status === 'done' ? costDto(costPer100Ms(results)) : null,
    createdAt: new Date(run.createdAtMs).toISOString(),
    finishedAt: run.finishedAtMs === null ? null : new Date(run.finishedAtMs).toISOString(),
  }
}
