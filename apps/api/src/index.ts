import { randomUUID } from 'node:crypto'
import { serve } from '@hono/node-server'
import { createDb } from '@quantedge/db'
import { createApp } from './app.ts'
import { drizzleRepo } from './repo-drizzle.ts'

const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL is not set (runtime string, transaction pooler 6543)')

const { db } = createDb(url)
const app = createApp(drizzleRepo(db), randomUUID)

const port = Number(process.env.PORT ?? 8879)
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`api listening on :${info.port}`)
})
