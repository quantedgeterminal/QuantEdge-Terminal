import type { ArrivalEvent, PathRef } from './api/schemas.ts'

/**
 * Pure logic of the channel-compare screen (FR-021, FR-003c, FR-005b). There is no
 * React, so that tests check numbers and texts rather than markup.
 */

/** Emulated lane profile: offset and source — both or neither (as on the stream). */
export interface Profile {
  readonly offsetMs: number
  readonly source: string
}

export const OFFSET_LIMIT_MS = 60_000

/** Profile from the query (`?offsetMs=&source=`); incomplete or out of bounds — no lane. */
export function readProfile(params: URLSearchParams): Profile | null {
  const raw = params.get('offsetMs')
  const source = params.get('source')?.trim() ?? ''
  if (raw === null || source === '') return null
  if (!/^-?\d+$/.test(raw.trim())) return null
  const offsetMs = Number(raw)
  if (Math.abs(offsetMs) > OFFSET_LIMIT_MS) return null
  return { offsetMs, source }
}

/** Non-removable label of the emulated lane (SC-007): the word "emulated" and the profile source. */
export function emulatedLabel(p: Profile): string {
  const sign = p.offsetMs > 0 ? '+' : ''
  return `EMULATED · profile ${sign}${p.offsetMs} ms · source: ${p.source}`
}

/** What goes into an emulated lane cell: the profile, not a measurement. */
export function emulatedCell(p: Profile): string {
  const sign = p.offsetMs > 0 ? '+' : ''
  return `${sign}${p.offsetMs} ms (profile)`
}

/** A real channel's cell: the first one is "first", the rest show the lag. */
export function realCell(lagMs: number | null): string {
  if (lagMs === null) return '—'
  return lagMs === 0 ? 'first' : `+${lagMs} ms`
}

export interface Bin {
  readonly label: string
  readonly from: number
  /** Upper bound, exclusive; `Infinity` — the last bucket. */
  readonly to: number
  count: number
}

const EDGES = [0, 1, 11, 26, 51, 101, 251, Number.POSITIVE_INFINITY]

function binLabel(from: number, to: number): string {
  if (from === 0 && to === 1) return '0 ms'
  if (to === Number.POSITIVE_INFINITY) return `${from}+ ms`
  return `${from}–${to - 1} ms`
}

/**
 * Distribution of **one real channel's** lag behind the other over the window's events
 * (FR-021 "summary distribution of the difference"). Emulation is not included.
 */
export function histogram(events: readonly ArrivalEvent[], pathId: number): Bin[] {
  const bins: Bin[] = []
  for (let i = 0; i + 1 < EDGES.length; i++) {
    const from = EDGES[i] ?? 0
    const to = EDGES[i + 1] ?? Number.POSITIVE_INFINITY
    bins.push({ label: binLabel(from, to), from, to, count: 0 })
  }
  for (const e of events) {
    const a = e.arrivals.find((x) => x.pathId === pathId)
    if (a?.kind !== 'real' || a.lagMs === null) continue
    const bin = bins.find((b) => a.lagMs !== null && a.lagMs >= b.from && a.lagMs < b.to)
    if (bin) bin.count++
  }
  return bins
}

/** The two real lane channels, by id order; fewer than two — nothing to compare. */
export function realLanes(paths: readonly PathRef[]): [PathRef, PathRef] | null {
  const real = paths.filter((p) => p.kind === 'real').sort((a, b) => a.pathId - b.pathId)
  const [a, b] = real
  return a && b ? [a, b] : null
}

/** Event time for a row: `HH:MM:SS.mmm` UTC. */
export function clock(ms: number): string {
  return new Date(ms).toISOString().slice(11, 23)
}
