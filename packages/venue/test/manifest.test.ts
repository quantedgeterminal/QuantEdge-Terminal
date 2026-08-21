import { readFileSync } from 'node:fs'
import { Market } from '@cks-systems/manifest-sdk'
import { PublicKey } from '@solana/web3.js'
import { describe, expect, it } from 'vitest'
import { type BookLevel, decodeBook, decodeMarketHeader } from '../src/manifest.ts'

const dir = new URL('./fixtures/', import.meta.url)
const data = new Uint8Array(readFileSync(new URL('market-cbbtc-usdc.bin', dir)))
const meta = JSON.parse(readFileSync(new URL('market-cbbtc-usdc.json', dir), 'utf8')) as {
  address: string
  slot: number
}

// The SDK is the oracle: its float output must match our integers within float error.
const oracle = Market.loadFromBuffer({
  address: new PublicKey(meta.address),
  buffer: Buffer.from(data),
  slot: meta.slot,
})

/** Our bigint level → SDK units (tokens/token and tokens). */
function toOracleUnits(level: BookLevel, baseDecimals: number, quoteDecimals: number) {
  const price = (Number(level.price) / 1e18) * 10 ** (baseDecimals - quoteDecimals)
  const size = Number(level.size) / 10 ** baseDecimals
  return { price, size }
}

/** The SDK returns orders; group them into levels the same way our decoder does. */
function oracleLevels(orders: ReturnType<Market['bids']>, bestFirst: boolean) {
  const ordered = bestFirst ? orders : [...orders].reverse()
  const levels: { price: number; size: number }[] = []
  for (const o of ordered) {
    const last = levels[levels.length - 1]
    if (last && last.price === o.tokenPrice) last.size += Number(o.numBaseTokens)
    else levels.push({ price: o.tokenPrice, size: Number(o.numBaseTokens) })
  }
  return levels
}

describe('decodeMarketHeader', () => {
  it('reads mints and decimals like the SDK', () => {
    const h = decodeMarketHeader(data)
    expect(new PublicKey(h.baseMint).toBase58()).toBe(oracle.baseMint().toBase58())
    expect(new PublicKey(h.quoteMint).toBase58()).toBe(oracle.quoteMint().toBase58())
    expect(h.baseDecimals).toBe(oracle.baseDecimals())
    expect(h.quoteDecimals).toBe(oracle.quoteDecimals())
    expect(h.quoteVolumeAtoms).toBe(oracle.quoteVolume())
  })
})

describe('decodeBook', () => {
  const book = decodeBook(data, meta.slot, 1000)
  const { baseDecimals, quoteDecimals } = book.header

  it('the snapshot is non-empty on both sides — otherwise the test checks nothing', () => {
    expect(book.bids.length).toBeGreaterThan(0)
    expect(book.asks.length).toBeGreaterThan(0)
  })

  it('the best bid is below the best ask', () => {
    expect((book.bids[0] as BookLevel).price).toBeLessThan((book.asks[0] as BookLevel).price)
  })

  it('bids: best price first, then descending', () => {
    for (let i = 1; i < book.bids.length; i++) {
      expect((book.bids[i] as BookLevel).price).toBeLessThan((book.bids[i - 1] as BookLevel).price)
    }
  })

  it('asks: best price first, then ascending', () => {
    for (let i = 1; i < book.asks.length; i++) {
      expect((book.asks[i] as BookLevel).price).toBeGreaterThan(
        (book.asks[i - 1] as BookLevel).price,
      )
    }
  })

  it.each([
    ['bids', () => oracle.bids(), () => book.bids],
    ['asks', () => oracle.asks(), () => book.asks],
  ])('%s: every level matches the SDK within float error', (_side, sdk, ours) => {
    // bestBidPrice/bestAskPrice in the SDK take the last element — the best sits at the end.
    const expected = oracleLevels(sdk(), false)
    const actual = ours().map((l) => toOracleUnits(l, baseDecimals, quoteDecimals))
    expect(actual.length).toBe(expected.length)
    for (let i = 0; i < expected.length; i++) {
      const e = expected[i] as { price: number; size: number }
      const a = actual[i] as { price: number; size: number }
      // The oracle computes in float: compare relatively, not in absolute digits.
      expect(Math.abs(a.price - e.price) / e.price).toBeLessThan(1e-12)
      expect(Math.abs(a.size - e.size) / e.size).toBeLessThan(1e-12)
    }
  })

  it('depth trims to N levels per side', () => {
    const top = decodeBook(data, meta.slot, 3)
    expect(top.bids).toEqual(book.bids.slice(0, 3))
    expect(top.asks).toEqual(book.asks.slice(0, 3))
  })

  it('expired orders are dropped by slot the same way as in the SDK', () => {
    // Far future: everything with lastValidSlot ≠ 0 becomes dead both for us and for the SDK.
    const farSlot = 2 ** 32 - 2
    const ours = decodeBook(data, farSlot, 1000)
    const sdk = Market.loadFromBuffer({
      address: new PublicKey(meta.address),
      buffer: Buffer.from(data),
      slot: farSlot,
    })
    expect(ours.bids.length).toBe(oracleLevels(sdk.bids(), false).length)
    expect(ours.asks.length).toBe(oracleLevels(sdk.asks(), false).length)
  })
})
