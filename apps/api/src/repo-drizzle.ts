import {
  arrivals,
  backtestRuns,
  bookUpdates,
  type Db,
  datasetCoverage,
  deliveryPaths,
  markets,
  runResults,
  sessions,
  strategies,
} from '@quantedge/db'
import type { LevelResult } from '@quantedge/engine'
import { and, asc, count, desc, eq, gte, lte, min, sql } from 'drizzle-orm'
import type { Repo, RunRow, StrategyRow } from './repo.ts'

const ms = (d: Date): number => d.getTime()

function toRunRow(r: typeof backtestRuns.$inferSelect): RunRow {
  return {
    id: r.id,
    sessionKey: r.sessionKey,
    marketId: r.marketId,
    fromMs: ms(r.fromTs),
    toMs: ms(r.toTs),
    preset: r.preset,
    // In the DB parameters are `unknown` JSON; Zod shapes them on input, here we only read back.
    params: r.params as Record<string, number>,
    levelsMs: r.levelsMs,
    status: r.status,
    error: r.error,
    createdAtMs: ms(r.createdAt),
    finishedAtMs: r.finishedAt === null ? null : ms(r.finishedAt),
    // `step_count` is what marks the resolution as measured: `median_gap_ms` is legitimately
    // null on a one-state period, so it cannot carry that distinction on its own.
    resolution:
      r.stepCount === null ? null : { stepCount: r.stepCount, medianGapMs: r.medianGapMs },
  }
}

function toStrategyRow(r: typeof strategies.$inferSelect): StrategyRow {
  return {
    id: r.id,
    sessionKey: r.sessionKey,
    name: r.name,
    preset: r.preset,
    params: r.params as Record<string, number>,
    createdAtMs: ms(r.createdAt),
  }
}

