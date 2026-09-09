import { PRICE_SCALE } from '@quantedge/engine'
import { type Level, packLevels } from '@quantedge/shared'
import { beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../src/app.ts'
import { MemoryRepo } from '../src/memory-repo.ts'
import type { BookRow } from '../src/repo.ts'

const T0 = Date.parse('2026-09-01T08:00:00Z')
const HOUR = 3_600_000
const SESSION = '11111111-1111-4111-8111-111111111111'
const OTHER = '22222222-2222-4222-8222-222222222222'

/** Seeded mulberry32. */
function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Packed events with thin levels — so the presets trade. */
function packedBook(seed: number, fromMs: number, n: number): BookRow[] {
  const next = rng(seed)
  const rows: BookRow[] = []
  let t = fromMs
  let ask = 1000
  const lvl = (p: number, s: number): Level => ({ price: BigInt(p) * PRICE_SCALE, size: BigInt(s) })
  for (let i = 0; i < n; i++) {
    // 1–3 s between events: 3 000 events cover ≈100 min, i.e. the whole run period.
    t += 1000 + Math.floor(next() * 2000)
    const r = next()
    if (r < 0.25) ask += 1
    else if (r < 0.5) ask -= 1
    const thin = next() < 0.2
    const asks = Array.from({ length: 5 }, (_, k) =>
      lvl(ask + k, k === 0 && thin ? 1 : 20 + Math.floor(next() * 80)),
    )
    const bids = Array.from({ length: 5 }, (_, k) => lvl(ask - 1 - k, 20 + Math.floor(next() * 80)))
    rows.push({ tMs: t, levels: packLevels({ bids, asks }) })
  }
  return rows
}

function setup() {
  const repo = new MemoryRepo()
  repo.markets.push({
    id: 1,
    venue: 'manifest',
    address: 'Bey9vLee',
    label: 'cbBTC/USDC',
    baseDecimals: 8,
    quoteDecimals: 6,
    active: true,
  })
  // Coverage: 08:00–14:00 and 16:00–18:00; a hole between them.
  repo.coverageRows.set(1, [
    { fromMs: T0, toMs: T0 + 6 * HOUR, updateCount: 40_608 },
    { fromMs: T0 + 8 * HOUR, toMs: T0 + 10 * HOUR, updateCount: 13_000 },
  ])
  repo.books.set(1, packedBook(5, T0, 3000))
  let n = 0
  const app = createApp(repo, () => `33333333-3333-4333-8333-${String(++n).padStart(12, '0')}`)
  return { repo, app }
}

const iso = (ms: number) => new Date(ms).toISOString()

async function postRun(app: ReturnType<typeof createApp>, body: unknown, session = SESSION) {
  return app.request('/runs', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-Session-Key': session },
    body: JSON.stringify(body),
  })
}

const goodRun = {
  marketId: 1,
  from: iso(T0 + HOUR),
  to: iso(T0 + 2 * HOUR),
  preset: 'queue-depletion',
}

describe('reference data', () => {
  let s: ReturnType<typeof setup>
  beforeEach(() => {
    s = setup()
  })

  it('POST /session issues a UUID and remembers the session', async () => {
    const res = await s.app.request('/session', { method: 'POST' })
    expect(res.status).toBe(201)
    const { key } = (await res.json()) as { key: string }
    expect(key).toMatch(/^33333333-3333-4333-8333-/)
    expect(s.repo.sessions.has(key)).toBe(true)
  })

  it('GET /presets — three presets with parameters and bounds', async () => {
    const res = await s.app.request('/presets')
    const body = (await res.json()) as { id: string; params: { key: string; min: number }[] }[]
    expect(body.map((p) => p.id)).toEqual([
      'imbalance-momentum',
      'momentum-chase',
      'queue-depletion',
    ])
    expect(body[0]?.params.some((p) => p.key === 'holdMs')).toBe(true)
  })

  it('GET /markets and /markets/:id/coverage — ISO segment bounds', async () => {
    const markets = (await (await s.app.request('/markets')).json()) as {
      id: number
      label: string
    }[]
    expect(markets).toEqual([
      {
        id: 1,
        label: 'cbBTC/USDC',
        venue: 'manifest',
        active: true,
        baseDecimals: 8,
        quoteDecimals: 6,
      },
    ])
    const cov = (await (await s.app.request('/markets/1/coverage')).json()) as { from: string }[]
    expect(cov.map((c) => c.from)).toEqual([iso(T0), iso(T0 + 8 * HOUR)])
    expect((await s.app.request('/markets/9/coverage')).status).toBe(404)
    expect((await s.app.request('/markets/x/coverage')).status).toBe(400)
  })
})

