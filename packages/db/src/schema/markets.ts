import { boolean, integer, pgEnum, pgTable, smallint, text, uniqueIndex } from 'drizzle-orm/pg-core'

/**
 * The channel type lives in the DB as an enum, not in the adapter config: the emulation mark must
 * pass through every layer with no place where it could be forgotten (FR-004, SC-007).
 * The values duplicate `PathKind` in `@quantedge/shared`; a test keeps them in sync.
 */
export const pathKind = pgEnum('path_kind', ['real', 'emulated'])

/** A market on an on-chain CLOB (FR-001). The book is the state of the account at `address`. */
export const markets = pgTable(
  'markets',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    venue: text().notNull(),
    address: text().notNull(),
    baseMint: text('base_mint').notNull(),
    quoteMint: text('quote_mint').notNull(),
    baseDecimals: smallint('base_decimals').notNull(),
    quoteDecimals: smallint('quote_decimals').notNull(),
    label: text().notNull(),
    active: boolean().notNull().default(true),
  },
  (t) => [uniqueIndex('markets_address_idx').on(t.address)],
)

/** Delivery channel (FR-004). `provider` for real ones; `note` for emulated ones: where the profile comes from. */
export const deliveryPaths = pgTable(
  'delivery_paths',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    name: text().notNull(),
    kind: pathKind().notNull(),
    provider: text(),
    note: text(),
  },
  (t) => [uniqueIndex('delivery_paths_name_idx').on(t.name)],
)