/** `Repo` implementation over Postgres via Drizzle. */
export function drizzleRepo(db: Db): Repo {
  return {
    listMarkets: () => db.select().from(markets).orderBy(asc(markets.id)),

    async getMarket(id) {
      const [m] = await db.select().from(markets).where(eq(markets.id, id)).limit(1)
      return m ?? null
    },

    async coverage(marketId) {
      const rows = await db
        .select()
        .from(datasetCoverage)
        .where(eq(datasetCoverage.marketId, marketId))
        .orderBy(asc(datasetCoverage.fromTs))
      return rows.map((r) => ({
        fromMs: ms(r.fromTs),
        toMs: ms(r.toTs),
        updateCount: r.updateCount,
      }))
    },

    async bookUpdates(marketId, fromMs, toMs) {
      const rows = await db
        .select({ firstSeenAt: bookUpdates.firstSeenAt, levels: bookUpdates.levels })
        .from(bookUpdates)
        .where(
          and(
            eq(bookUpdates.marketId, marketId),
            gte(bookUpdates.firstSeenAt, new Date(fromMs)),
            lte(bookUpdates.firstSeenAt, new Date(toMs)),
          ),
        )
        .orderBy(asc(bookUpdates.firstSeenAt), asc(bookUpdates.slot), asc(bookUpdates.id))
      return rows.map((r) => ({ tMs: ms(r.firstSeenAt), levels: r.levels }))
    },

    async latestBook(marketId, notAfterMs) {
      const [row] = await db
        .select({ firstSeenAt: bookUpdates.firstSeenAt, levels: bookUpdates.levels })
        .from(bookUpdates)
        .where(
          and(
            eq(bookUpdates.marketId, marketId),
            lte(bookUpdates.firstSeenAt, new Date(notAfterMs)),
          ),
        )
        .orderBy(desc(bookUpdates.firstSeenAt), desc(bookUpdates.id))
        .limit(1)
      return row ? { tMs: ms(row.firstSeenAt), levels: row.levels } : null
    },

    // Active channels only. A retired one keeps its rows, but it is not a lane any more, and an
    // arrival over a channel that is not here is dropped rather than shown — `groupByEvent` skips
    // unknown paths, so no real arrival can leak onto the screen without its channel (SC-007).
    paths: () =>
      db
        .select({ id: deliveryPaths.id, name: deliveryPaths.name, kind: deliveryPaths.kind })
        .from(deliveryPaths)
        .where(eq(deliveryPaths.active, true))
        .orderBy(asc(deliveryPaths.id)),

    async arrivalsSince(marketId, sinceMs) {
      const rows = await db
        .select({
          bookUpdateId: arrivals.bookUpdateId,
          pathId: arrivals.pathId,
          // timestamp(6) → microseconds since the epoch; going through Date would lose three digits.
          receivedAtUs: sql<string>`(extract(epoch from ${arrivals.receivedAt}) * 1000000)::bigint`,
        })
        .from(arrivals)
        .innerJoin(bookUpdates, eq(arrivals.bookUpdateId, bookUpdates.id))
        .where(
          and(eq(bookUpdates.marketId, marketId), gte(bookUpdates.firstSeenAt, new Date(sinceMs))),
        )
      return rows.map((r) => ({
        bookUpdateId: r.bookUpdateId,
        pathId: r.pathId,
        receivedAtUs: BigInt(r.receivedAtUs),
      }))
    },

    async touchSession(key) {
      await db
        .insert(sessions)
        .values({ key })
        .onConflictDoUpdate({ target: sessions.key, set: { lastSeenAt: sql`now()` } })
    },

    async runsBySession(sessionKey, sinceMs) {
      const [row] = await db
        .select({ count: count(), oldest: min(backtestRuns.createdAt) })
        .from(backtestRuns)
        .where(
          and(
            eq(backtestRuns.sessionKey, sessionKey),
            gte(backtestRuns.createdAt, new Date(sinceMs)),
          ),
        )
      return { count: row?.count ?? 0, oldestMs: row?.oldest ? ms(row.oldest) : null }
    },

    async runsByIp(clientIp, sinceMs) {
      const [row] = await db
        .select({ count: count(), oldest: min(backtestRuns.createdAt) })
        .from(backtestRuns)
        .where(
          and(eq(backtestRuns.clientIp, clientIp), gte(backtestRuns.createdAt, new Date(sinceMs))),
        )
      return { count: row?.count ?? 0, oldestMs: row?.oldest ? ms(row.oldest) : null }
    },

    async createRun(run) {
      const [row] = await db
        .insert(backtestRuns)
        .values({
          sessionKey: run.sessionKey,
          clientIp: run.clientIp,
          marketId: run.marketId,
          fromTs: new Date(run.fromMs),
          toTs: new Date(run.toMs),
          preset: run.preset,
          params: run.params,
          levelsMs: [...run.levelsMs],
          status: 'running',
        })
        .returning()
      if (!row) throw new Error('insert backtest_runs returned no row')
      return toRunRow(row)
    },

    async getRun(id) {
      const [row] = await db.select().from(backtestRuns).where(eq(backtestRuns.id, id)).limit(1)
      return row ? toRunRow(row) : null
    },

    async finishRun(id, results, resolution) {
      await db.transaction(async (tx) => {
        if (results.length > 0) {
          await tx.insert(runResults).values(
            results.map((r) => ({
              runId: id,
              latencyMs: r.latencyMs,
              pnl: r.pnl,
              orders: r.orders,
              trades: r.trades,
              unfilled: r.unfilled,
              slippageSum: r.slippageSum,
              filledNotional: r.filledNotional,
              maxDrawdown: r.maxDrawdown,
              finalPosition: r.finalPosition,
              shiftedSteps: r.shiftedSteps,
            })),
          )
        }
        await tx
          .update(backtestRuns)
          .set({
            status: 'done',
            finishedAt: new Date(),
            stepCount: resolution.stepCount,
            medianGapMs: resolution.medianGapMs,
          })
          .where(eq(backtestRuns.id, id))
      })
    },

    async failRun(id, error) {
      await db
        .update(backtestRuns)
        .set({ status: 'failed', error, finishedAt: new Date() })
        .where(eq(backtestRuns.id, id))
    },

    async results(runId) {
      const rows = await db
        .select()
        .from(runResults)
        .where(eq(runResults.runId, runId))
        .orderBy(asc(runResults.latencyMs))
      return rows.map(
        (r): LevelResult => ({
          latencyMs: r.latencyMs,
          pnl: r.pnl,
          orders: r.orders,
          trades: r.trades,
          unfilled: r.unfilled,
          slippageSum: r.slippageSum,
          filledNotional: r.filledNotional,
          maxDrawdown: r.maxDrawdown,
          finalPosition: r.finalPosition,
          shiftedSteps: r.shiftedSteps,
        }),
      )
    },

    async listStrategies(sessionKey) {
      const rows = await db
        .select()
        .from(strategies)
        .where(eq(strategies.sessionKey, sessionKey))
        .orderBy(desc(strategies.createdAt), desc(strategies.id))
      return rows.map(toStrategyRow)
    },

    async createStrategy(s) {
      const [row] = await db
        .insert(strategies)
        .values({ sessionKey: s.sessionKey, name: s.name, preset: s.preset, params: s.params })
        .returning()
      if (!row) throw new Error('insert strategies returned no row')
      return toStrategyRow(row)
    },

    async deleteStrategy(id, sessionKey) {
      const rows = await db
        .delete(strategies)
        .where(and(eq(strategies.id, id), eq(strategies.sessionKey, sessionKey)))
        .returning({ id: strategies.id })
      return rows.length > 0
    },
  }
}
