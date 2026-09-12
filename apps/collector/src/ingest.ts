import { packLevels, stateHash } from '@quantedge/shared'
import { type AccountUpdate, decodeBook } from '@quantedge/venue'
import type { Sink } from './sink.ts'

export interface IngestLogger {
  warn(obj: Record<string, unknown>, msg: string): void
}

/**
 * Book event ingest (FR-002, FR-003c). One event — one row in
 * `book_updates` regardless of channel; every channel gets its own `arrivals` row.
 * Deduplication across channels happens in the DB, by an atomic upsert on the event key.
 */
export class Ingestor {
  private readonly sink: Sink
  private readonly depth: number
  private readonly log: IngestLogger
  private readonly onStored: (marketId: number) => void

  constructor(
    sink: Sink,
    depth: number,
    log: IngestLogger,
    onStored: (marketId: number) => void = () => {},
  ) {
    this.sink = sink
    this.depth = depth
    this.log = log
    this.onStored = onStored
  }

  async handle(marketId: number, pathId: number, u: AccountUpdate): Promise<void> {
    let levels: Uint8Array
    try {
      const book = decodeBook(u.data, Number(u.slot), this.depth)
      levels = packLevels(book)
    } catch (e) {
      // A broken account is no reason to take the collector down; but an event without a book is not stored.
      this.log.warn({ marketId, pathId, slot: u.slot, err: String(e) }, 'book does not decode')
      return
    }
    const { id, inserted } = await this.sink.upsertBookUpdate({
      marketId,
      slot: u.slot,
      stateHash: stateHash(u.data),
      levels,
      receivedAtUs: u.receivedAtUs,
    })
    await this.sink.insertArrival(id, pathId, u.receivedAtUs)
    // The coverage counter counts book states; a second arrival of the same event does not move it.
    if (inserted) this.onStored(marketId)
  }
}
