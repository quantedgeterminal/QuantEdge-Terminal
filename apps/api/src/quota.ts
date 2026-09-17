import type { Repo, RunTally } from './repo.ts'

/**
 * Run quota (FR-023): a backtest is the only expensive operation, and without a ceiling one
 * client eats the whole budget. Sliding window over `created_at`: per session key
 * (a person tuning parameters) and per IP (a ceiling on scripted session creation).
 * The numbers are a client decision, 2026-09-11.
 */
export interface QuotaLimits {
  readonly windowSec: number
  readonly perSession: number
  readonly perIp: number
}

export const DEFAULT_QUOTA: QuotaLimits = { windowSec: 3600, perSession: 30, perIp: 120 }

export interface QuotaExceeded {
  readonly error: 'quota_exceeded'
  readonly scope: 'session' | 'ip'
  readonly limit: number
  readonly windowSec: number
  /** Seconds until the oldest run in the window drops out of it. */
  readonly retryAfterSec: number
}

function exceeded(
  scope: 'session' | 'ip',
  limit: number,
  tally: RunTally,
  limits: QuotaLimits,
  nowMs: number,
): QuotaExceeded | null {
  if (tally.count < limit) return null
  const oldest = tally.oldestMs ?? nowMs
  const retryAfterSec = Math.max(1, Math.ceil((oldest + limits.windowSec * 1000 - nowMs) / 1000))
  return { error: 'quota_exceeded', scope, limit, windowSec: limits.windowSec, retryAfterSec }
}

/** Check before creating a run; `null` — allowed. Session first, then IP. */
export async function checkQuota(
  repo: Repo,
  who: { sessionKey: string; clientIp: string | null },
  limits: QuotaLimits,
  nowMs: number,
): Promise<QuotaExceeded | null> {
  const sinceMs = nowMs - limits.windowSec * 1000
  const bySession = exceeded(
    'session',
    limits.perSession,
    await repo.runsBySession(who.sessionKey, sinceMs),
    limits,
    nowMs,
  )
  if (bySession) return bySession
  if (who.clientIp === null) return null
  return exceeded('ip', limits.perIp, await repo.runsByIp(who.clientIp, sinceMs), limits, nowMs)
}

/**
 * Client IP: the first address in `X-Forwarded-For` (the platform sits behind a proxy), otherwise
 * the one the server adapter gave; `null` when there is none (tests via `app.request`).
 */
export function clientIpFrom(
  header: string | undefined,
  fromConnection: string | null | undefined,
): string | null {
  const forwarded = header?.split(',')[0]?.trim()
  if (forwarded) return forwarded
  return fromConnection ?? null
}
