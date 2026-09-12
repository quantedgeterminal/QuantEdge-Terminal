import { PRICE_SCALE } from '@quantedge/engine'
import { packLevels } from '@quantedge/shared'
import { describe, expect, it } from 'vitest'
import { createApp } from '../src/app.ts'
import { MemoryRepo } from '../src/memory-repo.ts'
import { BookFeed, STALE_AFTER_MS, type StreamFrame } from '../src/stream.ts'

const T0 = Date.parse('2026-09-04T12:00:00Z')

const MARKET = {
  id: 1,
  venue: 'manifest',
  address: 'x',
  label: 'cbBTC/USDC',
  baseDecimals: 8,
  quoteDecimals: 6,
  baseSymbol: 'cbBTC',
  quoteSymbol: 'USDC',
  active: true,
}

function repoWith(times: number[]): MemoryRepo {
  const repo = new MemoryRepo()
  repo.markets.push(MARKET)
  repo.books.set(
    1,
    times.map((t, i) => ({
      tMs: t,
      levels: packLevels({
        bids: [{ price: BigInt(100 + i) * PRICE_SCALE, size: 5n }],
        asks: [{ price: BigInt(101 + i) * PRICE_SCALE, size: 7n }],
      }),
    })),
  )
  return repo
}

describe('BookFeed', () => {
  it('a frame on a new event, then silence until heartbeat, then a frame with age', async () => {
    const repo = repoWith([T0])
    let now = T0 + 100
    const feed = new BookFeed(repo, { market: MARKET, profile: null, now: () => now })
    const first = await feed.next(1000)
    expect(first).toMatchObject({ ageMs: 100, stale: false, pathKind: 'real', profile: null })
    expect(first?.asks[0]).toEqual({ price: (101n * PRICE_SCALE).toString(), size: '7' })

    now = T0 + 600
    expect(await feed.next(1000)).toBeNull() // nothing new, heartbeat not due

    now = T0 + 1200
    const beat = await feed.next(1000)
    expect(beat?.ageMs).toBe(1200)
  })

  it('SC-005: heartbeat leads by the polling period so the gap never exceeds a second', async () => {
    const repo = repoWith([T0])
    let now = T0 + 100
    const feed = new BookFeed(repo, { market: MARKET, profile: null, now: () => now })
    expect(await feed.next(1000, 500)).not.toBeNull()

    now = T0 + 500 // 400 elapsed: the next poll would be at 900 — too early
    expect(await feed.next(1000, 500)).toBeNull()

    now = T0 + 700 // 600 elapsed: the next poll at 1100 is too late, frame now
    expect(await feed.next(1000, 500)?.then((f) => f?.ageMs)).toBe(700)
  })

  it('FR-020: without new events the age grows and the book turns stale past the threshold', async () => {
    const repo = repoWith([T0])
    let now = T0
    const feed = new BookFeed(repo, { market: MARKET, profile: null, now: () => now })
    await feed.next(1000)
    now = T0 + STALE_AFTER_MS + 1
    const f = await feed.next(1000)
    expect(f).toMatchObject({ stale: true, ageMs: STALE_AFTER_MS + 1 })
  })

  it('emulation +2000 ms: the event shows only after 2 s, age counts from delivery, kind emulated', async () => {
    const repo = repoWith([T0, T0 + 1000])
    let now = T0 + 1500
    const profile = { offsetMs: 2000, source: 'user' }
    const feed = new BookFeed(repo, { market: MARKET, profile, now: () => now })
    expect(await feed.next(1000)).toBeNull() // even the first event is still "in transit"

    now = T0 + 2100
    const a = await feed.next(1000)
    expect(a).toMatchObject({
      t: new Date(T0).toISOString(),
      ageMs: 100,
      pathKind: 'emulated',
      profile,
    })
    expect(a?.pathName).toBe('emulated +2000 ms')

    now = T0 + 3100
    const b = await feed.next(1000)
    expect(b?.t).toBe(new Date(T0 + 1000).toISOString())
    expect(b?.ageMs).toBe(100)
  })

  it('a negative offset cannot deliver earlier: data as is, but labelled', async () => {
    const repo = repoWith([T0])
    const feed = new BookFeed(repo, {
      market: MARKET,
      profile: { offsetMs: -300, source: 'claimed' },
      now: () => T0 + 50,
    })
    const f = await feed.next(1000)
    expect(f).toMatchObject({ ageMs: 50, pathKind: 'emulated', pathName: 'emulated -300 ms' })
  })

  it('a market without events — no frames', async () => {
    const feed = new BookFeed(repoWith([]), { market: MARKET, profile: null, now: () => T0 })
    expect(await feed.next(1000)).toBeNull()
  })
})

/** First SSE frame of the response, after which the connection is dropped. */
async function firstFrame(res: Response): Promise<StreamFrame> {
  const reader = res.body?.getReader()
  if (!reader) throw new Error('no body')
  let text = ''
  const decoder = new TextDecoder()
  for (;;) {
    const { value, done } = await reader.read()
    if (done) throw new Error('stream closed without a frame')
    text += decoder.decode(value, { stream: true })
    const m = text.match(/data: (.*)\n/)
    if (m?.[1]) {
      await reader.cancel()
      return JSON.parse(m[1]) as StreamFrame
    }
  }
}

describe('GET /markets/:id/stream (T038)', () => {
  const opts = { streamPollMs: 5, streamHeartbeatMs: 50 }

  it('SSE with a book frame; pathKind real without a profile', async () => {
    const app = createApp(
      repoWith([T0]),
      () => 'k',
      () => T0 + 10,
      opts,
    )
    const res = await app.request('/markets/1/stream')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toMatch(/text\/event-stream/)
    const f = await firstFrame(res)
    expect(f).toMatchObject({ pathKind: 'real', ageMs: 10, stale: false })
    expect(f.bids).toHaveLength(1)
    expect(f.market).toEqual({
      id: 1,
      label: 'cbBTC/USDC',
      venue: 'manifest',
      baseDecimals: 8,
      quoteDecimals: 6,
      baseSymbol: 'cbBTC',
      quoteSymbol: 'USDC',
    })
  })

  it('a profile in the query — an emulated channel with the mark and the source', async () => {
    const app = createApp(
      repoWith([T0]),
      () => 'k',
      () => T0 + 700,
      opts,
    )
    const res = await app.request('/markets/1/stream?offsetMs=500&source=user')
    const f = await firstFrame(res)
    expect(f).toMatchObject({ pathKind: 'emulated', profile: { offsetMs: 500, source: 'user' } })
    expect(f.ageMs).toBe(200)
  })

  it('offset without a source — 400; unknown market — 404', async () => {
    const app = createApp(
      repoWith([T0]),
      () => 'k',
      () => T0,
      opts,
    )
    expect((await app.request('/markets/1/stream?offsetMs=500')).status).toBe(400)
    expect((await app.request('/markets/9/stream')).status).toBe(404)
  })
})
