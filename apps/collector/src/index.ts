// Two WS subscriptions on one account and writing book_updates/arrivals — T020.
// Standalone entry point for the two-process local setup; the deployed API
// runs the same component in-process (`RUN_COLLECTOR=true`), see `run.ts`.
import { createDb } from '@quantedge/db'
import pino from 'pino'
import { loadEnv } from './config.ts'
import { startCollector } from './run.ts'

const env = loadEnv()
const log = pino({ level: env.LOG_LEVEL })
const { db, sql } = createDb(env.DATABASE_URL)
const collector = await startCollector(env, db, log)

async function shutdown(signal: string): Promise<void> {
  log.info({ signal }, 'shutting down')
  await collector.stop()
  await sql.end({ timeout: 5 })
  process.exit(0)
}
process.once('SIGINT', () => void shutdown('SIGINT'))
process.once('SIGTERM', () => void shutdown('SIGTERM'))
