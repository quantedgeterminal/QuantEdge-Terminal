import { randomUUID } from 'node:crypto'
import { serve } from '@hono/node-server'
import { getConnInfo } from '@hono/node-server/conninfo'
import { loadEnv } from '@quantedge/collector/config'
import { startCollector } from '@quantedge/collector/run'
import { createDb } from '@quantedge/db'
import pino from 'pino'
import { createApp } from './app.ts'
import { drizzleRepo } from './repo-drizzle.ts'

const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL is not set (runtime string, transaction pooler 6543)')

const log = pino({ level: process.env.LOG_LEVEL ?? 'info' })
const { db, sql } = createDb(url)

// One process on the free tier: the collector runs inside the API when asked
// (a background worker does not exist there), sharing the DB pool. It starts
// before the server binds, so `/health` answers only once the channels are up.
const collector =
  process.env.RUN_COLLECTOR === 'true' ? await startCollector(loadEnv(), db, log) : null

// Browser origins allowed to call the API cross-site (the web app is hosted elsewhere). Unset — no CORS.
const webOrigins = (process.env.WEB_ORIGIN ?? '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean)
const app = createApp(drizzleRepo(db), randomUUID, Date.now, {
  // FR-023: quota IP — from X-Forwarded-For (the platform sits behind a proxy), else from the connection.
  connectionIp: (c) => getConnInfo(c).remote.address ?? null,
  webOrigins,
})

const port = Number(process.env.PORT ?? 8879)
const server = serve({ fetch: app.fetch, port }, (info) => {
  log.info({ port: info.port, collector: collector !== null }, 'api listening')
})

async function shutdown(signal: string): Promise<void> {
  log.info({ signal }, 'shutting down')
  server.close()
  if (collector !== null) await collector.stop()
  await sql.end({ timeout: 5 })
  process.exit(0)
}
process.once('SIGINT', () => void shutdown('SIGINT'))
process.once('SIGTERM', () => void shutdown('SIGTERM'))
