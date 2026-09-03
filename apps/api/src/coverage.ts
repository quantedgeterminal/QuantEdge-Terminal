import type { CoverageRow } from './repo.ts'

export interface Range {
  readonly fromMs: number
  readonly toMs: number
}

/**
 * Ranges of `[fromMs, toMs]` not covered by any coverage segment (FR-014).
 * An empty array means the period is complete and the run may start. Otherwise the API names
 * exactly these ranges instead of silently computing across gaps (SC-009).
 *
 * Segments may overlap or touch — the cursor follows the maximum `toMs`.
 */
export function missingRanges(coverage: readonly CoverageRow[], period: Range): Range[] {
  if (period.toMs <= period.fromMs) {
    throw new RangeError(`empty period: ${period.fromMs} → ${period.toMs}`)
  }
  const sorted = [...coverage].sort((a, b) => a.fromMs - b.fromMs)
  const gaps: Range[] = []
  let cursor = period.fromMs

  for (const seg of sorted) {
    if (cursor >= period.toMs) break
    if (seg.toMs <= cursor) continue
    if (seg.fromMs > cursor) {
      gaps.push({ fromMs: cursor, toMs: seg.fromMs < period.toMs ? seg.fromMs : period.toMs })
    }
    if (seg.toMs > cursor) cursor = seg.toMs
  }
  if (cursor < period.toMs) gaps.push({ fromMs: cursor, toMs: period.toMs })
  return gaps
}
