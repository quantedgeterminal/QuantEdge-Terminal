import { z } from 'zod'

/** API response shapes. Types are inferred from here, not written by hand (rule 7). */

/** Channel mark (FR-004): the same values as in the DB and in `@quantedge/shared`. */
export const PathKind = z.enum(['real', 'emulated'])
export type PathKind = z.infer<typeof PathKind>

export const PathLatency = z.object({
  pathId: z.int(),
  name: z.string(),
  kind: PathKind,
  p50Ms: z.int().nullable(),
  p95Ms: z.int().nullable(),
  sampleCount: z.int(),
  laterPct: z.int().nullable(),
  /** Last event over this channel, epoch ms; `null` — never (T057). */
  lastEventAtMs: z.int().nullable(),
})
export type PathLatency = z.infer<typeof PathLatency>

export const LatencySummary = z.object({
  windowSec: z.int(),
  paths: z.array(PathLatency),
  measurable: z.boolean(),
  sharedEvents: z.int(),
})
export type LatencySummary = z.infer<typeof LatencySummary>

/** A channel in the `/arrivals` response table. */
export const PathRef = z.object({ pathId: z.int(), name: z.string(), kind: PathKind })
export type PathRef = z.infer<typeof PathRef>

/** A book event with per-channel arrivals (FR-021); `lagMs` exists only for real ones (FR-003c). */
export const ArrivalEvent = z.object({
  eventId: z.string(),
  firstRealMs: z.int(),
  arrivals: z.array(z.object({ pathId: z.int(), kind: PathKind, lagMs: z.int().nullable() })),
})
export type ArrivalEvent = z.infer<typeof ArrivalEvent>

export const Arrivals = z.object({
  windowSec: z.int(),
  paths: z.array(PathRef),
  events: z.array(ArrivalEvent),
})
export type Arrivals = z.infer<typeof Arrivals>

export const Market = z.object({
  id: z.int(),
  label: z.string(),
  venue: z.string(),
  active: z.boolean(),
  baseDecimals: z.int(),
  quoteDecimals: z.int(),
  baseSymbol: z.string(),
  quoteSymbol: z.string(),
})
export type Market = z.infer<typeof Market>

export const CoverageSegment = z.object({
  from: z.iso.datetime(),
  to: z.iso.datetime(),
  updateCount: z.int(),
})
export type CoverageSegment = z.infer<typeof CoverageSegment>

export const ParamSpec = z.object({
  key: z.string(),
  label: z.string(),
  unit: z.string(),
  min: z.number(),
  max: z.number(),
  default: z.number(),
})
export type ParamSpec = z.infer<typeof ParamSpec>

export const Preset = z.object({
  id: z.string(),
  label: z.string(),
  summary: z.string(),
  params: z.array(ParamSpec),
})
export type Preset = z.infer<typeof Preset>

/** Money arrives as decimal strings in the smallest units — never converted to float. */
const money = z.string().regex(/^-?\d+$/)

export const LevelResult = z.object({
  latencyMs: z.int(),
  pnl: money,
  orders: z.int(),
  trades: z.int(),
  unfilled: z.int(),
  unfilledPct: z.int(),
  slippageSum: money,
  filledNotional: money,
  avgSlippageBp: z.number().nullable(),
  maxDrawdown: money,
  finalPosition: money,
  /** The next-faster level of the grid this row is measured against; `null` on the fastest. */
  comparedWithMs: z.int().nullable(),
  /** Steps where this level saw a different book state than that one; `null` — not measured. */
  shiftedSteps: z.int().nullable(),
  /** The same as a share of the run's steps. `0` — the data cannot separate the two levels. */
  shiftedPct: z.number().nullable(),
})
export type LevelResult = z.infer<typeof LevelResult>

export const Cost = z.object({
  costPer100Ms: money,
  fromMs: z.int(),
  toMs: z.int(),
  excludedMs: z.array(z.int()),
})
export type Cost = z.infer<typeof Cost>

/** The grain of the period the run walked (FR-013a) — what the grid above is allowed to claim. */
export const Resolution = z.object({
  steps: z.int(),
  medianGapMs: z.int().nullable(),
})
export type Resolution = z.infer<typeof Resolution>

export const Run = z.object({
  id: z.uuid(),
  status: z.enum(['queued', 'running', 'done', 'failed']),
  error: z.string().nullable(),
  market: z.object({
    id: z.int(),
    label: z.string(),
    baseDecimals: z.int(),
    quoteDecimals: z.int(),
    baseSymbol: z.string(),
    quoteSymbol: z.string(),
  }),
  preset: z.string(),
  params: z.record(z.string(), z.number()),
  from: z.iso.datetime(),
  to: z.iso.datetime(),
  levelsMs: z.array(z.int()),
  results: z.array(LevelResult),
  cost: Cost.nullable(),
  resolution: Resolution.nullable(),
  createdAt: z.iso.datetime(),
  finishedAt: z.iso.datetime().nullable(),
})
export type Run = z.infer<typeof Run>

export const MissingRanges = z.object({
  error: z.literal('incomplete_period'),
  missingRanges: z.array(z.object({ from: z.iso.datetime(), to: z.iso.datetime() })),
})

/** Saved strategy configuration (FR-017): full parameters, as in a run. */
export const Strategy = z.object({
  id: z.uuid(),
  name: z.string(),
  preset: z.string(),
  params: z.record(z.string(), z.number()),
  createdAt: z.iso.datetime(),
})
export type Strategy = z.infer<typeof Strategy>

/** An error on a specific field (FR-016): a preset parameter or any other request field. */
export const FieldProblem = z.object({
  error: z.enum(['invalid_params', 'invalid_request', 'invalid_period', 'period_too_long']),
  field: z.string(),
  message: z.string(),
})
export type FieldProblem = z.infer<typeof FieldProblem>

/** Run quota exhausted (FR-023): which one and when it is allowed again. */
export const QuotaProblem = z.object({
  error: z.literal('quota_exceeded'),
  scope: z.enum(['session', 'ip']),
  limit: z.int(),
  windowSec: z.int(),
  retryAfterSec: z.int(),
})
export type QuotaProblem = z.infer<typeof QuotaProblem>
