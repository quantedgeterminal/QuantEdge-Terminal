import type { Db } from '@quantedge/db'
import { nowUs, RpcWsPath, type Unsubscribe } from '@quantedge/venue'
import type { Logger } from 'pino'
import { type CollectorEnv, frozenInterval } from './config.ts'
import { CoverageTracker } from './coverage.ts'
import { Ingestor } from './ingest.ts'
import { Retention } from './retention.ts'
import { DrizzleSink, resolveIds } from './sink.ts'
import { type PathHealth, shouldResubscribe } from './watchdog.ts'

/** How long to let web3.js release the socket before subscribing again. */
const SOCKET_RELEASE_MS = 1000

/** One channel's live subscriptions plus the health the watchdog (T055) judges it by. */
interface PathRuntime extends PathHealth {
  readonly path: RpcWsPath
  readonly pathId: number
  /** The markets this channel is subscribed to — not always all of them (T056). */
  readonly markets: readonly (readonly [string, number])[]
  /** Does this channel hold the slot subscription, or pulse on market events instead (T058)? */
  readonly slotPulse: boolean
  subs: Unsubscribe[]
  lastPulseAtUs: bigint | null
  startedAtUs: bigint
  failures: number
  lastAttemptAtUs: bigint | null
}

export interface CollectorHandle {
  /** Unsubscribes, closes every open coverage segment at the last live moment, stops the timers. */
  readonly stop: () => Promise<void>
}

/**
 * The collector as a component rather than a process: two WS subscriptions per
 * market (T020), coverage tracking (T021) and hourly retention (T054) over a DB
 * handle the caller owns. `index.ts` runs it standalone; the API runs it in its
 * own process when `RUN_COLLECTOR=true` — on a free tier a background worker
 * does not exist, and the coverage tracker must live where the writes happen.
 */
