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
  /**
   * Watchdog (T055): seconds without a slot after which a channel is resubscribed.
   * Well above `LIVENESS_TIMEOUT_SEC` on purpose — a gap in coverage is cheap and
   * self-healing, while dropping a subscription costs a reconnect at the provider.
   */
  WATCHDOG_SILENCE_SEC: z.coerce.number().int().min(1).prefault(120),
  /** How often the watchdog looks at the channels. */
  WATCHDOG_CHECK_SEC: z.coerce.number().int().min(1).prefault(30),
  /** Wait before the first retry; doubles with each failure up to the maximum. */
  WATCHDOG_BACKOFF_SEC: z.coerce.number().int().min(1).prefault(30),
  WATCHDOG_MAX_BACKOFF_SEC: z.coerce.number().int().min(1).prefault(900),
  /** Retention (T054): how many hours of full data to keep; unset — never delete. */
  RETENTION_HOURS: z.coerce.number().int().min(1).optional(),
  RETENTION_INTERVAL_MIN: z.coerce.number().int().min(1).prefault(60),
  RETENTION_BATCH: z.coerce.number().int().min(1).prefault(5000),
  /** Frozen interval — the reference dataset the cleanup never touches. Both or neither. */
  FROZEN_FROM: z.iso.datetime().optional(),
  FROZEN_TO: z.iso.datetime().optional(),
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
  const { FROZEN_FROM, FROZEN_TO } = parsed.data
  if ((FROZEN_FROM === undefined) !== (FROZEN_TO === undefined)) {
    throw new Error('FROZEN_FROM and FROZEN_TO go together')
  }
  if (FROZEN_FROM !== undefined && FROZEN_TO !== undefined && FROZEN_FROM >= FROZEN_TO) {
    throw new Error('FROZEN_FROM must be earlier than FROZEN_TO')
  }
  return parsed.data
}

/** Frozen interval in epoch µs, or `null` when not set. */
export function frozenInterval(env: CollectorEnv): { fromUs: bigint; toUs: bigint } | null {
  if (env.FROZEN_FROM === undefined || env.FROZEN_TO === undefined) return null
  return {
    fromUs: BigInt(Date.parse(env.FROZEN_FROM)) * 1000n,
    toUs: BigInt(Date.parse(env.FROZEN_TO)) * 1000n,
  }
}
