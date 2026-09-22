import { describe, expect, it } from 'vitest'
import { backoffUs, type PathHealth, shouldResubscribe } from '../src/watchdog.ts'

const SEC = 1_000_000n
const opts = { silenceUs: 120n * SEC, baseBackoffUs: 30n * SEC, maxBackoffUs: 900n * SEC }

function health(over: Partial<PathHealth> = {}): PathHealth {
  return {
    lastSlotAtUs: 1000n * SEC,
    startedAtUs: 900n * SEC,
    failures: 0,
    lastAttemptAtUs: null,
    ...over,
  }
}

describe('backoffUs', () => {
  it('doubles with every failure and stops at the ceiling', () => {
    expect(backoffUs(0, opts)).toBe(0n)
    expect(backoffUs(1, opts)).toBe(30n * SEC)
    expect(backoffUs(2, opts)).toBe(60n * SEC)
    expect(backoffUs(3, opts)).toBe(120n * SEC)
    expect(backoffUs(6, opts)).toBe(900n * SEC)
    expect(backoffUs(100, opts)).toBe(900n * SEC)
  })
})

describe('shouldResubscribe', () => {
  it('a live channel is left alone', () => {
    expect(shouldResubscribe(health(), 1060n * SEC, opts)).toBe(false)
  })

  it('silence exactly at the threshold is not yet a death', () => {
    expect(shouldResubscribe(health(), 1120n * SEC, opts)).toBe(false)
  })

  it('silence past the threshold triggers the first attempt', () => {
    expect(shouldResubscribe(health(), 1121n * SEC, opts)).toBe(true)
  })

  it('a channel that never delivered a slot counts silence from the subscription', () => {
    const h = health({ lastSlotAtUs: null })
    expect(shouldResubscribe(h, 1021n * SEC, opts)).toBe(true)
    expect(shouldResubscribe(h, 1020n * SEC, opts)).toBe(false)
  })

  it('after an attempt it waits out the backoff instead of hammering the provider', () => {
    const h = health({ failures: 1, lastAttemptAtUs: 1200n * SEC })
    expect(shouldResubscribe(h, 1220n * SEC, opts)).toBe(false)
    expect(shouldResubscribe(h, 1230n * SEC, opts)).toBe(true)
  })

  it('the wait grows with the number of failures', () => {
    const h = health({ failures: 3, lastAttemptAtUs: 1200n * SEC })
    expect(shouldResubscribe(h, 1300n * SEC, opts)).toBe(false)
    expect(shouldResubscribe(h, 1320n * SEC, opts)).toBe(true)
  })

  it('a channel that came back is live again regardless of past failures', () => {
    const h = health({ failures: 5, lastAttemptAtUs: 1200n * SEC, lastSlotAtUs: 1250n * SEC })
    expect(shouldResubscribe(h, 1300n * SEC, opts)).toBe(false)
  })
})
