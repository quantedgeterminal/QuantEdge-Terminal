import { z } from 'zod'

/**
 * Delivery channel type (FR-004). The value lives in the DB and travels in every payload that
 * carries channel data: the emulation mark is a data field, not a component decision
 * (SC-007).
 */
export const PathKind = z.enum(['real', 'emulated'])
export type PathKind = z.infer<typeof PathKind>
