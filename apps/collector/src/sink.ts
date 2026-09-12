import type { Db } from '@quantedge/db'
import { arrivals, bookUpdates, datasetCoverage, deliveryPaths, markets } from '@quantedge/db'
import { and, eq, gte, inArray, lt, lte, not, sql } from 'drizzle-orm'
import type { Interval, KeepPolicy } from './retention.ts'

/** Epoch microseconds → ISO string with microseconds for `timestamp(6)`. */
export function usToIso(us: bigint): string {
  const ms = us / 1000n
  const rest = Number(us % 1000n)
  return `${new Date(Number(ms)).toISOString().slice(0, -1)}${rest.toString().padStart(3, '0')}Z`
}

export interface BookEvent {
  marketId: number
  slot: bigint
  stateHash: Uint8Array
  levels: Uint8Array
  receivedAtUs: bigint
}

/**
 * Everything the collector writes. An interface, not a class — so that ingest and coverage
 * tracking are tested in memory without Postgres.
 */
export interface Sink {
  /**
   * Returns the event id; on a repeat from another channel — the same id, `first_seen_at` = the earliest.
   * `inserted` — the event is new: the coverage counter counts states, not arrivals.
   */
  upsertBookUpdate(e: BookEvent): Promise<{ id: bigint; inserted: boolean }>
  insertArrival(bookUpdateId: bigint, pathId: number, receivedAtUs: bigint): Promise<void>
  openCoverage(marketId: number, fromUs: bigint): Promise<void>
  extendCoverage(marketId: number, fromUs: bigint, toUs: bigint, updateCount: number): Promise<void>
}

export interface CoverageRow extends Interval {
  readonly count: number
}

/** What the cleanup needs (T054). A separate interface — retention tests do not pull in the whole `Sink`. */
export interface RetentionSink {
  /** Deletes up to `batch` events before `cutoffUs` outside the frozen interval; returns how many were deleted. */
  deleteBookUpdatesBefore(marketId: number, keep: KeepPolicy, batch: number): Promise<number>
  listCoverage(marketId: number): Promise<CoverageRow[]>
  countBookUpdates(marketId: number, fromUs: bigint, toUs: bigint): Promise<number>
  /** Atomically replaces the segment starting at `fromUs` with `pieces` (0…2). */
  replaceCoverage(marketId: number, fromUs: bigint, pieces: readonly CoverageRow[]): Promise<void>
}

/** `timestamptz(6)` → epoch µs without losing microseconds (they would vanish through `Date`). */
const epochUs = (col: unknown) => sql<string>`(extract(epoch from ${col}) * 1000000)::bigint`

export class DrizzleSink implements Sink, RetentionSink {
  private readonly db: Db
  constructor(db: Db) {
    this.db = db
  }

  async upsertBookUpdate(e: BookEvent): Promise<{ id: bigint; inserted: boolean }> {
    const firstSeen = usToIso(e.receivedAtUs)
    const rows = await this.db
      .insert(bookUpdates)
      .values({
        marketId: e.marketId,
        slot: e.slot,
        stateHash: e.stateHash,
        levels: e.levels,
        firstSeenAt: sql`${firstSeen}::timestamptz`,
      })
      .onConflictDoUpdate({
        target: [bookUpdates.marketId, bookUpdates.slot, bookUpdates.stateHash],
        set: {
          firstSeenAt: sql`least(${bookUpdates.firstSeenAt}, ${firstSeen}::timestamptz)`,
        },
      })
      // `xmax = 0` — the row was just inserted, not updated by the conflict.
      .returning({ id: bookUpdates.id, inserted: sql<boolean>`(xmax = 0)` })
    const row = rows[0]
    if (!row) throw new Error('upsert book_updates returned no id')
    return { id: row.id, inserted: row.inserted }
  }

  async insertArrival(bookUpdateId: bigint, pathId: number, receivedAtUs: bigint): Promise<void> {
    await this.db
      .insert(arrivals)
      .values({ bookUpdateId, pathId, receivedAt: sql`${usToIso(receivedAtUs)}::timestamptz` })
      .onConflictDoNothing()
  }

  async openCoverage(marketId: number, fromUs: bigint): Promise<void> {
    const ts = sql`${usToIso(fromUs)}::timestamptz`
    await this.db
      .insert(datasetCoverage)
      .values({ marketId, fromTs: ts, toTs: ts, updateCount: 0 })
      .onConflictDoNothing()
  }

