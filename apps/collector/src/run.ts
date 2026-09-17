import type { Db } from '@quantedge/db'
import { nowUs, RpcWsPath, type Unsubscribe } from '@quantedge/venue'
import type { Logger } from 'pino'
import { type CollectorEnv, frozenInterval } from './config.ts'
import { CoverageTracker } from './coverage.ts'
import { Ingestor } from './ingest.ts'
import { Retention } from './retention.ts'
import { DrizzleSink, resolveIds } from './sink.ts'

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

  const subscriptions: Unsubscribe[] = []
  for (const path of pathDefs) {
    const pathId = ids.paths.get(path.name) as number
    subscriptions.push(
      await path.watchSlots((slot) => {
        const at = nowUs()
        for (const t of trackers.values()) {
          t.pathAlive(pathId, at).catch((e) =>
            log.error({ err: e, slot }, 'coverage failed to open'),
          )
        }
      }),
    )
    for (const [address, marketId] of ids.markets) {
      subscriptions.push(
        await path.subscribe(address, (u) => {
          ingestor
            .handle(marketId, pathId, u)
            .catch((e) => log.error({ err: e, marketId, path: path.name }, 'event write failed'))
        }),
      )
      log.info({ path: path.name, kind: path.kind, address, marketId }, 'subscribed')
    }
  }

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
      paths: pathDefs.map((p) => p.name),
      depth: env.BOOK_DEPTH,
      retentionHours: env.RETENTION_HOURS ?? null,
      frozen: env.FROZEN_FROM === undefined ? null : [env.FROZEN_FROM, env.FROZEN_TO],
    },
    'collector started',
  )

  return {
    async stop() {
      clearInterval(heartbeat)
      if (retentionTimer !== null) clearInterval(retentionTimer)
      for (const unsub of subscriptions) await unsub().catch(() => {})
      for (const t of trackers.values()) await t.close()
      log.info('collector stopped')
    },
  }
}
