// Backtest engine: pure functions, zero I/O (SC-002).
export { type Execution, execute } from './fill.ts'
export { assertOrdered, delayedIndex } from './latency.ts'
export type { Level, MarketSpec, OrderIntent, Side, Snapshot } from './types.ts'
export { PRICE_SCALE } from './types.ts'
