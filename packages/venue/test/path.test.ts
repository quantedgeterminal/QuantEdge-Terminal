import { describe, expect, it, vi } from 'vitest'
import { type AccountUpdate, type DeliveryPath, EmulatedPath, nowUs } from '../src/path.ts'

/** In-memory real channel: the test controls when an update arrives. */
function fakeReal(name = 'fake-real') {
  let handler: ((u: AccountUpdate) => void) | undefined
  const path: DeliveryPath = {
    name,
    kind: 'real',
    subscribe: async (_account, onUpdate) => {
      handler = onUpdate
      return async () => {
        handler = undefined
      }
    },
  }
  return {
    path,
    emit: (slot: bigint) => handler?.({ slot, data: new Uint8Array([1]), receivedAtUs: nowUs() }),
    subscribed: () => handler !== undefined,
  }
}

describe('nowUs', () => {
  it('epoch microseconds, consistent with Date.now() within a second', () => {
    const us = nowUs()
    expect(Math.abs(Number(us / 1000n) - Date.now())).toBeLessThan(1000)
  })
})

describe('EmulatedPath', () => {
  it('declares kind = emulated and carries the profile with its source', () => {
    const { path } = fakeReal()
    const emu = new EmulatedPath('fast', path, { offsetMs: 50, source: 'user-defined' })
    expect(emu.kind).toBe('emulated')
    expect(emu.profile.source).toBe('user-defined')
  })

  it('refuses to be built on top of an emulated one', () => {
    const { path } = fakeReal()
    const emu = new EmulatedPath('a', path, { offsetMs: 0, source: 'x' })
    expect(() => new EmulatedPath('b', emu, { offsetMs: 0, source: 'y' })).toThrow()
  })

  it('delivers the same data with the profile offset', async () => {
    vi.useFakeTimers()
    try {
      const real = fakeReal()
      const emu = new EmulatedPath('fast', real.path, { offsetMs: 40, source: 'x' })
      const got: AccountUpdate[] = []
      const unsub = await emu.subscribe('acc', (u) => got.push(u))
      real.emit(10n)
      expect(got).toHaveLength(0)
      await vi.advanceTimersByTimeAsync(39)
      expect(got).toHaveLength(0)
      await vi.advanceTimersByTimeAsync(1)
      expect(got).toHaveLength(1)
      expect(got[0]?.slot).toBe(10n)
      await unsub()
      expect(real.subscribed()).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('unsubscribing cancels updates not yet delivered', async () => {
    vi.useFakeTimers()
    try {
      const real = fakeReal()
      const emu = new EmulatedPath('fast', real.path, { offsetMs: 100, source: 'x' })
      const got: AccountUpdate[] = []
      const unsub = await emu.subscribe('acc', (u) => got.push(u))
      real.emit(1n)
      await unsub()
      await vi.advanceTimersByTimeAsync(200)
      expect(got).toHaveLength(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('a negative offset does not deliver from the future — only without delay', async () => {
    vi.useFakeTimers()
    try {
      const real = fakeReal()
      const emu = new EmulatedPath('fast', real.path, { offsetMs: -30, source: 'x' })
      const got: AccountUpdate[] = []
      await emu.subscribe('acc', (u) => got.push(u))
      real.emit(1n)
      await vi.advanceTimersByTimeAsync(0)
      expect(got).toHaveLength(1)
    } finally {
      vi.useRealTimers()
    }
  })
})
