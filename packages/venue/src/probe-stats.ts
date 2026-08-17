/** One signature from `getSignaturesForAddress`: block time and whether the transaction failed. */
export interface SignatureSample {
  blockTime: number | null
  failed: boolean
}

export interface ActivityStats {
  /** How many signatures entered the sample (excluding those with unknown `blockTime`). */
  count: number
  /** Span between the newest and the oldest signature, s. */
  windowSec: number
  /** All transactions per second; `null` when the sample fits into a zero span. */
  txPerSec: number | null
  /** Successful transactions per second — they are what changes the book state. */
  okPerSec: number | null
  /** Share of failed ones, 0..1. */
  failShare: number
}

/**
 * Address activity from a sample of signatures. A pure function: what PLAN measured
 * by hand becomes a reproducible, tested computation here.
 */
export function activityStats(samples: readonly SignatureSample[]): ActivityStats {
  let count = 0
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  let failed = 0
  for (const s of samples) {
    if (s.blockTime === null) continue
    count += 1
    if (s.blockTime < min) min = s.blockTime
    if (s.blockTime > max) max = s.blockTime
    if (s.failed) failed += 1
  }
  if (count === 0) {
    return { count: 0, windowSec: 0, txPerSec: null, okPerSec: null, failShare: 0 }
  }
  const windowSec = max - min
  const failShare = failed / count
  if (windowSec === 0) {
    return { count, windowSec, txPerSec: null, okPerSec: null, failShare }
  }
  return {
    count,
    windowSec,
    txPerSec: count / windowSec,
    okPerSec: (count - failed) / windowSec,
    failShare,
  }
}

/**
 * Instrument check: on a known-active address the method must show
 * activity. Zero here means a broken measurement, not a dead market.
 */
export function instrumentPasses(reference: ActivityStats, minTxPerSec: number): boolean {
  if (reference.count === 0) return false
  // The whole sample within one second — activity above any threshold.
  if (reference.txPerSec === null) return true
  return reference.txPerSec >= minTxPerSec
}
