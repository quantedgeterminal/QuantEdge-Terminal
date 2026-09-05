import { PathKind } from '@quantedge/shared'
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
  return 'pathId' in o || 'p50Ms' in o || 'p95Ms' in o
}

/** Returns the paths of channel objects without a valid `kind`. */
function audit(value: unknown, path = '$'): string[] {
  if (Array.isArray(value)) return value.flatMap((v, i) => audit(v, `${path}[${i}]`))
  if (value === null || typeof value !== 'object') return []
  const o = value as Record<string, unknown>
  const own = looksLikePathData(o) && !PathKind.safeParse(o.kind).success ? [path] : []
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
  return createApp(
    repo,
    () => '44444444-4444-4444-8444-444444444444',
    () => NOW,
  )
}

/** Every route that carries channel data. A new route with channels goes here. */
const CHANNEL_ROUTES = ['/markets/1/latency']

describe('pathKind audit (SC-007)', () => {
  const app = setup()

  it.each(CHANNEL_ROUTES)('%s: every channel object has kind', async (route) => {
    const res = await app.request(route)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(audit(body)).toEqual([])
  })

  it('the auditor catches a missing and a foreign kind', () => {
    expect(audit({ paths: [{ pathId: 1, name: 'x' }] })).toEqual(['$.paths[0]'])
    expect(audit({ paths: [{ p50Ms: 3, kind: 'fast' }] })).toEqual(['$.paths[0]'])
    expect(audit({ paths: [{ p50Ms: 3, kind: 'emulated' }] })).toEqual([])
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
})
