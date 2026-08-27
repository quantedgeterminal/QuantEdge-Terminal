import type { Db } from '@quantedge/db'
import { arrivals, bookUpdates, datasetCoverage, deliveryPaths, markets } from '@quantedge/db'
import { and, eq, sql } from 'drizzle-orm'

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
  /** Returns the event id; on a repeat from another channel — the same id, `first_seen_at` = the earliest. */
  upsertBookUpdate(e: BookEvent): Promise<bigint>
  insertArrival(bookUpdateId: bigint, pathId: number, receivedAtUs: bigint): Promise<void>
  openCoverage(marketId: number, fromUs: bigint): Promise<void>
  extendCoverage(marketId: number, fromUs: bigint, toUs: bigint, updateCount: number): Promise<void>
}

export class DrizzleSink implements Sink {
  private readonly db: Db
  constructor(db: Db) {
    this.db = db
  }

  async upsertBookUpdate(e: BookEvent): Promise<bigint> {
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
      .returning({ id: bookUpdates.id })
    const row = rows[0]
    if (!row) throw new Error('upsert book_updates returned no id')
    return row.id
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
