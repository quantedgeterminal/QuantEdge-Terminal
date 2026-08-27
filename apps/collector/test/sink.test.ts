import { describe, expect, it } from 'vitest'
import { usToIso } from '../src/sink.ts'

describe('usToIso', () => {
  it('keeps the microseconds that Date loses', () => {
    expect(usToIso(1_757_590_000_123_456n)).toBe('2025-09-11T11:26:40.123456Z')
    expect(usToIso(0n)).toBe('1970-01-01T00:00:00.000000Z')
  })
})
