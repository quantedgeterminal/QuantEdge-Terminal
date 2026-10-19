import {
  costPer100Ms,
  defaultParams,
  type LevelResult,
  type PresetId,
  presets,
  runBacktest,
  type Strategy,
} from '@quantedge/engine'
import { type Grain, grain } from './grain.ts'
import type { Dataset, MarketData } from './load.ts'
import { STALE_EDGES_BP, staleQuote } from './stale-quote.ts'
import { mean, round, type SignTest, sampleSd, signTest, tStat } from './stats.ts'
import { cut, WINDOW_SETS, type WindowSet, windows } from './windows.ts'

/**
 * The whole study as one pure function of the dataset: every figure the research page quotes
 * comes out of `runStudy`, and nothing else is written into the page by hand.
 */

/** The delay grid of every run, ms. The effect is `P&L(0) − P&L(400)`. */
export const GRID: readonly number[] = [0, 50, 100, 200, 400]

/** A wide grid for the one question it answers: how the slope depends on where the grid ends. */
export const WIDE_GRID: readonly number[] = [0, 1, 10, 100, 500, 1000, 5000, 60_000]

export const SWEEP_NOTIONALS: readonly number[] = [100, 1000, 10_000, 100_000, 1_000_000]
export const SWEEP_SLIPPAGES_BP: readonly number[] = [10, 2, 1]

const MARKET = { lot: 1n }

export interface Config {
  readonly market: string
  readonly strategy: PresetId | 'stale-quote'
  readonly notionalQuote: number
  readonly maxSlippageBp: number
  /** Only for `stale-quote`. */
  readonly edgeBp: number | null
}

/** One configuration over one window set: what each of the three statistics says. */
export interface Measured {
  readonly config: Config
  readonly windowSet: WindowSet['name']
  /** `P&L(0) − P&L(400)` per window, quote units. Negative — the faster trader made less. */
  readonly effects: readonly number[]
  readonly meanEffect: number
  /** 3 × sample SD of P&L(0) across windows — the bar SC-003 sets. */
  readonly threeSigmaBase: number
  /** 3 × sample SD of the paired differences. */
  readonly threeSigmaDiff: number
  readonly clearsBase: boolean
  readonly clearsDiff: boolean
  readonly sign: SignTest
  /** Mean effect over its standard error; `null` when the effect never varies. */
  readonly t: number | null
  /**
   * Of the summed `0 → 400 ms` effect, the share (%) the first step `0 → 50 ms` makes; `null` when
   * the summed effect is zero.
   */
  readonly firstStepPct: number | null
  /** Turnover-weighted slippage at 400 ms, bp; negative — filled better than seen. */
  readonly slippageBp400: number | null
  /** P&L per grid level summed over the windows, quote units — the effect has a size to read against. */
  readonly pnlByLevel: readonly number[]
  /** Filled notional at 0 ms summed over the windows, quote units. */
  readonly turnoverAt0: number
  readonly ordersAt0: number
  readonly unfilledAt0: number
}

function toQuote(atoms: bigint, decimals: number): number {
  return Number(atoms) / 10 ** decimals
}

function strategyFor(c: Config): Strategy<unknown> {
  const overrides = { notionalQuote: c.notionalQuote, maxSlippageBp: c.maxSlippageBp }
  if (c.strategy === 'stale-quote') return staleQuote(c.edgeBp ?? 0, overrides)
  const preset = presets.find((p) => p.id === c.strategy)
  if (!preset) throw new RangeError(`unknown preset ${c.strategy}`)
  return preset.build({ ...defaultParams(preset.params), ...overrides }, MARKET)
}

function at(results: readonly LevelResult[], ms: number): LevelResult {
  const r = results.find((x) => x.latencyMs === ms)
  if (!r) throw new RangeError(`no result for ${ms} ms`)
  return r
}

export function measure(data: MarketData, ds: Dataset, config: Config, set: WindowSet): Measured {
  const decimals = data.market.quoteDecimals
  const effects: number[] = []
  const base: number[] = []
  const sums = GRID.map(() => 0n)
  let slip = 0n
  let turnover = 0n
  let turnoverAt0 = 0n
  let ordersAt0 = 0
  let unfilledAt0 = 0
  const last = GRID[GRID.length - 1] ?? 0
  for (const w of windows(set, ds.fromUs, ds.toUs)) {
    const results = runBacktest({
      snapshots: cut(data, w),
      levelsMs: GRID,
      market: MARKET,
      strategy: strategyFor(config),
    })
    const r0 = at(results, 0)
    const rN = at(results, last)
    effects.push(toQuote(r0.pnl - rN.pnl, decimals))
    base.push(toQuote(r0.pnl, decimals))
    GRID.forEach((ms, k) => {
      sums[k] = (sums[k] ?? 0n) + at(results, ms).pnl
    })
    slip += rN.slippageSum
    turnover += rN.filledNotional
    turnoverAt0 += r0.filledNotional
    ordersAt0 += r0.orders
    unfilledAt0 += r0.unfilled
  }
  const total = (sums[0] ?? 0n) - (sums[GRID.length - 1] ?? 0n)
  const first = (sums[0] ?? 0n) - (sums[1] ?? 0n)
  const meanEffect = mean(effects)
  const threeSigmaBase = 3 * sampleSd(base)
  const threeSigmaDiff = 3 * sampleSd(effects)
  const t = tStat(effects)
  const sign = signTest(effects)
  return {
    config,
    windowSet: set.name,
    effects: effects.map((e) => round(e, 6)),
    meanEffect: round(meanEffect, 6),
    threeSigmaBase: round(threeSigmaBase, 6),
    threeSigmaDiff: round(threeSigmaDiff, 6),
    clearsBase: Math.abs(meanEffect) > threeSigmaBase,
    clearsDiff: Math.abs(meanEffect) > threeSigmaDiff,
    sign: { ...sign, p: round(sign.p, 6) },
    t: t === null ? null : round(t, 4),
    firstStepPct: total === 0n ? null : round((Number(first) * 100) / Number(total), 2),
    slippageBp400: turnover === 0n ? null : round(Number((slip * 1_000_000n) / turnover) / 100, 2),
    pnlByLevel: sums.map((v) => round(toQuote(v, decimals), 6)),
    turnoverAt0: round(toQuote(turnoverAt0, decimals), 6),
    ordersAt0,
    unfilledAt0,
  }
}

