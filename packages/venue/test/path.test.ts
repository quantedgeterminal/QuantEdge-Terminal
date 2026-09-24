import type { Commitment, PublicKey } from '@solana/web3.js'
import { describe, expect, it, vi } from 'vitest'
import {
  type AccountUpdate,
  type AccountWatcher,
  type DeliveryPath,
  EmulatedPath,
  nowUs,
  RpcWsPath,
} from '../src/path.ts'

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
    watchSlots: async () => async () => {},
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

/**
 * Records what a subscription actually asks the provider for. The RPC default encoding is the
 * legacy string form, which web3.js coerces to an empty buffer — a channel that leaves the
 * encoding unnamed delivers zero-byte accounts and every book "does not decode" (2026-09-24,
 * on switching the provider behind channel A). Two providers answered base64 unasked and hid it.
 */
function watcher() {
  const calls: { config: { commitment: string; encoding: string } }[] = []
  const removed: number[] = []
  let notify: ((info: { data: Buffer }, ctx: { slot: number }) => void) | undefined
  return {
    calls,
    removed,
    emit: (data: Buffer, slot: number) => notify?.({ data }, { slot }),
    watcher: {
      onAccountChange: (
        _key: PublicKey,
        cb: (info: { data: Buffer }, ctx: { slot: number }) => void,
        config: { commitment: Commitment; encoding: 'base64' },
      ) => {
        notify = cb
        calls.push({ config })
        return 7
      },
      removeAccountChangeListener: async (id: number) => {
        removed.push(id)
      },
      onSlotChange: () => 8,
      removeSlotChangeListener: async (id: number) => {
        removed.push(id)
      },
    } satisfies AccountWatcher,
  }
}

const ACCOUNT = 'Bey9vLee8CrC8S7iqNseb146upQCnSTbJQbu6vLiBRpD'

describe('RpcWsPath — the subscription names its encoding', () => {
  it('asks for base64 and the channel commitment, never the provider default', async () => {
    const w = watcher()
    const path = new RpcWsPath({ name: 'x', wsUrl: 'wss://example.invalid', connection: w.watcher })
    await path.subscribe(ACCOUNT, () => {})
    expect(w.calls).toHaveLength(1)
    expect(w.calls[0]?.config).toEqual({ commitment: 'confirmed', encoding: 'base64' })
  })

  it('the commitment of the channel is the one that goes out', async () => {
    const w = watcher()
    const path = new RpcWsPath({
      name: 'x',
      wsUrl: 'wss://example.invalid',
      commitment: 'processed',
      connection: w.watcher,
    })
    await path.subscribe(ACCOUNT, () => {})
    expect(w.calls[0]?.config.commitment).toBe('processed')
  })

  it('an update carries the account bytes and its slot, and unsubscribing removes the listener', async () => {
    const w = watcher()
    const path = new RpcWsPath({ name: 'x', wsUrl: 'wss://example.invalid', connection: w.watcher })
    const seen: AccountUpdate[] = []
    const stop = await path.subscribe(ACCOUNT, (u) => seen.push(u))
    w.emit(Buffer.from([1, 2, 3]), 449_975_278)
    expect(seen).toHaveLength(1)
    expect(seen[0]?.slot).toBe(449_975_278n)
    expect([...(seen[0]?.data ?? [])]).toEqual([1, 2, 3])
    await stop()
    expect(w.removed).toEqual([7])
  })
})
