import {
  BP,
  commonParams,
  defaultParams,
  holdAndExit,
  type ParamValues,
  type Signal,
  type Snapshot,
  type Strategy,
} from '@quantedge/engine'

/**
 * A strategy built so that speed is an edge by construction — the control of the study. It is
 * not one of the terminal's presets and lives only here: the spec names three presets, and a
 * fourth would change the spec for the sake of an experiment.
 *
 * The signal: the best ask has come down to the previous state's mid less `edgeBp` (or the best
 * bid up to it plus `edgeBp`). Such a quote is out of line with where the book just was — left
 * behind by a move or posted too aggressively — and the first taker to reach it gets it. A trader
 * with no delay takes it from the very book it read; a delayed one finds it taken or repriced.
 * If speed paid anywhere in this data, it would pay here.
 */
export interface StaleQuoteState {
  readonly prevMid: bigint | null
  readonly prevView: Snapshot | null
}

function midOf(view: Snapshot): bigint | null {
  const b = view.bids[0]
  const a = view.asks[0]
  return b === undefined || a === undefined ? null : (b.price + a.price) / 2n
}

export function staleQuoteSignal(edgeBp: number): Signal<StaleQuoteState> {
  const edge = BigInt(edgeBp)
  return {
    init: () => ({ prevMid: null, prevView: null }),
    signal(view, state) {
      // The same state seen again on a later step is not new information.
      if (state.prevView === view) return { state, side: null }
      const ref = state.prevMid
      const next = { prevMid: midOf(view) ?? ref, prevView: view }
      const ask = view.asks[0]
      const bid = view.bids[0]
      if (ref === null) return { state: next, side: null }
      if (ask !== undefined && ask.price * BP <= ref * (BP - edge)) {
        return { state: next, side: 'buy' }
      }
      if (bid !== undefined && bid.price * BP >= ref * (BP + edge)) {
        return { state: next, side: 'sell' }
      }
      return { state: next, side: null }
    },
  }
}

/** The three parameterisations the study runs: from "any quote past the old mid" to 10 bp. */
export const STALE_EDGES_BP: readonly number[] = [0, 2, 10]

export function staleQuote(edgeBp: number, overrides: ParamValues = {}): Strategy<unknown> {
  return holdAndExit(staleQuoteSignal(edgeBp), {
    ...defaultParams(commonParams),
    ...overrides,
  }) as Strategy<unknown>
}