export async function startCollector(
  env: CollectorEnv,
  db: Db,
  log: Logger,
): Promise<CollectorHandle> {
  const sink = new DrizzleSink(db)

  const pathDefs = [
    new RpcWsPath({ name: env.RPC_A_NAME, wsUrl: env.RPC_A_WS_URL }),
    new RpcWsPath({ name: env.RPC_B_NAME, wsUrl: env.RPC_B_WS_URL }),
  ]
  const ids = await resolveIds(
    db,
    env.MARKET_ADDRESSES,
    pathDefs.map((p) => p.name),
  )

  const trackers = new Map<number, CoverageTracker>()
  for (const marketId of ids.markets.values()) {
    trackers.set(
      marketId,
      new CoverageTracker(sink, marketId, {
        livenessTimeoutUs: BigInt(env.LIVENESS_TIMEOUT_SEC) * 1_000_000n,
      }),
    )
  }
  const ingestor = new Ingestor(sink, env.BOOK_DEPTH, log, (marketId) =>
    trackers.get(marketId)?.stored(),
  )

  // T056: channel A carries only the markets latency is measured on, channel B carries all of
  // them. The book survives on one channel; the measurement needs two, and credits are finite.
  const allMarkets = [...ids.markets]
  const measuredMarkets =
    env.LATENCY_MARKETS === undefined ? allMarkets : allMarkets.slice(0, env.LATENCY_MARKETS)

  const runtimes: PathRuntime[] = pathDefs.map((path, i) => ({
    path,
    pathId: ids.paths.get(path.name) as number,
    markets: i === 0 ? measuredMarkets : allMarkets,
    slotPulse: i === 0 ? env.CHANNEL_A_SLOTS : true,
    subs: [],
    lastPulseAtUs: null,
    startedAtUs: 0n,
    failures: 0,
    lastAttemptAtUs: null,
  }))

  /**
   * A sign of life on this channel (T055): it is alive, and so is coverage of the markets it
   * carries. Only those markets — a live channel says nothing about coverage of a market it is
   * not subscribed to (T056).
   */
  function pulse(rt: PathRuntime, at: bigint): void {
    rt.lastPulseAtUs = at
    rt.failures = 0
    for (const [, marketId] of rt.markets) {
      trackers
        .get(marketId)
        ?.pathAlive(rt.pathId, at)
        .catch((e) => log.error({ err: e, path: rt.path.name }, 'coverage failed to open'))
    }
  }

  async function subscribeAll(rt: PathRuntime): Promise<void> {
    rt.startedAtUs = nowUs()
    rt.lastPulseAtUs = null
    rt.subs = []
    if (rt.slotPulse) {
      rt.subs.push(await rt.path.watchSlots(() => pulse(rt, nowUs())))
    }
    for (const [address, marketId] of rt.markets) {
      rt.subs.push(
        await rt.path.subscribe(address, (u) => {
          // Without slots, market events are all this channel has to prove it is alive (T058).
          if (!rt.slotPulse) pulse(rt, nowUs())
          ingestor
            .handle(marketId, rt.pathId, u)
            .catch((e) => log.error({ err: e, marketId, path: rt.path.name }, 'event write failed'))
        }),
      )
      log.info(
        { path: rt.path.name, kind: rt.path.kind, address, marketId, slotPulse: rt.slotPulse },
        'subscribed',
      )
    }
  }

  for (const rt of runtimes) await subscribeAll(rt)

  const backoff = {
    baseBackoffUs: BigInt(env.WATCHDOG_BACKOFF_SEC) * 1_000_000n,
    maxBackoffUs: BigInt(env.WATCHDOG_MAX_BACKOFF_SEC) * 1_000_000n,
  }
  /** Slots prove liveness every ≈400 ms; market events do not, so that channel gets far longer. */
  const watchdogFor = (rt: PathRuntime) => ({
    ...backoff,
    silenceUs:
      BigInt(rt.slotPulse ? env.WATCHDOG_SILENCE_SEC : env.WATCHDOG_QUIET_SILENCE_SEC) * 1_000_000n,
  })

  async function resubscribe(rt: PathRuntime): Promise<void> {
    const silentForSec = Number((nowUs() - (rt.lastPulseAtUs ?? rt.startedAtUs)) / 1_000_000n)
    rt.lastAttemptAtUs = nowUs()
    rt.failures += 1
    log.warn(
      { path: rt.path.name, silentForSec, attempt: rt.failures },
      'channel delivers nothing, resubscribing',
    )
    for (const unsub of rt.subs) await unsub().catch(() => {})
    rt.subs = []
    // web3.js closes the socket once its last subscription is gone; without waiting for that,
    // the new subscription reopens before the old socket is released and a provider that caps
    // concurrent connections would refuse it. (The 2026-09-22 outage had a different cause —
    // the provider's quota ran out, `max usage reached` — which no reconnect can fix; the
    // backoff below is what that case needs.)
    await new Promise((resolve) => setTimeout(resolve, SOCKET_RELEASE_MS))
    try {
      await subscribeAll(rt)
      log.info({ path: rt.path.name, attempt: rt.failures }, 'channel resubscribed')
    } catch (e) {
      log.error({ err: e, path: rt.path.name, attempt: rt.failures }, 'resubscribe failed')
    }
  }

  let checking = false
  const watchdogTimer = setInterval(() => {
    if (checking) return
    checking = true
    void (async () => {
      try {
        for (const rt of runtimes) {
          if (shouldResubscribe(rt, nowUs(), watchdogFor(rt))) await resubscribe(rt)
        }
      } finally {
        checking = false
      }
    })()
  }, env.WATCHDOG_CHECK_SEC * 1000)

  const heartbeat = setInterval(() => {
    const at = nowUs()
    for (const t of trackers.values()) {
      t.tick(at).catch((e) => log.error({ err: e }, 'coverage failed to update'))
    }
  }, env.COVERAGE_HEARTBEAT_SEC * 1000)

  // T054: cleanup in this same process — the coverage tracker learns about the open segment's shift immediately.
  const retention =
    env.RETENTION_HOURS === undefined
      ? null
      : new Retention(
          sink,
          {
            retentionUs: BigInt(env.RETENTION_HOURS) * 3_600_000_000n,
            frozen: frozenInterval(env),
            batch: env.RETENTION_BATCH,
          },
          log,
        )
  let retaining = false
  async function retain(): Promise<void> {
    if (retention === null || retaining) return
    retaining = true
    try {
      for (const [marketId, tracker] of trackers) {
        await retention.run(marketId, nowUs(), tracker)
      }
    } catch (e) {
      log.error({ err: e }, 'retention failed')
    } finally {
      retaining = false
    }
  }
  const retentionTimer =
    retention === null
      ? null
      : setInterval(() => void retain(), env.RETENTION_INTERVAL_MIN * 60_000)
  void retain()

  log.info(
    {
      markets: [...ids.markets.keys()],
      paths: runtimes.map((rt) => ({
        name: rt.path.name,
        markets: rt.markets.length,
        slotPulse: rt.slotPulse,
      })),
      depth: env.BOOK_DEPTH,
      retentionHours: env.RETENTION_HOURS ?? null,
      frozen: env.FROZEN_FROM === undefined ? null : [env.FROZEN_FROM, env.FROZEN_TO],
    },
    'collector started',
  )

  return {
    async stop() {
      clearInterval(heartbeat)
      clearInterval(watchdogTimer)
      if (retentionTimer !== null) clearInterval(retentionTimer)
      for (const rt of runtimes) for (const unsub of rt.subs) await unsub().catch(() => {})
      for (const t of trackers.values()) await t.close()
      log.info('collector stopped')
    },
  }
}
