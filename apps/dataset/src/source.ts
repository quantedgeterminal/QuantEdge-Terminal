import type postgres from 'postgres'
import {
  type ArrivalRow,
  type ChannelRow,
  type CoverageRow,
  isoMicros,
  type MarketRow,
  type StateRow,
  type Window,
} from './tables.ts'

export interface Snapshot {
  markets: MarketRow[]
  channels: ChannelRow[]
  coverage: CoverageRow[]
  states: StateRow[]
  arrivals: ArrivalRow[]
}

/** timestamptz(6) → microseconds since the epoch as text; going through Date would lose three digits. */
const us = (col: string) => `(extract(epoch from ${col}) * 1000000)::bigint::text`

/**
 * Reads everything the window needs in one read-only transaction, so the tables agree with each
 * other even while the collector keeps writing. Order is fixed here: market, first arrival, id.
 */
export async function readSnapshot(
  sql: postgres.Sql,
  marketIds: readonly number[],
  w: Window,
): Promise<Snapshot> {
  const ids = [...marketIds]
  return sql.begin('isolation level repeatable read read only', async (tx) => {
    // Bounds go in as text: a JS Date would round the window to milliseconds.
    const from = tx`${isoMicros(w.fromUs)}::timestamptz`
    const to = tx`${isoMicros(w.toUs)}::timestamptz`

    const markets = await tx<MarketRow[]>`
      select id, venue, address, base_mint as "baseMint", quote_mint as "quoteMint",
             base_symbol as "baseSymbol", quote_symbol as "quoteSymbol",
             base_decimals as "baseDecimals", quote_decimals as "quoteDecimals"
      from markets where id in ${tx(ids)} order by id`

    const coverage = (
      await tx<{ marketId: number; fromUs: string; toUs: string }[]>`
        select market_id as "marketId", ${tx.unsafe(us('from_ts'))} as "fromUs",
               ${tx.unsafe(us('to_ts'))} as "toUs"
        from dataset_coverage
        where market_id in ${tx(ids)} and from_ts <= ${to} and to_ts >= ${from}
        order by market_id, from_ts`
    ).map((r) => ({ marketId: r.marketId, fromUs: BigInt(r.fromUs), toUs: BigInt(r.toUs) }))

    const states = (
      await tx<
        {
          id: string
          marketId: number
          slot: string
          stateHash: string
          firstSeenUs: string
          levels: Uint8Array
        }[]
      >`
        select id::text, market_id as "marketId", slot::text, encode(state_hash, 'hex') as "stateHash",
               ${tx.unsafe(us('first_seen_at'))} as "firstSeenUs", levels
        from book_updates
        where market_id in ${tx(ids)} and first_seen_at >= ${from} and first_seen_at <= ${to}
        order by market_id, first_seen_at, id`
    ).map((r) => ({
      id: BigInt(r.id),
      marketId: r.marketId,
      slot: BigInt(r.slot),
      stateHash: r.stateHash,
      firstSeenUs: BigInt(r.firstSeenUs),
      levels: new Uint8Array(r.levels),
    }))

    const arrivals = (
      await tx<{ stateId: string; channelId: number; receivedUs: string }[]>`
        select a.book_update_id::text as "stateId", a.path_id as "channelId",
               ${tx.unsafe(us('a.received_at'))} as "receivedUs"
        from arrivals a join book_updates u on u.id = a.book_update_id
        where u.market_id in ${tx(ids)} and u.first_seen_at >= ${from} and u.first_seen_at <= ${to}
        order by u.market_id, u.first_seen_at, u.id, a.path_id`
    ).map((r) => ({
      stateId: BigInt(r.stateId),
      channelId: r.channelId,
      receivedUs: BigInt(r.receivedUs),
    }))

    const channelIds = [...new Set(arrivals.map((a) => a.channelId))]
    const channels =
      channelIds.length === 0
        ? []
        : await tx<ChannelRow[]>`
            select id, name, kind::text as kind, coalesce(provider, '') as provider
            from delivery_paths where id in ${tx(channelIds)} order by id`

    return { markets, channels, coverage, states, arrivals }
  })
}
