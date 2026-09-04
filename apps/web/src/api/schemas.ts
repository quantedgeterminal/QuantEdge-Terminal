import { z } from 'zod'

/** API response shapes. Types are inferred from here, not written by hand (rule 7). */

export const Market = z.object({
  id: z.int(),
  label: z.string(),
  venue: z.string(),
  active: z.boolean(),
  baseDecimals: z.int(),
  quoteDecimals: z.int(),
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
})
export type LevelResult = z.infer<typeof LevelResult>

export const Cost = z.object({
  costPer100Ms: money,
  fromMs: z.int(),
  toMs: z.int(),
  excludedMs: z.array(z.int()),
})
export type Cost = z.infer<typeof Cost>

export const Run = z.object({
  id: z.uuid(),
  status: z.enum(['queued', 'running', 'done', 'failed']),
  error: z.string().nullable(),
  market: z.object({
    id: z.int(),
    label: z.string(),
    baseDecimals: z.int(),
    quoteDecimals: z.int(),
  }),
  preset: z.string(),
  params: z.record(z.string(), z.number()),
  from: z.iso.datetime(),
  to: z.iso.datetime(),
  levelsMs: z.array(z.int()),
  results: z.array(LevelResult),
  cost: Cost.nullable(),
  createdAt: z.iso.datetime(),
  finishedAt: z.iso.datetime().nullable(),
})
export type Run = z.infer<typeof Run>

export const MissingRanges = z.object({
  error: z.literal('incomplete_period'),
  missingRanges: z.array(z.object({ from: z.iso.datetime(), to: z.iso.datetime() })),
})

export const ParamProblem = z.object({
  error: z.literal('invalid_params'),
  field: z.string(),
  message: z.string(),
})
