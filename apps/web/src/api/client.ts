import { z } from 'zod'
import {
  Arrivals,
  CoverageSegment,
  FieldProblem,
  LatencySummary,
  Market,
  MissingRanges,
  Preset,
  Run,
  Strategy,
} from './schemas.ts'

const BASE = import.meta.env.VITE_API_URL ?? '/api'
const SESSION_STORAGE_KEY = 'quantedge.session'

/** An API error the screen shows as is: code and, when present, an explanation. */
export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly detail: unknown
  constructor(status: number, code: string, message: string, detail: unknown = null) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.detail = detail
  }
}

/** A run over an incomplete period (FR-014): the API named the missing ranges. */
export class IncompletePeriod extends ApiError {
  readonly missingRanges: { from: string; to: string }[]
  constructor(ranges: { from: string; to: string }[]) {
    super(409, 'incomplete_period', 'period is not fully recorded')
    this.name = 'IncompletePeriod'
    this.missingRanges = ranges
  }
}

/** A field failed (FR-016): an error on a specific field — a preset parameter or a request field. */
export class InvalidField extends ApiError {
  readonly field: string
  /** `true` — the field is a preset parameter, shown by the parameter editor. */
  readonly isParam: boolean
  constructor(problem: FieldProblem) {
    super(400, problem.error, problem.message)
    this.name = 'InvalidField'
    this.field = problem.field
    this.isParam = problem.error === 'invalid_params'
  }
}

function readSession(): string | null {
  try {
    return localStorage.getItem(SESSION_STORAGE_KEY)
  } catch {
    return null
  }
}

function writeSession(key: string): void {
  try {
    localStorage.setItem(SESSION_STORAGE_KEY, key)
  } catch {
    // Without storage the session lives until reload — a run is still possible.
  }
}

let sessionPromise: Promise<string> | null = null

/** Anonymous session key (FR-022a): one per browser, created lazily. */
export function session(): Promise<string> {
  if (sessionPromise) return sessionPromise
  const existing = readSession()
  if (existing) {
    sessionPromise = Promise.resolve(existing)
    return sessionPromise
  }
  sessionPromise = fetch(`${BASE}/session`, { method: 'POST' })
    .then(async (res) => {
      if (!res.ok) throw new ApiError(res.status, 'session_failed', 'could not open a session')
      const { key } = z.object({ key: z.uuid() }).parse(await res.json())
      writeSession(key)
      return key
    })
    .catch((e) => {
      sessionPromise = null
      throw e
    })
  return sessionPromise
}

async function get<T>(path: string, schema: z.ZodType<T>, withSession = false): Promise<T> {
  const headers: Record<string, string> = {}
  if (withSession) headers['X-Session-Key'] = await session()
  const res = await fetch(`${BASE}${path}`, { headers })
  if (!res.ok) throw new ApiError(res.status, `http_${res.status}`, `${path} → ${res.status}`)
  return schema.parse(await res.json())
}

/** Request with a body and the session key; a field failure becomes `InvalidField`, the rest `ApiError`. */
async function send(method: 'POST' | 'DELETE', path: string, body?: unknown): Promise<Response> {
  const headers: Record<string, string> = { 'X-Session-Key': await session() }
  if (body !== undefined) headers['content-type'] = 'application/json'
  const init: RequestInit = { method, headers }
  if (body !== undefined) init.body = JSON.stringify(body)
  const res = await fetch(`${BASE}${path}`, init)
  if (res.ok) return res
  const json: unknown = res.status === 204 ? null : await res.json().catch(() => null)
  const field = FieldProblem.safeParse(json)
  if (field.success) throw new InvalidField(field.data)
  throw new ApiError(res.status, `http_${res.status}`, `${method} ${path} → ${res.status}`, json)
}

export const api = {
  markets: () => get('/markets', z.array(Market)),
  coverage: (marketId: number) => get(`/markets/${marketId}/coverage`, z.array(CoverageSegment)),
  presets: () => get('/presets', z.array(Preset)),
  market: (id: number) =>
    get('/markets', z.array(Market)).then((ms) => ms.find((m) => m.id === id) ?? null),
  latency: (marketId: number) => get(`/markets/${marketId}/latency`, LatencySummary),
  arrivals: (marketId: number) => get(`/markets/${marketId}/arrivals`, Arrivals),
  run: (id: string) => get(`/runs/${id}`, Run, true),

  async startRun(body: {
    marketId: number
    from: string
    to: string
    preset: string
    params?: Record<string, number>
  }): Promise<string> {
    const res = await fetch(`${BASE}/runs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-Session-Key': await session() },
      body: JSON.stringify(body),
    })
    const json: unknown = await res.json()
    if (res.status === 201) return z.object({ runId: z.uuid() }).parse(json).runId
    const gaps = MissingRanges.safeParse(json)
    if (gaps.success) throw new IncompletePeriod(gaps.data.missingRanges)
    const field = FieldProblem.safeParse(json)
    if (field.success) throw new InvalidField(field.data)
    throw new ApiError(res.status, `http_${res.status}`, `POST /runs → ${res.status}`, json)
  },

  /** Saved strategies of this session (FR-017); absent in another browser (FR-022a). */
  strategies: () => get('/strategies', z.array(Strategy), true),
  saveStrategy: async (body: { name: string; preset: string; params: Record<string, number> }) =>
    Strategy.parse(await (await send('POST', '/strategies', body)).json()),
  deleteStrategy: async (id: string): Promise<void> => {
    await send('DELETE', `/strategies/${id}`)
  },
}
