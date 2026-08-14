import { serve } from '@hono/node-server'
import { Hono } from 'hono'

const app = new Hono()

app.get('/health', (c) => c.json({ ok: true }))

const port = Number(process.env.PORT ?? 8879)
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`api listening on :${info.port}`)
})

export type App = typeof app
