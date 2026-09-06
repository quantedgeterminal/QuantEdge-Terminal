import { presets } from '@quantedge/engine'
import { z } from 'zod'

/** Every boundary is validated by Zod; no route reads `req.json()` directly (PLAN). */

const presetIds = presets.map((p) => p.id)
const first = presetIds[0]
if (first === undefined) throw new Error('engine has no presets')

export const PresetId = z.enum([first, ...presetIds.slice(1)])

/** Default delay levels (FR-008); the choice is in PLAN. */
export const DEFAULT_LEVELS_MS = [0, 50, 100, 200, 400] as const

export const RunRequest = z.object({
  marketId: z.int().positive(),
  from: z.iso.datetime(),
  to: z.iso.datetime(),
  preset: PresetId,
  /** Partial parameters on top of the preset defaults. */
  params: z.record(z.string(), z.int()).prefault({}),
  levelsMs: z
    .array(z.int().min(0).max(60_000))
    .min(1)
    .max(10)
    .prefault([...DEFAULT_LEVELS_MS]),
})
export type RunRequest = z.infer<typeof RunRequest>

export const MarketIdParam = z.object({ id: z.coerce.number().int().positive() })

/**
 * Emulated-channel profile in the stream query (FR-005a): offset in ms and the source
 * of the number. Both or neither: an offset without a source is a claim without a reference.
 */
export const StreamQuery = z.object({
  offsetMs: z.coerce.number().int().min(-60_000).max(60_000).optional(),
  source: z.string().min(1).max(200).optional(),
})
export const RunIdParam = z.object({ id: z.uuid() })

/** Anonymous session key (FR-022a): the UUID issued by `POST /session`. */
export const SessionKey = z.uuid()
