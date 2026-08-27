import { readFileSync } from 'node:fs'
import { unpackLevels } from '@quantedge/shared'
import { describe, expect, it } from 'vitest'
import { Ingestor } from '../src/ingest.ts'
import { MemorySink } from './memory-sink.ts'

const fixture = new URL(
  '../../../packages/venue/test/fixtures/market-cbbtc-usdc.bin',
  import.meta.url,
)
const account = new Uint8Array(readFileSync(fixture))
const slot = 446134643n
const silent = { warn: () => {} }

describe('Ingestor', () => {
  it('the same event from two channels — one book_update, two arrivals, first_seen = the earliest', async () => {
    const sink = new MemorySink()
    const stored: number[] = []
    const ing = new Ingestor(sink, 15, silent, (m) => stored.push(m))
    // Channel B arrived earlier but is processed second — first_seen is still its.
    await ing.handle(1, 10, { slot, data: account, receivedAtUs: 1_000_050n })
    await ing.handle(1, 11, { slot, data: account, receivedAtUs: 1_000_000n })
    expect(sink.updates.size).toBe(1)
    const [u] = [...sink.updates.values()]
    expect(u?.firstSeenUs).toBe(1_000_000n)
    expect(sink.arrivals.map((a) => [a.pathId, a.receivedAtUs])).toEqual([
      [10, 1_000_050n],
      [11, 1_000_000n],
    ])
    expect(stored).toEqual([1, 1])
  })

  it('levels are the packed top-N from the decoder, not the raw account', async () => {
    const sink = new MemorySink()
    await new Ingestor(sink, 3, silent).handle(1, 10, { slot, data: account, receivedAtUs: 1n })
    const [u] = [...sink.updates.values()]
    const book = unpackLevels(u?.event.levels as Uint8Array)
    expect(book.bids.length).toBeLessThanOrEqual(3)
    expect(book.asks.length).toBeLessThanOrEqual(3)
    expect(u?.event.levels.byteLength).toBeLessThan(account.byteLength / 10)
    expect(u?.event.stateHash.byteLength).toBe(32)
  })

  it('a different account byte is a different event even in the same slot', async () => {
    const sink = new MemorySink()
    const ing = new Ingestor(sink, 15, silent)
    const changed = new Uint8Array(account)
    changed[300] = (changed[300] as number) ^ 1
    await ing.handle(1, 10, { slot, data: account, receivedAtUs: 1n })
    await ing.handle(1, 10, { slot, data: changed, receivedAtUs: 2n })
    expect(sink.updates.size).toBe(2)
  })

  it('an account that does not decode is skipped with a warning and not written', async () => {
    const sink = new MemorySink()
    const warned: string[] = []
    const ing = new Ingestor(sink, 15, { warn: (_o, m) => warned.push(m) })
    await ing.handle(1, 10, { slot, data: new Uint8Array(10), receivedAtUs: 1n })
    expect(sink.updates.size).toBe(0)
    expect(warned).toHaveLength(1)
  })
})
