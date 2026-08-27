import { createDb } from '@quantedge/db'
import { nowUs, RpcWsPath, type Unsubscribe } from '@quantedge/venue'
import pino from 'pino'
import { loadEnv } from './config.ts'
import { CoverageTracker } from './coverage.ts'
import { Ingestor } from './ingest.ts'
import { DrizzleSink, resolveIds } from './sink.ts'

const env = loadEnv()
const log = pino({ level: env.LOG_LEVEL })
const { db, sql } = createDb(env.DATABASE_URL)
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
        t.pathAlive(pathId, at).catch((e) => log.error({ err: e, slot }, 'coverage failed to open'))
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

async function shutdown(signal: string): Promise<void> {
  log.info({ signal }, 'shutting down')
  clearInterval(heartbeat)
  for (const unsub of subscriptions) await unsub().catch(() => {})
  for (const t of trackers.values()) await t.close()
  await sql.end({ timeout: 5 })
  process.exit(0)
}
process.once('SIGINT', () => void shutdown('SIGINT'))
process.once('SIGTERM', () => void shutdown('SIGTERM'))

log.info(
  { markets: [...ids.markets.keys()], paths: pathDefs.map((p) => p.name), depth: env.BOOK_DEPTH },
  'collector started',
)