describe('POST /runs — boundary', () => {
  let s: ReturnType<typeof setup>
  beforeEach(() => {
    s = setup()
  })

  it('without a session key — 401, no run', async () => {
    const res = await s.app.request('/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(goodRun),
    })
    expect(res.status).toBe(401)
    expect(s.repo.runs.size).toBe(0)
  })

  it('a body cannot bypass Zod: unknown preset, fractional level, empty levels', async () => {
    expect((await postRun(s.app, { ...goodRun, preset: 'spread-capture' })).status).toBe(400)
    expect((await postRun(s.app, { ...goodRun, levelsMs: [0, 1.5] })).status).toBe(400)
    expect((await postRun(s.app, { ...goodRun, levelsMs: [] })).status).toBe(400)
    expect((await postRun(s.app, { ...goodRun, from: 'yesterday' })).status).toBe(400)
  })

  it('`from` not earlier than `to` — 400', async () => {
    const res = await postRun(s.app, { ...goodRun, from: goodRun.to, to: goodRun.from })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: string }).error).toBe('invalid_period')
  })

  it('parameter out of bounds — 400 with the field name (FR-016)', async () => {
    const res = await postRun(s.app, { ...goodRun, params: { thinRatioPct: 0 } })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string; field: string; message: string }
    expect(body.error).toBe('invalid_params')
    expect(body.field).toBe('thinRatioPct')
    expect(body.message).toBe('0 is outside 1…100 %')
    expect(s.repo.runs.size).toBe(0)
  })

  it('a Zod failure names the field too: fractional parameter, fractional level, unknown preset (T043)', async () => {
    const problem = async (body: Record<string, unknown>) =>
      (await (await postRun(s.app, body)).json()) as { error: string; field: string }
    expect(await problem({ ...goodRun, params: { holdMs: 1.5 } })).toMatchObject({
      error: 'invalid_params',
      field: 'holdMs',
    })
    expect(await problem({ ...goodRun, levelsMs: [0, 1.5] })).toMatchObject({
      error: 'invalid_request',
      field: 'levelsMs.1',
    })
    expect(await problem({ ...goodRun, preset: 'spread-capture' })).toMatchObject({
      error: 'invalid_request',
      field: 'preset',
    })
    expect(await problem({ ...goodRun, from: goodRun.to, to: goodRun.from })).toMatchObject({
      error: 'invalid_period',
      field: 'from',
    })
    expect(s.repo.runs.size).toBe(0)
  })

  it('unknown market — 404', async () => {
    expect((await postRun(s.app, { ...goodRun, marketId: 7 })).status).toBe(404)
  })
})

