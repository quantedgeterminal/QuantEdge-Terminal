import type { PathKind } from './path-kind.ts'

/** Delivery channel from the `delivery_paths` table. */
export interface PathRow {
  readonly id: number
  readonly name: string
  readonly kind: PathKind
}

/** One arrival of one event over one channel — an `arrivals` row. */
export interface ArrivalRow {
  readonly bookUpdateId: bigint
  readonly pathId: number
  readonly receivedAtUs: bigint
}

export interface PathLatency {
  readonly pathId: number
  readonly name: string
  /** The emulation mark is a payload field, not a component decision (SC-007). */
  readonly kind: PathKind
  /** Lag behind the earliest real channel, ms; `null` — no shared events. */
  readonly p50Ms: number | null
  readonly p95Ms: number | null
  /** Events on which this channel was compared with another real one. */
  readonly sampleCount: number
  /** Share of events where this channel was not first, in percent (0…100). */
  readonly laterPct: number | null
}

export interface LatencySummary {
  readonly windowSec: number
  readonly paths: readonly PathLatency[]
  /**
   * FR-003c: differential latency is measured only between two real channels.
   * Fewer than two — no measurement; the UI shows "nothing to compare".
   */
  readonly measurable: boolean
  /** Events in the window that arrived over at least two real channels. */
  readonly sharedEvents: number
}

/** Nearest-rank percentile over sorted values; empty array → null. */
export function percentile(sorted: readonly number[], p: number): number | null {
  if (sorted.length === 0) return null
  const rank = Math.ceil((p / 100) * sorted.length)
  const idx = Math.min(sorted.length - 1, Math.max(0, rank - 1))
  return sorted[idx] ?? null
}

/**
 * Differential-latency aggregation (FR-003, SC-005). For every event that arrived over
 * ≥ 2 real channels, a channel's lag = its `received_at` − the earliest
 * `received_at` among the **real** channels of that event. Emulated channels do not
 * enter the minimum and get no lag: a difference against emulation is a tautology.
 */
export function aggregateLatency(
  paths: readonly PathRow[],
  rows: readonly ArrivalRow[],
  windowSec: number,
): LatencySummary {
  const kindOf = new Map(paths.map((p) => [p.id, p.kind]))
  const byEvent = groupByEvent(rows, kindOf)
  const { lagsUs, later, sharedEvents } = lagsFromEarliestReal(byEvent, kindOf)

  const out = [...paths]
    .sort((a, b) => a.id - b.id)
    .map((p) => summarize(p, lagsUs.get(p.id) ?? [], later.get(p.id) ?? 0))

  // `measurable` is about channels (FR-003c), not about data in the window: two real channels with
  // no shared events is "no data yet", not "nothing to compare".
  const realCount = paths.filter((p) => p.kind === 'real').length
  return { windowSec, paths: out, measurable: realCount >= 2, sharedEvents }
}

function groupByEvent(
  rows: readonly ArrivalRow[],
  kindOf: ReadonlyMap<number, PathKind>,
): Map<bigint, ArrivalRow[]> {
  const byEvent = new Map<bigint, ArrivalRow[]>()
  for (const r of rows) {
    if (!kindOf.has(r.pathId)) continue // arrival over an unknown channel — not our measurement
    const list = byEvent.get(r.bookUpdateId)
    if (list) list.push(r)
    else byEvent.set(r.bookUpdateId, [r])
  }
  return byEvent
}

/** Lag of every real channel behind the earliest real one — over events with ≥ 2 real channels. */
function lagsFromEarliestReal(
  byEvent: ReadonlyMap<bigint, ArrivalRow[]>,
  kindOf: ReadonlyMap<number, PathKind>,
) {
  const lagsUs = new Map<number, number[]>()
  const later = new Map<number, number>()
  let sharedEvents = 0
  for (const list of byEvent.values()) {
    const real = list.filter((r) => kindOf.get(r.pathId) === 'real')
    if (real.length < 2) continue
    sharedEvents++
    const earliest = real.reduce(
      (m, r) => (r.receivedAtUs < m ? r.receivedAtUs : m),
      real[0]?.receivedAtUs ?? 0n,
    )
    for (const r of real) {
      const lag = Number(r.receivedAtUs - earliest)
      const arr = lagsUs.get(r.pathId)
      if (arr) arr.push(lag)
      else lagsUs.set(r.pathId, [lag])
      if (lag > 0) later.set(r.pathId, (later.get(r.pathId) ?? 0) + 1)
    }
  }
  return { lagsUs, later, sharedEvents }
}

function summarize(p: PathRow, lagsUnsorted: number[], laterCount: number): PathLatency {
  const lags = [...lagsUnsorted].sort((a, b) => a - b)
  const toMs = (us: number | null) => (us === null ? null : Math.round(us / 1000))
  return {
    pathId: p.id,
    name: p.name,
    kind: p.kind,
    p50Ms: toMs(percentile(lags, 50)),
    p95Ms: toMs(percentile(lags, 95)),
    sampleCount: lags.length,
    laterPct: lags.length === 0 ? null : Math.trunc((laterCount * 100) / lags.length),
  }
}
