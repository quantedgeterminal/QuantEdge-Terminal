/**
 * Instrument check stand (SC-005a, T040): two real channels on one account,
 * the second artificially delayed by a known X ms. The measured median lag must
 * differ from X by no more than 15 ms. This checks the instrument, not the market.
 *
 *   pnpm --filter @quantedge/collector bench:latency -- --ws wss://… --account <pubkey> --delay 150 --seconds 60
 *
 * Both channels go through the same provider: the difference between them is then
 * only the injected delay plus process noise, and that is exactly what the stand must show.
 */
import { parseArgs } from 'node:util'
import { type ArrivalRow, aggregateLatency, eventKey, stateHash } from '@quantedge/shared'
import { type AccountUpdate, type DeliveryPath, nowUs, RpcWsPath } from '@quantedge/venue'

const { values } = parseArgs({
  options: {
    ws: {
      type: 'string',
      default: process.env.RPC_A_WS_URL ?? 'wss://api.mainnet-beta.solana.com',
    },
    account: { type: 'string', default: process.env.MARKET_ADDRESSES?.split(',')[0] },
    delay: { type: 'string', default: '150' },
    seconds: { type: 'string', default: '60' },
    tolerance: { type: 'string', default: '15' },
  },
})

const wsUrl = values.ws
const account = values.account
const delayMs = Number(values.delay)
const seconds = Number(values.seconds)
const toleranceMs = Number(values.tolerance)
if (!wsUrl || !account)
  throw new Error('--ws and --account are required (or RPC_A_WS_URL, MARKET_ADDRESSES)')

/** A channel that delivers the same as the source, but `delayMs` later — and stays `real` for the instrument. */
class DelayedRealPath implements DeliveryPath {
  readonly name: string
  readonly kind = 'real' as const
  private readonly upstream: DeliveryPath
  private readonly delayMs: number
  constructor(name: string, upstream: DeliveryPath, delayMs: number) {
    this.name = name
    this.upstream = upstream
    this.delayMs = delayMs
  }
  subscribe(acc: string, onUpdate: (u: AccountUpdate) => void) {
    return this.upstream.subscribe(acc, (u) => {
      // The stamp is the actual delivery moment, not "source + X": otherwise the stand would measure
      // its own arithmetic, not the instrument.
      setTimeout(() => onUpdate({ ...u, receivedAtUs: nowUs() }), this.delayMs)
    })
  }
  watchSlots(onSlot: (slot: bigint) => void) {
    return this.upstream.watchSlots(onSlot)
  }
}

const direct = new RpcWsPath({ name: 'direct', wsUrl })
const delayed = new DelayedRealPath('delayed', new RpcWsPath({ name: 'direct-2', wsUrl }), delayMs)
const paths = [
  { id: 1, name: direct.name, kind: direct.kind },
  { id: 2, name: delayed.name, kind: delayed.kind },
]

const ids = new Map<string, bigint>()
const rows: ArrivalRow[] = []
function record(pathId: number, u: AccountUpdate): void {
  const key = eventKey(u.slot, stateHash(u.data))
  let id = ids.get(key)
  if (id === undefined) {
    id = BigInt(ids.size + 1)
    ids.set(key, id)
  }
  rows.push({ bookUpdateId: id, pathId, receivedAtUs: u.receivedAtUs })
}

console.log(`bench: ${account} via ${wsUrl}, second channel +${delayMs} ms, ${seconds} s`)
const unsubA = await direct.subscribe(account, (u) => record(1, u))
const unsubB = await delayed.subscribe(account, (u) => record(2, u))
await new Promise((r) => setTimeout(r, seconds * 1000))
await unsubA()
await unsubB()

const summary = aggregateLatency(paths, rows, seconds)
const slow = summary.paths.find((p) => p.pathId === 2)
console.log(JSON.stringify(summary, null, 2))

if (!slow || slow.p50Ms === null) {
  console.log(
    `FAIL: shared events ${summary.sharedEvents} — no measurement; run longer or pick a busier market`,
  )
  process.exit(2)
}
const error = Math.abs(slow.p50Ms - delayMs)
const verdict = error <= toleranceMs ? 'PASS' : 'FAIL'
console.log(
  `${verdict}: injected ${delayMs} ms, measured p50 ${slow.p50Ms} ms (error ${error} ms, tolerance ${toleranceMs}), events ${summary.sharedEvents}`,
)
process.exit(verdict === 'PASS' ? 0 : 1)
