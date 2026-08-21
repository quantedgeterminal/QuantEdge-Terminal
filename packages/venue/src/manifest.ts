/**
 * Manifest market account decoder → top-N book levels (FR-001).
 *
 * Our own rather than the SDK's for one reason: `@cks-systems/manifest-sdk` returns
 * the price as a `number` (float) and the size as tokens with a fractional part, while rule 2
 * requires integers in the smallest units. The byte layout is taken from
 * `Market.deserializeMarketBuffer` of the same SDK (0.2.38); a test checks our
 * output against the SDK on a real account snapshot.
 *
 * The on-chain price is a u128 fixed-point with 18 digits: quote atoms per
 * one base atom × 10^18. Returned as is, without conversion.
 */

const HEADER_SIZE = 256
const NODE_HEADER_SIZE = 16
const ORDER_SIZE = 64
const NIL = 0xffff_ffff
const NO_EXPIRATION = 0

/** One book level: all orders at one price. */
export interface BookLevel {
  /** Quote atoms per base atom × 10^18. */
  price: bigint
  /** Sum of sizes in base atoms. */
  size: bigint
}

export interface MarketHeader {
  version: number
  baseDecimals: number
  quoteDecimals: number
  baseMint: Uint8Array
  quoteMint: Uint8Array
  orderSequenceNumber: bigint
  numBytesAllocated: number
  bidsRootIndex: number
  asksRootIndex: number
  quoteVolumeAtoms: bigint
}

export interface BookSnapshot {
  header: MarketHeader
  /** Best price first; at most `depth` levels. */
  bids: BookLevel[]
  asks: BookLevel[]
}

interface RestingOrder {
  price: bigint
  numBaseAtoms: bigint
  sequenceNumber: bigint
  lastValidSlot: number
  isBid: boolean
  orderType: number
}

function view(data: Uint8Array): DataView {
  return new DataView(data.buffer, data.byteOffset, data.byteLength)
}

function u128(v: DataView, offset: number): bigint {
  const lo = v.getBigUint64(offset, true)
  const hi = v.getBigUint64(offset + 8, true)
  return (hi << 64n) | lo
}

export function decodeMarketHeader(data: Uint8Array): MarketHeader {
  if (data.byteLength < HEADER_SIZE) {
    throw new Error(`market account shorter than header: ${data.byteLength} < ${HEADER_SIZE}`)
  }
  const v = view(data)
  return {
    version: v.getUint8(8),
    baseDecimals: v.getUint8(9),
    quoteDecimals: v.getUint8(10),
    baseMint: data.slice(16, 48),
    quoteMint: data.slice(48, 80),
    orderSequenceNumber: v.getBigUint64(144, true),
    numBytesAllocated: v.getUint32(152, true),
    bidsRootIndex: v.getUint32(156, true),
    asksRootIndex: v.getUint32(164, true),
    quoteVolumeAtoms: v.getBigUint64(184, true),
  }
}

function readOrder(v: DataView, offset: number): RestingOrder {
  return {
    price: u128(v, offset),
    numBaseAtoms: v.getBigUint64(offset + 16, true),
    sequenceNumber: v.getBigUint64(offset + 24, true),
    lastValidSlot: v.getUint32(offset + 36, true),
    isBid: v.getUint8(offset + 40) !== 0,
    orderType: v.getUint8(offset + 41),
  }
}

/**
 * In-order traversal of the red-black tree. Indices are offsets from
 * the start of the dynamic part (after the header). A node: a 16 B header
 * (left, right, parent, color as u32) and a 64 B value.
 */
function walkTree(data: Uint8Array, rootIndex: number): RestingOrder[] {
  const out: RestingOrder[] = []
  if (rootIndex === NIL) return out
  const v = view(data)
  const base = HEADER_SIZE
  const maxNodes = Math.floor((data.byteLength - base) / (NODE_HEADER_SIZE + ORDER_SIZE))
  const stack: number[] = []
  let index = rootIndex
  let visited = 0
  while (index !== NIL || stack.length > 0) {
    while (index !== NIL) {
      stack.push(index)
      index = v.getUint32(base + index, true) // left
    }
    const node = stack.pop() as number
    if (++visited > maxNodes) throw new Error('book tree is cyclic or corrupted')
    out.push(readOrder(v, base + node + NODE_HEADER_SIZE))
    index = v.getUint32(base + node + 4, true) // right
  }
  return out
}

function live(order: RestingOrder, slot: number): boolean {
  return order.lastValidSlot === NO_EXPIRATION || order.lastValidSlot > slot
}

/** Aggregates orders into levels by price; order sequence is preserved. */
function aggregate(orders: readonly RestingOrder[]): BookLevel[] {
  const levels: BookLevel[] = []
  for (const o of orders) {
    const last = levels[levels.length - 1]
    if (last && last.price === o.price) last.size += o.numBaseAtoms
    else levels.push({ price: o.price, size: o.numBaseAtoms })
  }
  return levels
}

/**
 * @param data  raw bytes of the market account
 * @param slot  snapshot slot — orders with `lastValidSlot ≤ slot` are already dead
 * @param depth how many levels per side to keep
 */
export function decodeBook(data: Uint8Array, slot: number, depth: number): BookSnapshot {
  const header = decodeMarketHeader(data)
  // The bid tree is ordered by ascending price, the ask tree by descending:
  // in both the best order comes last. Reverse so the best comes first.
  const bids = aggregate(
    walkTree(data, header.bidsRootIndex)
      .filter((o) => live(o, slot))
      .reverse(),
  )
  const asks = aggregate(
    walkTree(data, header.asksRootIndex)
      .filter((o) => live(o, slot))
      .reverse(),
  )
  return { header, bids: bids.slice(0, depth), asks: asks.slice(0, depth) }
}
