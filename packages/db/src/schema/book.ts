import {
  bigint,
  index,
  integer,
  pgTable,
  primaryKey,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import { bytea } from './columns.ts'
import { deliveryPaths, markets } from './markets.ts'

/**
 * One book event — one row, regardless of how many channels it
 * arrived over (FR-002). The event key `(slot, state_hash)` is the same across channels by
 * construction (FR-003a). `levels` is the packed top-N slice, not the whole account:
 * 12.5 KB × 271 k events would not fit into SC-006.
 */
export const bookUpdates = pgTable(
  'book_updates',
  {
    id: bigint({ mode: 'bigint' }).primaryKey().generatedAlwaysAsIdentity(),
    marketId: integer('market_id')
      .notNull()
      .references(() => markets.id),
    slot: bigint({ mode: 'bigint' }).notNull(),
    stateHash: bytea('state_hash').notNull(),
    levels: bytea().notNull(),
    /** Earliest arrival across all channels — a denormalisation over `arrivals` for period queries. */
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true, precision: 6 }).notNull(),
  },
  (t) => [
    uniqueIndex('book_updates_event_idx').on(t.marketId, t.slot, t.stateHash),
    index('book_updates_period_idx').on(t.marketId, t.firstSeenAt),
  ],
)

/**
 * Arrival of an event over a specific channel. The source of truth for differential latency
 * (FR-003): a channel's lag = `received_at` − min(`received_at`) per event.
 */
export const arrivals = pgTable(
  'arrivals',
  {
    bookUpdateId: bigint('book_update_id', { mode: 'bigint' })
      .notNull()
      .references(() => bookUpdates.id, { onDelete: 'cascade' }),
    pathId: integer('path_id')
      .notNull()
      .references(() => deliveryPaths.id),
    receivedAt: timestamp('received_at', { withTimezone: true, precision: 6 }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.bookUpdateId, t.pathId] })],
)

/**
 * Gap-free segments (FR-006). A run starts only inside a single
 * segment; otherwise the API names the missing range (FR-014, SC-009).
 */
export const datasetCoverage = pgTable(
  'dataset_coverage',
  {
    marketId: integer('market_id')
      .notNull()
      .references(() => markets.id),
    fromTs: timestamp('from_ts', { withTimezone: true, precision: 6 }).notNull(),
    toTs: timestamp('to_ts', { withTimezone: true, precision: 6 }).notNull(),
    updateCount: integer('update_count').notNull(),
  },
  (t) => [primaryKey({ columns: [t.marketId, t.fromTs] })],
)
