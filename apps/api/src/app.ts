import { zValidator } from '@hono/zod-validator'
import { ParamError, presets } from '@quantedge/engine'
import { Hono } from 'hono'
import { missingRanges } from './coverage.ts'
import { aggregateLatency } from './latency.ts'
import type { Repo } from './repo.ts'
import { executeRun, mergeParams, runDto } from './runs.ts'
import { MarketIdParam, RunIdParam, RunRequest, SessionKey } from './schemas.ts'

const SESSION_HEADER = 'X-Session-Key'

/**
 * Routes over `Repo`. The storage is injected so that the same app
 * is tested in memory and runs on Postgres. No route reads the request
 * body without going through Zod.
 */
export function createApp(repo: Repo, newSessionKey: () => string, now: () => number = Date.now) {
  const app = new Hono()

  app.get('/health', (c) => c.json({ ok: true }))

  app.post('/session', async (c) => {
    const key = newSessionKey()
    await repo.touchSession(key)
    return c.json({ key }, 201)
  })

  app.get('/presets', (c) =>
    c.json(
      presets.map((p) => ({ id: p.id, label: p.label, summary: p.summary, params: p.params })),
    ),
  )

  app.get('/markets', async (c) => {
    const rows = await repo.listMarkets()
    return c.json(
      rows.map((m) => ({
        id: m.id,
        label: m.label,
        venue: m.venue,
        active: m.active,
        baseDecimals: m.baseDecimals,
        quoteDecimals: m.quoteDecimals,
      })),
    )
  })

  app.get('/markets/:id/coverage', zValidator('param', MarketIdParam), async (c) => {
    const { id } = c.req.valid('param')
    const market = await repo.getMarket(id)
    if (!market) return c.json({ error: 'market_not_found' }, 404)
    const rows = await repo.coverage(id)
    return c.json(
      rows.map((r) => ({
        from: new Date(r.fromMs).toISOString(),
        to: new Date(r.toMs).toISOString(),
        updateCount: r.updateCount,
      })),
    )
  })

  /** Differential-latency window (SC-005): the last 60 s by `first_seen_at`. */
  const LATENCY_WINDOW_SEC = 60

  app.get('/markets/:id/latency', zValidator('param', MarketIdParam), async (c) => {
    const { id } = c.req.valid('param')
    const market = await repo.getMarket(id)
    if (!market) return c.json({ error: 'market_not_found' }, 404)
    const sinceMs = now() - LATENCY_WINDOW_SEC * 1000
    const [paths, rows] = await Promise.all([repo.paths(), repo.arrivalsSince(id, sinceMs)])
    return c.json(aggregateLatency(paths, rows, LATENCY_WINDOW_SEC))
  })

  /** Session key from the header; missing or malformed — 401. */
  async function session(c: { req: { header(name: string): string | undefined } }) {
    const parsed = SessionKey.safeParse(c.req.header(SESSION_HEADER))
    if (!parsed.success) return null
    await repo.touchSession(parsed.data)
    return parsed.data
  }

  app.post('/runs', zValidator('json', RunRequest), async (c) => {
    const sessionKey = await session(c)
    if (sessionKey === null) return c.json({ error: 'session_required' }, 401)
    const body = c.req.valid('json')

    const fromMs = Date.parse(body.from)
    const toMs = Date.parse(body.to)
    if (!(fromMs < toMs)) {
      return c.json({ error: 'invalid_period', message: '`from` must be earlier than `to`' }, 400)
    }

    const market = await repo.getMarket(body.marketId)
    if (!market) return c.json({ error: 'market_not_found' }, 404)

    let params: Record<string, number>
    try {
      params = mergeParams(body.preset, body.params)
      // Build the strategy now — so a parameter error comes back as 400 with a field,
      // not as a `failed` run.
      const preset = presets.find((p) => p.id === body.preset)
      preset?.build(params, { lot: 1n })
    } catch (e) {
      if (e instanceof ParamError) {
        return c.json({ error: 'invalid_params', field: e.key, message: e.message }, 400)
      }
      throw e
    }

    // FR-014 / SC-009: a run over incomplete data does not start; name what is missing.
    const gaps = missingRanges(await repo.coverage(market.id), { fromMs, toMs })
    if (gaps.length > 0) {
      return c.json(
        {
          error: 'incomplete_period',
          missingRanges: gaps.map((g) => ({
            from: new Date(g.fromMs).toISOString(),
            to: new Date(g.toMs).toISOString(),
          })),
        },
        409,
      )
    }

    const run = await repo.createRun({
      sessionKey,
      marketId: market.id,
      fromMs,
      toMs,
      preset: body.preset,
      params,
      levelsMs: body.levelsMs,
    })
    await executeRun(repo, run)
    return c.json({ runId: run.id }, 201)
  })

  app.get('/runs/:id', zValidator('param', RunIdParam), async (c) => {
    const sessionKey = await session(c)
    if (sessionKey === null) return c.json({ error: 'session_required' }, 401)
    const { id } = c.req.valid('param')
    const run = await repo.getRun(id)
    // Another session's run looks absent: a session must not learn about other sessions.
    if (!run || run.sessionKey !== sessionKey) return c.json({ error: 'run_not_found' }, 404)
    const market = await repo.getMarket(run.marketId)
    if (!market) return c.json({ error: 'market_not_found' }, 404)
    const results = run.status === 'done' ? await repo.results(run.id) : []
    return c.json(runDto(run, market, results))
  })

  return app
}

export type App = ReturnType<typeof createApp>
