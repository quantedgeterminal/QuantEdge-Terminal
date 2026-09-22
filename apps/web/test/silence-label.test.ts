import { describe, expect, it } from 'vitest'
import { silenceLabel } from '../src/pages/CompareScreen.tsx'

const AT = Date.parse('2026-09-22T05:42:23Z')

describe('silenceLabel', () => {
  it('a delivering channel shows the age of its last event', () => {
    expect(silenceLabel(AT, AT + 12_000, 60)).toBe('last event 12s ago (05:42:23 UTC)')
  })

  it('nothing in the window is stated as not delivering, with the window named', () => {
    expect(silenceLabel(null, AT, 60)).toBe('no events in the last 60s — not delivering')
  })

  it('the window length comes from the payload, not from a constant here', () => {
    expect(silenceLabel(null, AT, 120)).toBe('no events in the last 120s — not delivering')
  })

  it('a clock skew never renders a negative age', () => {
    expect(silenceLabel(AT, AT - 5_000, 60)).toBe('last event 0s ago (05:42:23 UTC)')
  })
})
