import type { PathKind } from '@quantedge/shared'
import { type Commitment, Connection, PublicKey } from '@solana/web3.js'

/** One account update as the channel saw it. */
export interface AccountUpdate {
  slot: bigint
  /** Raw account bytes — the event key is taken from them before decoding. */
  data: Uint8Array
  /** Arrival moment in this process, epoch microseconds. */
  receivedAtUs: bigint
}

export type Unsubscribe = () => Promise<void>

/**
 * Delivery channel (FR-004). `kind` is a required field of the interface, not
 * a property of a particular implementation: a consumer cannot get data without
 * also receiving the channel type.
 */
export interface DeliveryPath {
  readonly name: string
  readonly kind: PathKind
  subscribe(account: string, onUpdate: (u: AccountUpdate) => void): Promise<Unsubscribe>
  /**
   * Channel heartbeat: slots come every ≈400 ms regardless of market activity,
   * so silence here means a dead channel, while silence in `subscribe` means a quiet market.
   */
  watchSlots(onSlot: (slot: bigint) => void): Promise<Unsubscribe>
}

/** Epoch microseconds from the process's sub-millisecond clock. */
export function nowUs(): bigint {
  return BigInt(Math.round((performance.timeOrigin + performance.now()) * 1000))
}

export interface RpcWsPathOptions {
  name: string
  wsUrl: string
  /**
   * `confirmed` by default: `processed` arrives earlier but may be
   * rolled back by a fork, and then the event in the dataset never existed. Differential
   * latency is measured at the same level on both channels, so the choice of level does
   * not affect it.
   */
  commitment?: Commitment
}

/** Real channel: `accountSubscribe` at a specific provider. */
export class RpcWsPath implements DeliveryPath {
  readonly name: string
  readonly kind = 'real' as const
  private readonly connection: Connection
  private readonly commitment: Commitment

  constructor(opts: RpcWsPathOptions) {
    this.name = opts.name
    this.commitment = opts.commitment ?? 'confirmed'
    // web3.js always requires an HTTP address; it is not used for subscriptions.
    this.connection = new Connection(opts.wsUrl.replace(/^ws/, 'http'), {
      wsEndpoint: opts.wsUrl,
      commitment: this.commitment,
    })
  }

  async subscribe(account: string, onUpdate: (u: AccountUpdate) => void): Promise<Unsubscribe> {
    const id = this.connection.onAccountChange(
      new PublicKey(account),
      (info, ctx) => {
        onUpdate({ slot: BigInt(ctx.slot), data: new Uint8Array(info.data), receivedAtUs: nowUs() })
      },
      { commitment: this.commitment },
    )
    return () => this.connection.removeAccountChangeListener(id)
  }

  async watchSlots(onSlot: (slot: bigint) => void): Promise<Unsubscribe> {
    const id = this.connection.onSlotChange((info) => onSlot(BigInt(info.slot)))
    return () => this.connection.removeSlotChangeListener(id)
  }
}

export interface EmulationProfile {
  /** Offset relative to the source, ms. Negative means "faster than the source"; earlier delivery is impossible, so it only labels the data. */
  offsetMs: number
  /** Where the number comes from: a link to a public claim or "user-defined" (FR-005a). */
  source: string
}

/**
 * Emulated channel (FR-005): the same data as the source, delivered with
 * a given offset. It measures nothing — the difference from the source equals the profile by
 * construction (FR-003c), and no consumer may present it as a measurement.
 */
export class EmulatedPath implements DeliveryPath {
  readonly name: string
  readonly kind = 'emulated' as const
  readonly profile: EmulationProfile
  private readonly upstream: DeliveryPath

  constructor(name: string, upstream: DeliveryPath, profile: EmulationProfile) {
    if (upstream.kind !== 'real') {
      throw new Error('emulation on top of emulation has no source of truth')
    }
    this.name = name
    this.upstream = upstream
    this.profile = profile
  }

  async subscribe(account: string, onUpdate: (u: AccountUpdate) => void): Promise<Unsubscribe> {
    const delayMs = Math.max(0, this.profile.offsetMs)
    const pending = new Set<ReturnType<typeof setTimeout>>()
    const unsub = await this.upstream.subscribe(account, (u) => {
      const t = setTimeout(() => {
        pending.delete(t)
        onUpdate({ ...u, receivedAtUs: nowUs() })
      }, delayMs)
      pending.add(t)
    })
    return async () => {
      for (const t of pending) clearTimeout(t)
      pending.clear()
      await unsub()
    }
  }

  /** The emulation's heartbeat is its source's: it has no network of its own. */
  watchSlots(onSlot: (slot: bigint) => void): Promise<Unsubscribe> {
    return this.upstream.watchSlots(onSlot)
  }
}
