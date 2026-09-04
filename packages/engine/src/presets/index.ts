import {
  defaultParams,
  ParamError,
  type ParamSpec,
  type ParamValues,
  type Strategy,
  validateParams,
} from '../strategy.ts'
import type { MarketSpec } from '../types.ts'
import { commonParams, holdAndExit } from './common.ts'
import { imbalanceParams, imbalanceSignal } from './imbalance-momentum.ts'
import { momentumParams, momentumSignal } from './momentum-chase.ts'
import { depletionParams, depletionSignal } from './queue-depletion.ts'

export type PresetId = 'imbalance-momentum' | 'momentum-chase' | 'queue-depletion'

/** Built-in preset (FR-015): the description for `/presets` and strategy assembly from parameters. */
export interface Preset {
  readonly id: PresetId
  readonly label: string
  readonly summary: string
  readonly params: readonly ParamSpec[]
  build(params: ParamValues, market: MarketSpec): Strategy<unknown>
}

function num(params: ParamValues, key: string): number {
  const v = params[key]
  if (v === undefined) throw new ParamError(key, 'parameter is missing')
  return v
}

export const presets: readonly Preset[] = [
  {
    id: 'imbalance-momentum',
    label: 'Imbalance momentum',
    summary: 'Enters with the heavier side of the book when top-N depth is one-sided.',
    params: [...commonParams, ...imbalanceParams],
    build(params) {
      validateParams(this.params, params)
      return holdAndExit(
        imbalanceSignal(num(params, 'triggerPct'), num(params, 'depthLevels')),
        params,
      )
    },
  },
  {
    id: 'momentum-chase',
    label: 'Momentum chase',
    summary: 'Chases a mid-price move of N basis points inside a short window.',
    params: [...commonParams, ...momentumParams],
    build(params) {
      validateParams(this.params, params)
      return holdAndExit(momentumSignal(num(params, 'moveBp'), num(params, 'windowMs')), params)
    },
  },
  {
    id: 'queue-depletion',
    label: 'Queue depletion',
    summary: 'Takes the best level when it turns thin against the next one.',
    params: [...commonParams, ...depletionParams],
    build(params) {
      validateParams(this.params, params)
      return holdAndExit(depletionSignal(num(params, 'thinRatioPct')), params)
    },
  },
]

export function findPreset(id: string): Preset | undefined {
  return presets.find((p) => p.id === id)
}

export { defaultParams }
