import { createWriteStream } from 'node:fs'
import { open } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createGzip } from 'node:zlib'
import { ByteWriter, parquetWrite } from 'hyparquet-writer'
import { type Column, csvCell, rowCount, type Table } from './tables.ts'

type SchemaElement = NonNullable<Parameters<typeof parquetWrite>[0]['schema']>[number]

/** Parquet type per column. Timestamps are UTC microseconds, as `timestamptz(6)` holds them. */
export function schemaElement(c: Column): SchemaElement {
  const base = { name: c.name, repetition_type: 'REQUIRED' as const }
  switch (c.type) {
    case 'int32':
      return { ...base, type: 'INT32' }
    case 'int64':
      return { ...base, type: 'INT64' }
    case 'u128':
      return {
        ...base,
        type: 'FIXED_LEN_BYTE_ARRAY',
        type_length: 16,
        converted_type: 'DECIMAL',
        precision: 38,
        scale: 0,
        logical_type: { type: 'DECIMAL', precision: 38, scale: 0 },
      }
    case 'string':
      return {
        ...base,
        type: 'BYTE_ARRAY',
        converted_type: 'UTF8',
        logical_type: { type: 'STRING' },
      }
    case 'timestamp_us':
      return {
        ...base,
        type: 'INT64',
        converted_type: 'TIMESTAMP_MICROS',
        logical_type: { type: 'TIMESTAMP', isAdjustedToUTC: true, unit: 'MICROS' },
      }
  }
}

/**
 * The whole file in memory. Nothing in it depends on when or where it was written — no export
 * time, no host — so the same rows give the same bytes and the published checksums can be re-made.
 */
export function parquetBytes(t: Table, metadata: Record<string, string>): Uint8Array {
  rowCount(t)
  const writer = new ByteWriter()
  parquetWrite({
    writer,
    columnData: t.columns.map((c) => ({ name: c.name, data: c.values, nullable: false })),
    schema: [{ name: 'root', num_children: t.columns.length }, ...t.columns.map(schemaElement)],
    kvMetadata: Object.entries(metadata).map(([key, value]) => ({ key, value })),
  })
  return new Uint8Array(writer.getBuffer())
}

function* csvChunks(t: Table): Generator<string> {
  const n = rowCount(t)
  yield `${t.columns.map((c) => c.name).join(',')}\n`
  const CHUNK = 10_000
  for (let start = 0; start < n; start += CHUNK) {
    let out = ''
    const end = Math.min(n, start + CHUNK)
    for (let i = start; i < end; i++) {
      out += `${t.columns.map((c) => csvCell(c, i)).join(',')}\n`
    }
    yield out
  }
}

/** Byte 9 of a gzip header names the OS; zlib fills it per platform. 3 (Unix) everywhere. */
const GZIP_OS_BYTE = 9
const GZIP_OS_UNIX = 3

export async function writeCsvGz(path: string, t: Table): Promise<void> {
  await pipeline(Readable.from(csvChunks(t)), createGzip({ level: 9 }), createWriteStream(path))
  const fh = await open(path, 'r+')
  try {
    await fh.write(Uint8Array.of(GZIP_OS_UNIX), 0, 1, GZIP_OS_BYTE)
  } finally {
    await fh.close()
  }
}
