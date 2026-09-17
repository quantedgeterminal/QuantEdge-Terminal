import { describe, expect, it } from 'vitest'
import { createApp } from '../src/app.ts'
import { MemoryRepo } from '../src/memory-repo.ts'

const ORIGIN = 'https://example.github.io'

describe('CORS for a web app hosted on another origin (T051)', () => {
  it('without webOrigins no CORS header is emitted at all', async () => {
    const app = createApp(new MemoryRepo(), () => 'k')
    const res = await app.request('/health', { headers: { Origin: ORIGIN } })
    expect(res.status).toBe(200)
    expect(res.headers.get('access-control-allow-origin')).toBeNull()
  })

  it('a listed origin gets the header, plus the session-key and Retry-After allowances', async () => {
    const app = createApp(new MemoryRepo(), () => 'k', Date.now, { webOrigins: [ORIGIN] })
    const preflight = await app.request('/runs', {
      method: 'OPTIONS',
      headers: {
        Origin: ORIGIN,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'x-session-key, content-type',
      },
    })
    expect(preflight.status).toBe(204)
    expect(preflight.headers.get('access-control-allow-origin')).toBe(ORIGIN)
    expect(preflight.headers.get('access-control-allow-headers')?.toLowerCase()).toContain(
      'x-session-key',
    )

    const res = await app.request('/health', { headers: { Origin: ORIGIN } })
    expect(res.headers.get('access-control-allow-origin')).toBe(ORIGIN)
    expect(res.headers.get('access-control-expose-headers')).toContain('Retry-After')
  })

  it('an origin that is not listed gets no allow-origin header', async () => {
    const app = createApp(new MemoryRepo(), () => 'k', Date.now, { webOrigins: [ORIGIN] })
    const res = await app.request('/health', { headers: { Origin: 'https://evil.example' } })
    expect(res.status).toBe(200)
    expect(res.headers.get('access-control-allow-origin')).toBeNull()
  })
})