describe('FR-014 / SC-009: a run over an incomplete period does not start', () => {
  const s = setup()
  // Ten different incomplete periods: head, tail, hole, fully outside coverage.
  const cases: { from: number; to: number; gaps: [number, number][] }[] = [
    { from: T0 - HOUR, to: T0 + HOUR, gaps: [[T0 - HOUR, T0]] },
    { from: T0 + 5 * HOUR, to: T0 + 7 * HOUR, gaps: [[T0 + 6 * HOUR, T0 + 7 * HOUR]] },
    { from: T0 + 6 * HOUR, to: T0 + 8 * HOUR, gaps: [[T0 + 6 * HOUR, T0 + 8 * HOUR]] },
    { from: T0 + 5 * HOUR, to: T0 + 9 * HOUR, gaps: [[T0 + 6 * HOUR, T0 + 8 * HOUR]] },
    { from: T0 + 10 * HOUR, to: T0 + 11 * HOUR, gaps: [[T0 + 10 * HOUR, T0 + 11 * HOUR]] },
    { from: T0 + 9 * HOUR, to: T0 + 12 * HOUR, gaps: [[T0 + 10 * HOUR, T0 + 12 * HOUR]] },
    { from: T0 - 2 * HOUR, to: T0 - HOUR, gaps: [[T0 - 2 * HOUR, T0 - HOUR]] },
    {
      from: T0 - HOUR,
      to: T0 + 12 * HOUR,
      gaps: [
        [T0 - HOUR, T0],
        [T0 + 6 * HOUR, T0 + 8 * HOUR],
        [T0 + 10 * HOUR, T0 + 12 * HOUR],
      ],
    },
    {
      from: T0 + 6 * HOUR + 1,
      to: T0 + 6 * HOUR + 2,
      gaps: [[T0 + 6 * HOUR + 1, T0 + 6 * HOUR + 2]],
    },
    { from: T0 + 7 * HOUR, to: T0 + 8 * HOUR + 1, gaps: [[T0 + 7 * HOUR, T0 + 8 * HOUR]] },
  ]

  it.each(cases.map((c, i) => [i + 1, c] as const))(
    'refusal %i of 10 names the range',
    async (_i, c) => {
      const res = await postRun(s.app, { ...goodRun, from: iso(c.from), to: iso(c.to) })
      expect(res.status).toBe(409)
      const body = (await res.json()) as {
        error: string
        missingRanges: { from: string; to: string }[]
      }
      expect(body.error).toBe('incomplete_period')
      expect(body.missingRanges).toEqual(c.gaps.map(([a, b]) => ({ from: iso(a), to: iso(b) })))
    },
  )

  it('after ten refusals — no run and no data read', () => {
    expect(s.repo.runs.size).toBe(0)
    expect(s.repo.bookReads).toBe(0)
  })
})

describe('POST /runs → GET /runs/:id', () => {
  const s = setup()
  let runId = ''

  it('complete period — 201 with runId, data read once', async () => {
    const res = await postRun(s.app, goodRun)
    expect(res.status).toBe(201)
    runId = ((await res.json()) as { runId: string }).runId
    expect(runId).toMatch(/^00000000-0000-4000-8000-/)
    expect(s.repo.bookReads).toBe(1)
  })

  it('result: done, five default levels, money as strings, cost of 100 ms', async () => {
    const res = await s.app.request(`/runs/${runId}`, { headers: { 'X-Session-Key': SESSION } })
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      status: string
      levelsMs: number[]
      results: { latencyMs: number; pnl: string; orders: number; unfilledPct: number }[]
      cost: { costPer100Ms: string; fromMs: number; toMs: number } | null
      market: { quoteDecimals: number }
      params: Record<string, number>
    }
    expect(body.status).toBe('done')
    expect(body.levelsMs).toEqual([0, 50, 100, 200, 400])
    expect(body.results.map((r) => r.latencyMs)).toEqual([0, 50, 100, 200, 400])
    expect(body.results[0]?.orders).toBeGreaterThan(0)
    expect(body.results[0]?.pnl).toMatch(/^-?\d+$/)
    expect(body.cost).not.toBeNull()
    expect(body.cost?.fromMs).toBe(0)
    expect(body.market.quoteDecimals).toBe(6)
    expect(body.params.thinRatioPct).toBe(20) // default merged in
  })

  it('another session sees 404, no session — 401', async () => {
    expect(
      (await s.app.request(`/runs/${runId}`, { headers: { 'X-Session-Key': OTHER } })).status,
    ).toBe(404)
    expect((await s.app.request(`/runs/${runId}`)).status).toBe(401)
    expect(
      (await s.app.request('/runs/not-a-uuid', { headers: { 'X-Session-Key': SESSION } })).status,
    ).toBe(400)
  })

  it('the same request again — byte-identical results (SC-002 at the API boundary)', async () => {
    const second = ((await (await postRun(s.app, goodRun)).json()) as { runId: string }).runId
    const a = await (
      await s.app.request(`/runs/${runId}`, { headers: { 'X-Session-Key': SESSION } })
    ).json()
    const b = await (
      await s.app.request(`/runs/${second}`, { headers: { 'X-Session-Key': SESSION } })
    ).json()
    const strip = (x: unknown) => {
      const { id: _id, createdAt: _c, finishedAt: _f, ...rest } = x as Record<string, unknown>
      return JSON.stringify(rest)
    }
    expect(strip(a)).toBe(strip(b))
  })
})

