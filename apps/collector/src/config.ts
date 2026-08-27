import { z } from 'zod'

const wsUrl = z.string().regex(/^wss?:\/\//, 'a ws:// or wss:// address is required')

/** Collector config from the environment. Types come from the schema, not by hand (rule 7). */
export const CollectorEnv = z.object({
  DATABASE_URL: z.string().min(1),
  RPC_A_NAME: z.string().min(1),
  RPC_A_WS_URL: wsUrl,
  RPC_B_NAME: z.string().min(1),
  RPC_B_WS_URL: wsUrl,
  MARKET_ADDRESSES: z
    .string()
    .transform((s) =>
      s
        .split(',')
        .map((a) => a.trim())
        .filter(Boolean),
    )
    .pipe(z.array(z.string().min(32)).min(1, 'at least one market address is required')),
  BOOK_DEPTH: z.coerce.number().int().min(1).max(255).prefault(15),
  LOG_LEVEL: z.string().prefault('info'),
  /** Seconds without a slot after which a channel counts as dead. */
  LIVENESS_TIMEOUT_SEC: z.coerce.number().int().min(1).prefault(5),
  /** How often to persist `to_ts` of the open coverage segment. */
  COVERAGE_HEARTBEAT_SEC: z.coerce.number().int().min(1).prefault(10),
})

export type CollectorEnv = z.infer<typeof CollectorEnv>

export function loadEnv(env: NodeJS.ProcessEnv = process.env): CollectorEnv {
  const parsed = CollectorEnv.safeParse(env)
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`)
    throw new Error(`collector config is incomplete:\n${lines.join('\n')}`)
  }
  if (parsed.data.RPC_A_WS_URL === parsed.data.RPC_B_WS_URL) {
    throw new Error(
      'RPC_A and RPC_B are the same address: a differential measurement needs two independent channels',
    )
  }
  return parsed.data
}
