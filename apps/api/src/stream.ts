import type { PathKind } from '@quantedge/shared'
import { unpackLevels } from '@quantedge/shared'
import type { BookRow, MarketRow, Repo } from './repo.ts'

/** The book counts as stale after this age (FR-020). */
export const STALE_AFTER_MS = 5000

/** Emulated-channel profile (FR-005, FR-005a): offset and the source of the number. */
export interface StreamProfile {
  readonly offsetMs: number
  readonly source: string
}

/** One live-stream frame. `pathKind` is a required field, not a component flag (SC-007). */
export interface StreamFrame {
  /** Market metadata in the frame — so the first screen does not wait for a separate request (SC-004). */
  readonly market: {
    readonly id: number
    readonly label: string
    readonly venue: string
    readonly baseDecimals: number
    readonly quoteDecimals: number
  }
  readonly t: string
  readonly ageMs: number
  readonly stale: boolean
  readonly staleAfterMs: number
  readonly pathKind: PathKind
  readonly pathName: string
  /** Emulated channel only: the profile it was shifted by. */
  readonly profile: StreamProfile | null
  readonly bids: readonly { price: string; size: string }[]
  readonly asks: readonly { price: string; size: string }[]
}

export interface StreamOptions {
  readonly market: MarketRow
  /** `null` — a real channel (the merged record of two real ones); otherwise emulation by profile. */
  readonly profile: StreamProfile | null
  readonly now: () => number
}

function frame(row: BookRow, opts: StreamOptions, deliveredAtMs: number): StreamFrame {
  const book = unpackLevels(row.levels)
  const ageMs = Math.max(0, opts.now() - deliveredAtMs)
  const toDto = (l: { price: bigint; size: bigint }) => ({
    price: l.price.toString(),
    size: l.size.toString(),
  })
  const m = opts.market
  return {
    market: {
      id: m.id,
      label: m.label,
      venue: m.venue,
      baseDecimals: m.baseDecimals,
      quoteDecimals: m.quoteDecimals,
    },
    t: new Date(row.tMs).toISOString(),
    ageMs,
    stale: ageMs > STALE_AFTER_MS,
    staleAfterMs: STALE_AFTER_MS,
    pathKind: opts.profile === null ? 'real' : 'emulated',
    pathName:
      opts.profile === null
        ? 'recorded'
        : `emulated ${opts.profile.offsetMs >= 0 ? '+' : ''}${opts.profile.offsetMs} ms`,
    profile: opts.profile,
    bids: book.bids.map(toDto),
    asks: book.asks.map(toDto),
  }
}

/**
 * Frame source for SSE: polls the market's latest event and emits a frame when
 * the event changed or `heartbeatMs` elapsed — so that the data age on screen
 * refreshes at least once a second (SC-005) and staleness triggers
 * without new events (FR-020).
 *
 * Emulation (FR-005): an event at `t` counts as delivered at `t + offsetMs`, so
 * the emulated viewer sees the latest event with `t ≤ now − offsetMs`. A negative
 * offset cannot deliver earlier — the data goes as is, but labelled with the profile;
 * that is a label, not a measurement (FR-003c).
 */
export class BookFeed {
  private readonly repo: Repo
  private readonly opts: StreamOptions
  private lastT: number | null = null
  private lastSentAt: number | null = null

  constructor(repo: Repo, opts: StreamOptions) {
    this.repo = repo
    this.opts = opts
  }

  async next(heartbeatMs: number, pollMs = 0): Promise<StreamFrame | null> {
    const offset = Math.max(0, this.opts.profile?.offsetMs ?? 0)
    const nowMs = this.opts.now()
    const row = await this.repo.latestBook(this.opts.market.id, nowMs - offset)
    if (!row) return null
    const changed = row.tMs !== this.lastT
    // A frame goes out as soon as the heartbeat would expire before the next poll: otherwise
    // with a 500 ms poll plus a DB query the gap between frames grew to ~1.15 s (SC-005).
    const due = this.lastSentAt === null || nowMs - this.lastSentAt + pollMs >= heartbeatMs
    if (!changed && !due) return null
    this.lastT = row.tMs
    this.lastSentAt = nowMs
    return frame(row, this.opts, row.tMs + offset)
  }
}
