// Backtest engine: pure functions, zero I/O (SC-002).
export { type Execution, execute } from './fill.ts'
export { assertOrdered, delayedIndex } from './latency.ts'
export { type CostPer100Ms, costPer100Ms, unfilledPct } from './metrics.ts'
export {
  commonParams,
  type HoldState,
  holdAndExit,
  type Signal,
  sizeForNotional,
} from './presets/common.ts'
export { findPreset, type Preset, type PresetId, presets } from './presets/index.ts'
export { type LevelResult, type RunInput, runBacktest } from './run.ts'
export {
  type Decision,
  defaultParams,
  type ParamSpec,
  type ParamValues,
  type Strategy,
  type StrategyContext,
  validateParams,
} from './strategy.ts'
export type { Level, MarketSpec, OrderIntent, Side, Snapshot } from './types.ts'
export { BP, PRICE_SCALE } from './types.ts'