export interface GridSlope {
  readonly market: string
  readonly strategy: PresetId
  /** `costPer100Ms` in quote units on the default grid and on the wide one. */
  readonly narrow: { readonly cost: number; readonly fromMs: number; readonly toMs: number } | null
  readonly wide: { readonly cost: number; readonly fromMs: number; readonly toMs: number } | null
  /** Whether 1, 10 and 100 ms returned the same P&L — the data cannot tell them apart. */
  readonly subStateLevelsIdentical: boolean
}

function slope(data: MarketData, preset: (typeof presets)[number]): GridSlope {
  const decimals = data.market.quoteDecimals
  const strategy = () => preset.build(defaultParams(preset.params), MARKET)
  const run = (levelsMs: readonly number[]) =>
    runBacktest({ snapshots: data.snapshots, levelsMs, market: MARKET, strategy: strategy() })
  const describe = (results: readonly LevelResult[]) => {
    const c = costPer100Ms(results)
    return (
      c && { cost: round(toQuote(c.costPer100Ms, decimals), 6), fromMs: c.fromMs, toMs: c.toMs }
    )
  }
  const wide = run(WIDE_GRID)
  return {
    market: data.market.base,
    strategy: preset.id,
    narrow: describe(run(GRID)),
    wide: describe(wide),
    subStateLevelsIdentical:
      at(wide, 1).pnl === at(wide, 10).pnl && at(wide, 10).pnl === at(wide, 100).pnl,
  }
}

export interface StudyResult {
  readonly dataset: {
    readonly fromUs: string
    readonly toUs: string
    readonly markets: readonly { readonly symbol: string; readonly grain: Grain }[]
  }
  readonly grid: readonly number[]
  readonly windowSets: readonly {
    readonly name: WindowSet['name']
    readonly count: number
    readonly lengthHours: number
    readonly strideHours: number
  }[]
  /** Shipped presets at their defaults, every market, both window sets. */
  readonly baseline: readonly Measured[]
  /** Shipped presets × order size × slippage tolerance × market, window set B. */
  readonly sweep: readonly Measured[]
  /** The control strategy, every market, both window sets. */
  readonly control: readonly Measured[]
  readonly gridSlope: readonly GridSlope[]
}

function config(market: string, strategy: Config['strategy'], over: Partial<Config> = {}): Config {
  return {
    market,
    strategy,
    notionalQuote: 100_000_000,
    maxSlippageBp: 10,
    edgeBp: null,
    ...over,
  }
}

interface Part {
  readonly baseline: Measured[]
  readonly sweep: Measured[]
  readonly control: Measured[]
  readonly gridSlope: GridSlope[]
}

function studyMarket(data: MarketData, ds: Dataset, setB: WindowSet): Part {
  const part: Part = { baseline: [], sweep: [], control: [], gridSlope: [] }
  const sym = data.market.base
  const atoms = 10 ** data.market.quoteDecimals
  for (const preset of presets) {
    for (const set of WINDOW_SETS)
      part.baseline.push(measure(data, ds, config(sym, preset.id), set))
    for (const notional of SWEEP_NOTIONALS) {
      for (const bp of SWEEP_SLIPPAGES_BP) {
        const c = config(sym, preset.id, { notionalQuote: notional * atoms, maxSlippageBp: bp })
        part.sweep.push(measure(data, ds, c, setB))
      }
    }
    part.gridSlope.push(slope(data, preset))
  }
  for (const edgeBp of STALE_EDGES_BP) {
    for (const set of WINDOW_SETS) {
      part.control.push(measure(data, ds, config(sym, 'stale-quote', { edgeBp }), set))
    }
  }
  return part
}

export function runStudy(ds: Dataset, onProgress: (label: string) => void = () => {}): StudyResult {
  const setB = WINDOW_SETS.find((s) => s.name === 'B')
  if (!setB) throw new RangeError('window set B is missing')
  const parts = ds.markets.map((data) => {
    onProgress(data.market.base)
    return studyMarket(data, ds, setB)
  })
  return {
    dataset: {
      fromUs: ds.fromUs.toString(),
      toUs: ds.toUs.toString(),
      markets: ds.markets.map((d) => ({ symbol: d.market.base, grain: grain(d, GRID) })),
    },
    grid: GRID,
    windowSets: WINDOW_SETS.map((s) => ({
      name: s.name,
      count: s.count,
      lengthHours: Number(s.lengthUs) / 3.6e9,
      strideHours: Number(s.strideUs) / 3.6e9,
    })),
    baseline: parts.flatMap((p) => p.baseline),
    sweep: parts.flatMap((p) => p.sweep),
    control: parts.flatMap((p) => p.control),
    gridSlope: parts.flatMap((p) => p.gridSlope),
  }
}