describe('/strategies — saved configurations on the session key (FR-017, FR-022a)', () => {
  let s: ReturnType<typeof setup>
  beforeEach(() => {
    s = setup()
  })

  const post = (body: unknown, session = SESSION) =>
    s.app.request('/strategies', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-Session-Key': session },
      body: JSON.stringify(body),
    })
  const list = async (session = SESSION) =>
    (await (
      await s.app.request('/strategies', { headers: { 'X-Session-Key': session } })
    ).json()) as { id: string; name: string; preset: string; params: Record<string, number> }[]

  it('without a key — 401 on all three routes', async () => {
    expect((await s.app.request('/strategies')).status).toBe(401)
    expect(
      (
        await s.app.request('/strategies', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: 'x', preset: 'momentum-chase' }),
        })
      ).status,
    ).toBe(401)
    expect((await s.app.request(`/strategies/${SESSION}`, { method: 'DELETE' })).status).toBe(401)
  })

  it('stores full parameters (defaults merged) and lists the newest first', async () => {
    const a = await post({
      name: 'thin 30',
      preset: 'queue-depletion',
      params: { thinRatioPct: 30 },
    })
    expect(a.status).toBe(201)
    const created = (await a.json()) as { id: string; params: Record<string, number> }
    expect(created.params).toMatchObject({ thinRatioPct: 30, holdMs: 800, maxSlippageBp: 10 })
    await post({ name: '  chase  ', preset: 'momentum-chase' })
    const rows = await list()
    expect(rows.map((r) => r.name)).toEqual(['chase', 'thin 30'])
    expect(rows[1]?.id).toBe(created.id)
  })

  it('bad parameter — 400 on the specific field, nothing saved; empty name — 400 too', async () => {
    const bad = await post({ name: 'x', preset: 'queue-depletion', params: { thinRatioPct: 0 } })
    expect(bad.status).toBe(400)
    expect(await bad.json()).toMatchObject({ error: 'invalid_params', field: 'thinRatioPct' })
    const unnamed = await post({ name: '   ', preset: 'queue-depletion' })
    expect(unnamed.status).toBe(400)
    expect(await unnamed.json()).toMatchObject({ error: 'invalid_request', field: 'name' })
    expect(s.repo.strategies.size).toBe(0)
  })

  it('another session neither sees nor deletes; own session deletes — 204, then 404', async () => {
    const { id } = (await (await post({ name: 'mine', preset: 'momentum-chase' })).json()) as {
      id: string
    }
    expect(await list(OTHER)).toEqual([])
    const del = (session: string) =>
      s.app.request(`/strategies/${id}`, {
        method: 'DELETE',
        headers: { 'X-Session-Key': session },
      })
    expect((await del(OTHER)).status).toBe(404)
    expect((await list()).length).toBe(1)
    expect((await del(SESSION)).status).toBe(204)
    expect((await del(SESSION)).status).toBe(404)
    expect(await list()).toEqual([])
  })

  it('a saved configuration starts a run as is (FR-017)', async () => {
    const saved = (await (
      await post({ name: 'thin 30', preset: 'queue-depletion', params: { thinRatioPct: 30 } })
    ).json()) as { preset: string; params: Record<string, number> }
    const res = await postRun(s.app, { ...goodRun, preset: saved.preset, params: saved.params })
    expect(res.status).toBe(201)
    const { runId } = (await res.json()) as { runId: string }
    const run = (await (
      await s.app.request(`/runs/${runId}`, { headers: { 'X-Session-Key': SESSION } })
    ).json()) as { status: string; params: Record<string, number> }
    expect(run.status).toBe('done')
    expect(run.params).toEqual(saved.params)
  })
})
