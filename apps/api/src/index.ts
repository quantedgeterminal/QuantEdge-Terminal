import { randomUUID } from 'node:crypto'
import { serve } from '@hono/node-server'
import { getConnInfo } from '@hono/node-server/conninfo'
import { createDb } from '@quantedge/db'
import { createApp } from './app.ts'
import { drizzleRepo } from './repo-drizzle.ts'

const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL is not set (runtime string, transaction pooler 6543)')

const { db } = createDb(url)
const app = createApp(drizzleRepo(db), randomUUID, Date.now, {
  // FR-023: quota IP — from X-Forwarded-For (Railway sits behind a proxy), else from the connection.
  connectionIp: (c) => getConnInfo(c).remote.address ?? null,
})

const port = Number(process.env.PORT ?? 8879)
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`api listening on :${info.port}`)
})
