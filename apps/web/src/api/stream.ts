import { z } from 'zod'
import { PathKind } from './schemas.ts'

const BASE = import.meta.env.VITE_API_URL ?? '/api'

const LevelDto = z.object({ price: z.string().regex(/^\d+$/), size: z.string().regex(/^\d+$/) })

/** A live-stream frame. `pathKind` is required: without it the frame is rejected (SC-007). */
export const Frame = z.object({
  market: z.object({
    id: z.int(),
    label: z.string(),
    venue: z.string(),
    baseDecimals: z.int(),
    quoteDecimals: z.int(),
  }),
  t: z.iso.datetime(),
  ageMs: z.int(),
  stale: z.boolean(),
  staleAfterMs: z.int(),
  pathKind: PathKind,
  pathName: z.string(),
  profile: z.object({ offsetMs: z.int(), source: z.string() }).nullable(),
  bids: z.array(LevelDto),
  asks: z.array(LevelDto),
})
export type Frame = z.infer<typeof Frame>

export interface BookStream {
  close(): void
}

/**
 * Subscription to `GET /markets/:id/stream`. A frame that fails the schema is not
 * passed on — better an empty screen than a book without the channel mark.
 */
export function openBookStream(
  marketId: number,
  onFrame: (f: Frame) => void,
  onError: (e: Error) => void,
): BookStream {
  const es = new EventSource(`${BASE}/markets/${marketId}/stream`)
  es.addEventListener('book', (ev) => {
    const parsed = Frame.safeParse(JSON.parse((ev as MessageEvent<string>).data))
    if (parsed.success) onFrame(parsed.data)
    else onError(new Error(`frame rejected: ${parsed.error.issues[0]?.message ?? 'schema'}`))
  })
  es.onerror = () => onError(new Error('stream disconnected'))
  return { close: () => es.close() }
}
