import { ParamError, presets } from '@quantedge/engine'
import { aggregateLatency, recentArrivals } from '@quantedge/shared'
import { type Context, Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { missingRanges } from './coverage.ts'
import { checkQuota, clientIpFrom, DEFAULT_QUOTA, type QuotaLimits } from './quota.ts'
import type { Repo, StrategyRow } from './repo.ts'
import { executeRun, mergeParams, runDto } from './runs.ts'
import {
  MarketIdParam,
  RunIdParam,
  RunRequest,
  SessionKey,
  StrategyIdParam,
  StrategyRequest,
  StreamQuery,
} from './schemas.ts'
import { BookFeed } from './stream.ts'
import { paramProblem, validated } from './validate.ts'

const SESSION_HEADER = 'X-Session-Key'

/**
 * Full preset parameters or an error on a specific field (FR-016). A strategy
 * is built right away — so a parameter failure comes back as 400 with a field, not
 * as a `failed` run or a saved-but-unusable configuration.
 */
function resolveParams(
  presetId: string,
  partial: Readonly<Record<string, number>>,
): { params: Record<string, number> } | { problem: ParamError } {
  try {
    const params = mergeParams(presetId, partial)
    presets.find((p) => p.id === presetId)?.build(params, { lot: 1n })
    return { params }
  } catch (e) {
    if (e instanceof ParamError) return { problem: e }
    throw e
  }
}

function strategyDto(s: StrategyRow) {
  return {
    id: s.id,
    name: s.name,
    preset: s.preset,
    params: s.params,
    createdAt: new Date(s.createdAtMs).toISOString(),
  }
}

/**
 * Routes over `Repo`. The storage is injected so that the same app
 * is tested in memory and runs on Postgres. No route reads the request
 * body without going through Zod.
 */
export interface AppOptions {
  /** Live stream polling period; a frame goes out on an event change or on heartbeat. */
  readonly streamPollMs?: number
  readonly streamHeartbeatMs?: number
  /** Run quota (FR-023); tests narrow it. */
  readonly quota?: QuotaLimits
  /** Connection IP from the server adapter; without it only `X-Forwarded-For`. */
  readonly connectionIp?: (c: Context) => string | null
}

/** Ceiling on a run's period length (PLAN "period bounded from above"): 24 h — client decision 2026-09-11. */
export const MAX_PERIOD_MS = 24 * 3_600_000

export function createApp(
  repo: Repo,
  newSessionKey: () => string,
  now: () => number = Date.now,
  options: AppOptions = {},
) {
  const pollMs = options.streamPollMs ?? 500
  const heartbeatMs = options.streamHeartbeatMs ?? 1000
  const quota = options.quota ?? DEFAULT_QUOTA
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

  app.get('/markets/:id/coverage', validated('param', MarketIdParam), async (c) => {
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

  app.get('/markets/:id/latency', validated('param', MarketIdParam), async (c) => {
    const { id } = c.req.valid('param')
    const market = await repo.getMarket(id)
    if (!market) return c.json({ error: 'market_not_found' }, 404)
    const sinceMs = now() - LATENCY_WINDOW_SEC * 1000
    const [paths, rows] = await Promise.all([repo.paths(), repo.arrivalsSince(id, sinceMs)])
    return c.json(aggregateLatency(paths, rows, LATENCY_WINDOW_SEC))
  })

  /** How many latest events the compare screen gets (FR-021). */
  const ARRIVALS_LIMIT = 40

  /**
   * Latest events with the arrival time per channel (FR-021, T047): lane rows
   * for the compare screen. Same window and same reference as `/latency`;
   * an emulated channel appears in the row without a lag (FR-003c).
   */
  app.get('/markets/:id/arrivals', validated('param', MarketIdParam), async (c) => {
    const { id } = c.req.valid('param')
    const market = await repo.getMarket(id)
    if (!market) return c.json({ error: 'market_not_found' }, 404)
    const sinceMs = now() - LATENCY_WINDOW_SEC * 1000
    const [paths, rows] = await Promise.all([repo.paths(), repo.arrivalsSince(id, sinceMs)])
    return c.json({
      windowSec: LATENCY_WINDOW_SEC,
      paths: paths.map((p) => ({ pathId: p.id, name: p.name, kind: p.kind })),
      events: recentArrivals(paths, rows, ARRIVALS_LIMIT),
    })
  })

  /**
   * Live book stream (FR-018, T038): SSE, a frame per new event and at least every
   * heartbeat. `?offsetMs=&source=` opens an emulated channel (T037); without them —
   * the real one. `pathKind` is in every frame.
   */
  app.get(
    '/markets/:id/stream',
    validated('param', MarketIdParam),
    validated('query', StreamQuery),
    async (c) => {
      const { id } = c.req.valid('param')
      const q = c.req.valid('query')
      if ((q.offsetMs === undefined) !== (q.source === undefined)) {
        return c.json(
          {
            error: 'profile_incomplete',
            field: 'source',
            message: 'offsetMs and source go together',
          },
          400,
        )
      }
      const market = await repo.getMarket(id)
      if (!market) return c.json({ error: 'market_not_found' }, 404)
      const profile =
        q.offsetMs === undefined || q.source === undefined
          ? null
          : { offsetMs: q.offsetMs, source: q.source }
      const feed = new BookFeed(repo, { market, profile, now })

      return streamSSE(c, async (stream) => {
        let seq = 0
        while (!stream.aborted) {
          const frame = await feed.next(heartbeatMs)
          if (frame)
            await stream.writeSSE({ event: 'book', id: String(seq++), data: JSON.stringify(frame) })
          await stream.sleep(pollMs)
        }
      })
    },
  )

  /** Session key from the header; missing or malformed — 401. */
  async function session(c: { req: { header(name: string): string | undefined } }) {
    const parsed = SessionKey.safeParse(c.req.header(SESSION_HEADER))
    if (!parsed.success) return null
    await repo.touchSession(parsed.data)
    return parsed.data
  }

  app.post('/runs', validated('json', RunRequest), async (c) => {
    const sessionKey = await session(c)
    if (sessionKey === null) return c.json({ error: 'session_required' }, 401)
    const body = c.req.valid('json')

    const fromMs = Date.parse(body.from)
    const toMs = Date.parse(body.to)
    if (!(fromMs < toMs)) {
      return c.json(
        { error: 'invalid_period', field: 'from', message: '`from` must be earlier than `to`' },
        400,
      )
    }
    if (toMs - fromMs > MAX_PERIOD_MS) {
      return c.json(
        {
          error: 'period_too_long',
          field: 'to',
          message: `a run covers at most ${MAX_PERIOD_MS / 3_600_000} hours`,
        },
        400,
      )
    }

    const market = await repo.getMarket(body.marketId)
    if (!market) return c.json({ error: 'market_not_found' }, 404)

    const resolved = resolveParams(body.preset, body.params)
    if ('problem' in resolved) return c.json(paramProblem(resolved.problem), 400)
    const { params } = resolved

    // FR-023: the quota is checked before any data is read — a refusal costs nothing.
    const clientIp = clientIpFrom(c.req.header('x-forwarded-for'), options.connectionIp?.(c))
    const over = await checkQuota(repo, { sessionKey, clientIp }, quota, now())
    if (over) {
      c.header('Retry-After', String(over.retryAfterSec))
      return c.json(over, 429)
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
      clientIp,
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

  app.get('/runs/:id', validated('param', RunIdParam), async (c) => {
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

  /**
   * Saved strategies (FR-017) hang on the session key (FR-022a): without a key there are
   * none, other sessions' are invisible. Parameters are stored in full — a run from them
   * replays even if the preset's defaults change later.
   */
  app.get('/strategies', async (c) => {
    const sessionKey = await session(c)
    if (sessionKey === null) return c.json({ error: 'session_required' }, 401)
    const rows = await repo.listStrategies(sessionKey)
    return c.json(rows.map(strategyDto))
  })

  app.post('/strategies', validated('json', StrategyRequest), async (c) => {
    const sessionKey = await session(c)
    if (sessionKey === null) return c.json({ error: 'session_required' }, 401)
    const body = c.req.valid('json')
    const resolved = resolveParams(body.preset, body.params)
    if ('problem' in resolved) return c.json(paramProblem(resolved.problem), 400)
    const row = await repo.createStrategy({
      sessionKey,
      name: body.name,
      preset: body.preset,
      params: resolved.params,
    })
    return c.json(strategyDto(row), 201)
  })

  app.delete('/strategies/:id', validated('param', StrategyIdParam), async (c) => {
    const sessionKey = await session(c)
    if (sessionKey === null) return c.json({ error: 'session_required' }, 401)
    const { id } = c.req.valid('param')
    // Another session's strategy looks absent — same as another session's run.
    const deleted = await repo.deleteStrategy(id, sessionKey)
    if (!deleted) return c.json({ error: 'strategy_not_found' }, 404)
    return c.body(null, 204)
  })

  return app
}

export type App = ReturnType<typeof createApp>
