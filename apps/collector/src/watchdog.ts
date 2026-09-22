/**
 * Channel watchdog (T055). A WS channel can stop delivering while its socket stays
 * open: nothing throws, web3.js sees no `close`, so its own reconnect never fires and
 * the channel is silently gone. On 2026-09-22 one of the two real channels went quiet
 * at 05:42 UTC and stayed that way for 13 h — the book kept being recorded from the
 * other channel, so coverage looked healthy while the differential measurement
 * (FR-003), which needs both, had no samples at all.
 *
 * Slots are the pulse: they arrive every ≈400 ms regardless of market activity, so
 * silence on `watchSlots` means a dead channel, not a quiet market.
 */

/** What the watchdog knows about one channel. All times are epoch µs. */
export interface PathHealth {
  /** Last slot seen on this channel; `null` — not a single one since the subscription started. */
  readonly lastSlotAtUs: bigint | null
  /** When the current subscription was established — the reference point until the first slot. */
  readonly startedAtUs: bigint
  /** Consecutive resubscribe attempts that have not brought the channel back. */
  readonly failures: number
  /** When the last resubscribe was attempted; `null` — never. */
  readonly lastAttemptAtUs: bigint | null
}

export interface WatchdogOptions {
  /** Silence longer than this means the channel is dead. */
  readonly silenceUs: bigint
  /** Wait before the first retry; doubles with every failure. */
  readonly baseBackoffUs: bigint
  /** Ceiling for the backoff: a provider limit can hold for a long time. */
  readonly maxBackoffUs: bigint
}

/**
 * How long to wait after `failures` unsuccessful attempts. Doubling with a ceiling:
 * the reason for the silence may be a provider-side connection limit, and hammering it
 * every few seconds neither frees the slot nor helps anyone.
 */
export function backoffUs(failures: number, o: WatchdogOptions): bigint {
  if (failures <= 0) return 0n
  let wait = o.baseBackoffUs
  for (let i = 1; i < failures; i++) {
    wait *= 2n
    if (wait >= o.maxBackoffUs) return o.maxBackoffUs
  }
  return wait > o.maxBackoffUs ? o.maxBackoffUs : wait
}

/**
 * Is it time to resubscribe this channel? True when it has been silent past the
 * threshold and the backoff from the previous attempt has elapsed. A channel that
 * has never delivered a slot counts its silence from the moment it subscribed.
 */
export function shouldResubscribe(h: PathHealth, nowUs: bigint, o: WatchdogOptions): boolean {
  const since = h.lastSlotAtUs ?? h.startedAtUs
  if (nowUs - since <= o.silenceUs) return false
  if (h.lastAttemptAtUs === null) return true
  return nowUs - h.lastAttemptAtUs >= backoffUs(h.failures, o)
}
