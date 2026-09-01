import { describe, expect, it } from 'vitest'
import { defaultParams, findPreset, presets } from '../src/presets/index.ts'
import { runBacktest } from '../src/run.ts'
import { at, market, serialize, synthetic } from './synthetic.ts'

const levelsMs = [0, 50, 100, 200, 400]

function preset(id: string) {
  const p = findPreset(id)
  if (!p) throw new Error(`no preset ${id}`)
  return p
}

describe('determinism (FR-009, SC-002)', () => {
  it('10 of 10 runs are byte-identical, each on a fresh strategy', () => {
    const snapshots = synthetic(11, 2000)
    const outputs = new Set<string>()
    for (const p of presets) {
      const params = defaultParams(p.params)
      const runs: string[] = []
      for (let i = 0; i < 10; i++) {
        const strategy = p.build(params, market)
        runs.push(serialize(runBacktest({ snapshots, levelsMs, market, strategy })))
      }
      expect(new Set(runs).size).toBe(1)
      outputs.add(at(runs, 0))
    }
    // Three presets give three different results — the test would not pass on empty output.
    expect(outputs.size).toBe(3)
  })

  it('the order of levels in the request does not affect the result of a level', () => {
    const snapshots = synthetic(3, 1000)
    const p = preset('imbalance-momentum')
    const params = defaultParams(p.params)
    const a = runBacktest({
      snapshots,
      levelsMs: [0, 200],
      market,
      strategy: p.build(params, market),
    })
    const b = runBacktest({
      snapshots,
      levelsMs: [200, 0],
      market,
      strategy: p.build(params, market),
    })
    expect(serialize(a[1])).toBe(serialize(b[0]))
    expect(serialize(a[0])).toBe(serialize(b[1]))
  })
})
