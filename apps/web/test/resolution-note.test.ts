import { describe, expect, it } from 'vitest'
import type { LevelResult, Run } from '../src/api/schemas.ts'
import {
  costSentence,
  ladderNote,
  resolutionNote,
  viewMovedText,
} from '../src/pages/ResultScreen.tsx'

function level(latencyMs: number, over: Partial<LevelResult> = {}): LevelResult {
  return {
    latencyMs,
    pnl: '1000',
    orders: 100,
    trades: 100,
    unfilled: 0,
    unfilledPct: 0,
    slippageSum: '0',
    filledNotional: '1000',
    avgSlippageBp: null,
    maxDrawdown: '0',
    finalPosition: '0',
    comparedWithMs: null,
    shiftedSteps: null,
    shiftedPct: null,
    ...over,
  }
}

/** The grid of the finding: 0 bites, 50 bites, 100 and 200 repeat 50. */
const GRID: LevelResult[] = [
  level(0),
  level(50, { comparedWithMs: 0, shiftedSteps: 1400, shiftedPct: 99.92 }),
  level(100, { comparedWithMs: 50, shiftedSteps: 0, shiftedPct: 0 }),
  level(200, { comparedWithMs: 100, shiftedSteps: 0, shiftedPct: 0 }),
]

function run(over: Partial<Run> = {}): Run {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    status: 'done',
    error: null,
    market: {
      id: 1,
      label: 'cbBTC/USDC',
      baseDecimals: 8,
      quoteDecimals: 6,
      baseSymbol: 'cbBTC',
      quoteSymbol: 'USDC',
    },
    preset: 'queue-depletion',
    params: {},
    from: '2026-09-11T17:31:00.800Z',
    to: '2026-09-12T09:05:00.000Z',
    levelsMs: [0, 50, 100, 200],
    results: GRID,
    cost: { costPer100Ms: '18920000', fromMs: 0, toMs: 200, excludedMs: [] },
    resolution: { steps: 1401, medianGapMs: 1600 },
    createdAt: '2026-09-12T10:00:00.000Z',
    finishedAt: '2026-09-12T10:00:04.000Z',
    ...over,
  }
}

describe('viewMovedText', () => {
  it('the fastest level of the grid has nothing above it', () => {
    expect(viewMovedText(level(0))).toBe('—')
  })

  it('a level that never moved the view says so instead of showing 0 %', () => {
    expect(viewMovedText(level(100, { comparedWithMs: 50, shiftedSteps: 0, shiftedPct: 0 }))).toBe(
      'same view',
    )
  })

  it('a level that did move the view shows the share of steps', () => {
    expect(
      viewMovedText(level(50, { comparedWithMs: 0, shiftedSteps: 1400, shiftedPct: 99.92 })),
    ).toBe('99.92%')
  })
})

describe('resolutionNote (FR-013a)', () => {
  it('names the grain and the levels the data cannot separate', () => {
    const note = resolutionNote(run())
    expect(note).toContain('1,600 ms apart at the median')
    expect(note).toContain('over 1,401')
    expect(note).toContain('100, 200 ms never landed on a state')
    expect(note).toContain('A finer grid would not help')
  })

  it('a grid the data can resolve is said to be resolvable, not left silent', () => {
    const results = [level(0), level(50, { comparedWithMs: 0, shiftedSteps: 1400, shiftedPct: 99 })]
    const note = resolutionNote(run({ results }))
    expect(note).toContain('no row here repeats another')
  })

  it('a run finished before the measure existed gets no note instead of an invented one', () => {
    expect(resolutionNote(run({ resolution: null }))).toBeNull()
  })

  it('a period of one state says there is no gap rather than printing a number', () => {
    const note = resolutionNote(run({ resolution: { steps: 1, medianGapMs: null } }))
    expect(note).toContain('1 book state —')
  })
})

describe('costSentence — the figure carries its own grid', () => {
  it('names the range, that it is a secant, and that 0 ms is the model', () => {
    const s = costSentence(run())
    expect(s).toContain('between 0 ms and 200 ms')
    expect(s).toContain('secant')
    expect(s).toContain('moves with the grid')
    expect(s).toContain('The 0 ms row is the execution model')
  })

  it('warns when the far end of the slope is a level the data cannot see', () => {
    expect(costSentence(run())).toContain('At 200 ms the view never moved off 100 ms')
  })

  it('no such warning when the far end did move the view', () => {
    const cost = { costPer100Ms: '1', fromMs: 0, toMs: 50, excludedMs: [] }
    expect(costSentence(run({ cost }))).not.toContain('never moved off')
  })

  it('a grid starting above zero carries no artefact note', () => {
    const cost = { costPer100Ms: '1', fromMs: 50, toMs: 200, excludedMs: [] }
    expect(costSentence(run({ cost }))).not.toContain('execution model')
  })
})

describe('ladderNote — equal bars are not equal measurements', () => {
  it('names the rungs that repeat the one before them', () => {
    expect(ladderNote(run())).toBe('100, 200 ms repeat the rung before')
  })

  it('a grid the data can resolve gets no note on the axis', () => {
    const results = [level(0), level(50, { comparedWithMs: 0, shiftedSteps: 1400, shiftedPct: 99 })]
    expect(ladderNote(run({ results }))).toBeNull()
  })
})
