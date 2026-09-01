import type { MarketSpec, OrderIntent, Snapshot } from './types.ts'

/** What the strategy knows on a step besides the delayed snapshot. */
export interface StrategyContext {
  /** Fill moment `t_i` (ms). The strategy sees `view.t ≤ now − Δ`. */
  readonly now: number
  /** Current signed position in base atoms; the result of previous fills. */
  readonly position: bigint
  readonly market: MarketSpec
}

export interface Decision<S> {
  readonly state: S
  readonly orders: readonly OrderIntent[]
}

/**
 * A strategy is a pure function of the delayed snapshot and its own state.
 * One run drives `N` independent states — one per delay level (FR-008);
 * so the state is returned, not mutated.
 */
export interface Strategy<S> {
  init(): S
  decide(view: Snapshot, state: S, ctx: StrategyContext): Decision<S>
}

/** Preset parameter spec for `/presets` and boundary validation (FR-016). All parameters are integers. */
export interface ParamSpec {
  readonly key: string
  readonly label: string
  readonly unit: string
  readonly min: number
  readonly max: number
  readonly default: number
}

export type ParamValues = Readonly<Record<string, number>>

/**
 * Parameter check against the spec: integers within bounds. The error names
 * the field — that is what FR-016 requires to show the user.
 */
export function validateParams(specs: readonly ParamSpec[], values: ParamValues): void {
  for (const spec of specs) {
    const v = values[spec.key]
    if (v === undefined) throw new RangeError(`${spec.key}: parameter is missing`)
    if (!Number.isInteger(v)) throw new RangeError(`${spec.key}: must be an integer, got ${v}`)
    if (v < spec.min || v > spec.max) {
      throw new RangeError(`${spec.key}: ${v} is out of bounds ${spec.min}…${spec.max} ${spec.unit}`)
    }
  }
  for (const key of Object.keys(values)) {
    if (!specs.some((s) => s.key === key)) throw new RangeError(`${key}: unknown parameter`)
  }
}

export function defaultParams(specs: readonly ParamSpec[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const s of specs) out[s.key] = s.default
  return out
}