  async extendCoverage(
    marketId: number,
    fromUs: bigint,
    toUs: bigint,
    updateCount: number,
  ): Promise<void> {
    await this.db
      .update(datasetCoverage)
      .set({ toTs: sql`${usToIso(toUs)}::timestamptz`, updateCount })
      .where(
        and(
          eq(datasetCoverage.marketId, marketId),
          eq(datasetCoverage.fromTs, sql`${usToIso(fromUs)}::timestamptz`),
        ),
      )
  }

  async deleteBookUpdatesBefore(
    marketId: number,
    keep: KeepPolicy,
    batch: number,
  ): Promise<number> {
    const before = lt(bookUpdates.firstSeenAt, sql`${usToIso(keep.cutoffUs)}::timestamptz`)
    const f = keep.frozen
    const inFrozen =
      f === null
        ? undefined
        : and(
            gte(bookUpdates.firstSeenAt, sql`${usToIso(f.fromUs)}::timestamptz`),
            lte(bookUpdates.firstSeenAt, sql`${usToIso(f.toUs)}::timestamptz`),
          )
    const victims = this.db
      .select({ id: bookUpdates.id })
      .from(bookUpdates)
      .where(
        and(
          eq(bookUpdates.marketId, marketId),
          before,
          inFrozen === undefined ? undefined : not(inFrozen),
        ),
      )
      .limit(batch)
    const deleted = await this.db
      .delete(bookUpdates)
      .where(inArray(bookUpdates.id, victims))
      .returning({ id: bookUpdates.id })
    return deleted.length
  }

  async listCoverage(marketId: number): Promise<CoverageRow[]> {
    const rows = await this.db
      .select({
        fromUs: epochUs(datasetCoverage.fromTs),
        toUs: epochUs(datasetCoverage.toTs),
        count: datasetCoverage.updateCount,
      })
      .from(datasetCoverage)
      .where(eq(datasetCoverage.marketId, marketId))
      .orderBy(datasetCoverage.fromTs)
    return rows.map((r) => ({ fromUs: BigInt(r.fromUs), toUs: BigInt(r.toUs), count: r.count }))
  }

  async countBookUpdates(marketId: number, fromUs: bigint, toUs: bigint): Promise<number> {
    const rows = await this.db
      .select({ n: sql<string>`count(*)` })
      .from(bookUpdates)
      .where(
        and(
          eq(bookUpdates.marketId, marketId),
          gte(bookUpdates.firstSeenAt, sql`${usToIso(fromUs)}::timestamptz`),
          lte(bookUpdates.firstSeenAt, sql`${usToIso(toUs)}::timestamptz`),
        ),
      )
    return Number(rows[0]?.n ?? 0)
  }

  async replaceCoverage(
    marketId: number,
    fromUs: bigint,
    pieces: readonly CoverageRow[],
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx
        .delete(datasetCoverage)
        .where(
          and(
            eq(datasetCoverage.marketId, marketId),
            eq(datasetCoverage.fromTs, sql`${usToIso(fromUs)}::timestamptz`),
          ),
        )
      if (pieces.length === 0) return
      await tx.insert(datasetCoverage).values(
        pieces.map((p) => ({
          marketId,
          fromTs: sql`${usToIso(p.fromUs)}::timestamptz`,
          toTs: sql`${usToIso(p.toUs)}::timestamptz`,
          updateCount: p.count,
        })),
      )
    })
  }
}

/** Market and channel must exist in the DB before start; the collector does not invent them. */
export async function resolveIds(
  db: Db,
  marketAddresses: readonly string[],
  pathNames: readonly string[],
): Promise<{ markets: Map<string, number>; paths: Map<string, number> }> {
  const m = new Map<string, number>()
  for (const address of marketAddresses) {
    const row = await db.query.markets.findFirst({ where: eq(markets.address, address) })
    if (!row) throw new Error(`market ${address} is not in the markets table — add it before start`)
    m.set(address, row.id)
  }
  const p = new Map<string, number>()
  for (const name of pathNames) {
    const row = await db.query.deliveryPaths.findFirst({ where: eq(deliveryPaths.name, name) })
    if (!row) throw new Error(`channel ${name} is not in delivery_paths — add it before start`)
    if (row.kind !== 'real') throw new Error(`channel ${name} not real: collector writes real only`)
    p.set(name, row.id)
  }
  return { markets: m, paths: p }
}
