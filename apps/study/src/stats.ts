/**
 * The three statistics of the study. Each answers a different question, so none stands in for
 * another:
 *
 * - `spreadOfBase` — is the effect larger than the way P&L itself differs from window to window?
 *   (The criterion SC-003 was written against.)
 * - `spreadOfDiffs` — can the size of the effect in a new window be predicted?
 * - `signTest` — is there an effect at all, and does it keep one direction?
 */

export function mean(xs: readonly number[]): number {
  if (xs.length === 0) throw new RangeError('mean of nothing')
  let s = 0
  for (const x of xs) s += x
  return s / xs.length
}

/** Sample standard deviation (n − 1). Fewer than two values — `0`, there is no spread to see. */
export function sampleSd(xs: readonly number[]): number {
  if (xs.length < 2) return 0
  const m = mean(xs)
  let s = 0
  for (const x of xs) s += (x - m) ** 2
  return Math.sqrt(s / (xs.length - 1))
}

/** Mean over its standard error; `null` when the differences do not vary. */
export function tStat(xs: readonly number[]): number | null {
  const sd = sampleSd(xs)
  return sd === 0 ? null : mean(xs) / (sd / Math.sqrt(xs.length))
}

function choose(n: number, k: number): bigint {
  let c = 1n
  for (let i = 0; i < k; i++) c = (c * BigInt(n - i)) / BigInt(i + 1)
  return c
}

export interface SignTest {
  readonly negative: number
  readonly positive: number
  /** Windows with no difference at all; they carry no sign and are left out of `p`. */
  readonly ties: number
  /** Exact two-sided binomial p; `1` when no window has a sign. */
  readonly p: number
}

/**
 * Exact two-sided sign test. Ties are dropped, as the textbook test does: a window where the
 * delay changed nothing says nothing about its direction.
 */
export function signTest(diffs: readonly number[]): SignTest {
  const negative = diffs.filter((d) => d < 0).length
  const positive = diffs.filter((d) => d > 0).length
  const n = negative + positive
  const k = Math.min(negative, positive)
  let tail = 0n
  for (let i = 0; i <= k; i++) tail += choose(n, i)
  const p = n === 0 ? 1 : Math.min(1, Number(2n * tail) / 2 ** n)
  return { negative, positive, ties: diffs.length - n, p }
}

/** Rounds for the published table: the JSON then stays readable and diffs stay small. */
export function round(x: number, digits: number): number {
  const f = 10 ** digits
  return Math.round(x * f) / f
}
