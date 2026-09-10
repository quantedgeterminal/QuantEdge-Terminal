import { PRICE_SCALE } from '@quantedge/engine'
import { PathKind, packLevels } from '@quantedge/shared'
import { describe, expect, it } from 'vitest'
import { createApp } from '../src/app.ts'
import { MemoryRepo } from '../src/memory-repo.ts'

/**
 * SC-007 / T041: no API response with channel data goes out without `kind`.
 * The check is structural: any object in the JSON that looks like channel data
 * (has `pathId` or `p50Ms`) must carry `kind` with a `PathKind` value.
 */

const NOW = Date.parse('2026-09-04T12:00:00Z')

function looksLikePathData(o: Record<string, unknown>): boolean {
  return 'pathId' in o || 'p50Ms' in o || 'p95Ms' in o || 'pathName' in o || 'bids' in o
}

/** The mark may be called `kind` (channel table) or `pathKind` (stream frame). */
function kindOf(o: Record<string, unknown>): unknown {
  return 'kind' in o ? o.kind : o.pathKind
}

/** Returns the paths of channel objects without a valid `kind`. */
function audit(value: unknown, path = '$'): string[] {
  if (Array.isArray(value)) return value.flatMap((v, i) => audit(v, `${path}[${i}]`))
  if (value === null || typeof value !== 'object') return []
  const o = value as Record<string, unknown>
  const own = looksLikePathData(o) && !PathKind.safeParse(kindOf(o)).success ? [path] : []
  return [...own, ...Object.entries(o).flatMap(([k, v]) => audit(v, `${path}.${k}`))]
}

function setup() {
  const repo = new MemoryRepo()
  repo.markets.push({
    id: 1,
    venue: 'manifest',
    address: 'x',
    label: 'cbBTC/USDC',
    baseDecimals: 8,
    quoteDecimals: 6,
    active: true,
  })
  repo.pathRows.push(
    { id: 1, name: 'helius', kind: 'real' },
    { id: 2, name: 'alchemy', kind: 'real' },
    { id: 3, name: 'emu-fast', kind: 'emulated' },
  )
  const t = NOW - 10_000
  repo.arrivalRows.set(1, [
    { bookUpdateId: 1n, pathId: 1, receivedAtUs: BigInt(t) * 1000n, tMs: t },
    { bookUpdateId: 1n, pathId: 2, receivedAtUs: BigInt(t + 35) * 1000n, tMs: t },
    { bookUpdateId: 1n, pathId: 3, receivedAtUs: BigInt(t - 5) * 1000n, tMs: t },
    // An event outside the 60 s window is not measured.
    { bookUpdateId: 2n, pathId: 1, receivedAtUs: 1n, tMs: NOW - 120_000 },
    { bookUpdateId: 2n, pathId: 2, receivedAtUs: 2n, tMs: NOW - 120_000 },
  ])
  repo.books.set(1, [
    {
      tMs: NOW - 400,
      levels: packLevels({
        bids: [{ price: 100n * PRICE_SCALE, size: 1n }],
        asks: [{ price: 101n * PRICE_SCALE, size: 1n }],
      }),
    },
  ])
  return createApp(
    repo,
    () => '44444444-4444-4444-8444-444444444444',
    () => NOW,
    { streamPollMs: 5, streamHeartbeatMs: 50 },
  )
}

/** First SSE frame as JSON. */
async function firstSseFrame(res: Response): Promise<unknown> {
  const reader = res.body?.getReader()
  if (!reader) throw new Error('no body')
  const decoder = new TextDecoder()
  let text = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) throw new Error('stream closed without a frame')
    text += decoder.decode(value, { stream: true })
    const m = text.match(/data: (.*)\n/)
    if (m?.[1]) {
      await reader.cancel()
      return JSON.parse(m[1])
    }
  }
}

/** Every route that carries channel data. A new route with channels goes here. */
const CHANNEL_ROUTES = [
  '/markets/1/latency',
  '/markets/1/arrivals',
  '/markets/1/stream',
  '/markets/1/stream?offsetMs=100&source=user',
]

describe('pathKind audit (SC-007)', () => {
  const app = setup()

  it.each(CHANNEL_ROUTES)('%s: every channel object has kind', async (route) => {
    const res = await app.request(route)
    expect(res.status).toBe(200)
    const sse = res.headers.get('content-type')?.includes('text/event-stream') ?? false
    const body = sse ? await firstSseFrame(res) : await res.json()
    expect(audit(body)).toEqual([])
  })

  it('the auditor catches a missing and a foreign kind — in the table and in the frame', () => {
    expect(audit({ paths: [{ pathId: 1, name: 'x' }] })).toEqual(['$.paths[0]'])
    expect(audit({ paths: [{ p50Ms: 3, kind: 'fast' }] })).toEqual(['$.paths[0]'])
    expect(audit({ paths: [{ p50Ms: 3, kind: 'emulated' }] })).toEqual([])
    expect(audit({ bids: [], asks: [] })).toEqual(['$'])
    expect(audit({ bids: [], asks: [], pathKind: 'real' })).toEqual([])
  })

  it('/latency: 60 s window, measured only between real channels, emulation labelled', async () => {
    const res = await app.request('/markets/1/latency')
    const body = (await res.json()) as {
      measurable: boolean
      sharedEvents: number
      windowSec: number
      paths: { name: string; kind: string; p50Ms: number | null }[]
    }
    expect(body.measurable).toBe(true)
    expect(body.sharedEvents).toBe(1)
    expect(body.windowSec).toBe(60)
    expect(body.paths.map((p) => [p.name, p.kind, p.p50Ms])).toEqual([
      ['helius', 'real', 0],
      ['alchemy', 'real', 35],
      ['emu-fast', 'emulated', null],
    ])
    expect((await app.request('/markets/9/latency')).status).toBe(404)
  })

  it('/arrivals: event rows with lag only on real channels, emulation without it', async () => {
    const res = await app.request('/markets/1/arrivals')
    const body = (await res.json()) as {
      windowSec: number
      paths: { pathId: number; kind: string }[]
      events: {
        eventId: string
        arrivals: { pathId: number; kind: string; lagMs: number | null }[]
      }[]
    }
    expect(body.windowSec).toBe(60)
    expect(body.paths.map((p) => p.kind)).toEqual(['real', 'real', 'emulated'])
    expect(body.events.map((e) => e.eventId)).toEqual(['1'])
    expect(body.events[0]?.arrivals).toEqual([
      { pathId: 1, kind: 'real', lagMs: 0 },
      { pathId: 2, kind: 'real', lagMs: 35 },
      { pathId: 3, kind: 'emulated', lagMs: null },
    ])
    expect((await app.request('/markets/9/arrivals')).status).toBe(404)
  })
})
