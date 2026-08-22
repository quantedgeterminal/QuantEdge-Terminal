import { sha256 } from '@noble/hashes/sha2.js'

/**
 * Book event identity (FR-003a): `(slot, hash(account bytes))`.
 * The same across all channels by construction, independent of the provider and
 * computed before decoding — which is why the key is taken from the raw bytes.
 */
export function stateHash(accountData: Uint8Array): Uint8Array {
  return sha256(accountData)
}

/** Key for Map/Set: slot and hash in hex. */
export function eventKey(slot: bigint, hash: Uint8Array): string {
  let hex = ''
  for (const b of hash) hex += b.toString(16).padStart(2, '0')
  return `${slot}:${hex}`
}

/** One book level in the smallest units. */
export interface Level {
  /** Quote atoms per base atom × 10^18 — u128 as on chain. */
  price: bigint
  /** Base atoms, u64. */
  size: bigint
}

export interface PackedBook {
  bids: readonly Level[]
  asks: readonly Level[]
}

const VERSION = 1
const HEADER = 4 // version u8, nBids u8, nAsks u8, reserved u8
const LEVEL = 24 // price u128 LE + size u64 LE
const U64_MAX = (1n << 64n) - 1n
const U128_MAX = (1n << 128n) - 1n

function writeLevel(v: DataView, offset: number, l: Level): void {
  if (l.price < 0n || l.price > U128_MAX) throw new RangeError(`price outside u128: ${l.price}`)
  if (l.size < 0n || l.size > U64_MAX) throw new RangeError(`size outside u64: ${l.size}`)
  v.setBigUint64(offset, l.price & U64_MAX, true)
  v.setBigUint64(offset + 8, l.price >> 64n, true)
  v.setBigUint64(offset + 16, l.size, true)
}

function readLevel(v: DataView, offset: number): Level {
  const lo = v.getBigUint64(offset, true)
  const hi = v.getBigUint64(offset + 8, true)
  return { price: (hi << 64n) | lo, size: v.getBigUint64(offset + 16, true) }
}

/**
 * Packing of the book slice for `book_updates.levels`. Slot and hash are not in the blob —
 * they are table columns. Format: a 4 B header, then bids, then asks, 24 B each.
 * 15 levels per side → 724 B per event.
 */
export function packLevels(book: PackedBook): Uint8Array {
  if (book.bids.length > 255 || book.asks.length > 255) {
    throw new RangeError('more than 255 levels per side does not fit the header')
  }
  const out = new Uint8Array(HEADER + (book.bids.length + book.asks.length) * LEVEL)
  const v = new DataView(out.buffer)
  out[0] = VERSION
  out[1] = book.bids.length
  out[2] = book.asks.length
  let offset = HEADER
  for (const l of book.bids) {
    writeLevel(v, offset, l)
    offset += LEVEL
  }
  for (const l of book.asks) {
    writeLevel(v, offset, l)
    offset += LEVEL
  }
  return out
}

export function unpackLevels(data: Uint8Array): PackedBook {
  if (data.byteLength < HEADER) throw new RangeError('blob is shorter than the header')
  if (data[0] !== VERSION) throw new RangeError(`unknown packing version: ${data[0]}`)
  const nBids = data[1] as number
  const nAsks = data[2] as number
  const expected = HEADER + (nBids + nAsks) * LEVEL
  if (data.byteLength !== expected) {
    throw new RangeError(`blob length ${data.byteLength}, the header says ${expected}`)
  }
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const bids: Level[] = []
  const asks: Level[] = []
  let offset = HEADER
  for (let i = 0; i < nBids; i++, offset += LEVEL) bids.push(readLevel(v, offset))
  for (let i = 0; i < nAsks; i++, offset += LEVEL) asks.push(readLevel(v, offset))
  return { bids, asks }
}
