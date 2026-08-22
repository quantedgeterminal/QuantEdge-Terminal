import { describe, expect, it } from 'vitest'
import { eventKey, type Level, packLevels, stateHash, unpackLevels } from '../src/book.ts'

const U64_MAX = (1n << 64n) - 1n
const U128_MAX = (1n << 128n) - 1n

/** Seeded generator so the test is reproducible: mulberry32. */
function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function randomBig(next: () => number, bits: number): bigint {
  let v = 0n
  for (let i = 0; i < bits; i += 32) v = (v << 32n) | BigInt(Math.floor(next() * 4294967296))
  return v & ((1n << BigInt(bits)) - 1n)
}

function randomLevels(next: () => number, n: number): Level[] {
  return Array.from({ length: n }, () => ({
    price: randomBig(next, 128),
    size: randomBig(next, 64),
  }))
}

describe('stateHash / eventKey', () => {
  it('equal bytes — equal key, one bit of difference — a different one', () => {
    const a = new Uint8Array([1, 2, 3, 4])
    const b = new Uint8Array([1, 2, 3, 5])
    expect(eventKey(7n, stateHash(a))).toBe(eventKey(7n, stateHash(a)))
    expect(eventKey(7n, stateHash(a))).not.toBe(eventKey(7n, stateHash(b)))
    expect(eventKey(7n, stateHash(a))).not.toBe(eventKey(8n, stateHash(a)))
  })

  it('the key is readable: slot, colon, 64 hex digits', () => {
    expect(eventKey(446134643n, stateHash(new Uint8Array(0)))).toMatch(/^446134643:[0-9a-f]{64}$/)
  })
})

describe('packLevels / unpackLevels', () => {
  it('round-trip over 15×2 levels with random u128/u64', () => {
    const next = rng(20260911)
    const book = { bids: randomLevels(next, 15), asks: randomLevels(next, 15) }
    const packed = packLevels(book)
    expect(packed.byteLength).toBe(4 + 30 * 24)
    expect(unpackLevels(packed)).toEqual(book)
  })

  it('round-trip at the range bounds and on an empty book', () => {
    const edge = { bids: [{ price: U128_MAX, size: U64_MAX }], asks: [{ price: 0n, size: 0n }] }
    expect(unpackLevels(packLevels(edge))).toEqual(edge)
    expect(unpackLevels(packLevels({ bids: [], asks: [] }))).toEqual({ bids: [], asks: [] })
  })

  it('uneven sides pack with the right counters', () => {
    const next = rng(1)
    const book = { bids: randomLevels(next, 3), asks: randomLevels(next, 7) }
    const packed = packLevels(book)
    expect([packed[1], packed[2]]).toEqual([3, 7])
    expect(unpackLevels(packed)).toEqual(book)
  })

  it('out of range — refused, not silently truncated', () => {
    expect(() => packLevels({ bids: [{ price: U128_MAX + 1n, size: 0n }], asks: [] })).toThrow(
      RangeError,
    )
    expect(() => packLevels({ bids: [{ price: 0n, size: U64_MAX + 1n }], asks: [] })).toThrow(
      RangeError,
    )
    expect(() => packLevels({ bids: [{ price: -1n, size: 0n }], asks: [] })).toThrow(RangeError)
  })

  it('a corrupted blob is refused', () => {
    const packed = packLevels({ bids: randomLevels(rng(2), 2), asks: [] })
    expect(() => unpackLevels(packed.subarray(0, packed.byteLength - 1))).toThrow(RangeError)
    const wrongVersion = new Uint8Array(packed)
    wrongVersion[0] = 9
    expect(() => unpackLevels(wrongVersion)).toThrow(RangeError)
  })

  it('works on a slice with a non-zero byteOffset', () => {
    const book = { bids: randomLevels(rng(3), 1), asks: randomLevels(rng(4), 1) }
    const packed = packLevels(book)
    const wrapper = new Uint8Array(packed.byteLength + 10)
    wrapper.set(packed, 5)
    expect(unpackLevels(wrapper.subarray(5, 5 + packed.byteLength))).toEqual(book)
  })
})
