import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { parquetMetadata, parquetReadObjects } from 'hyparquet'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Table } from '../src/tables.ts'
import { parquetBytes, writeCsvGz } from '../src/write.ts'

const T0 = 1_789_147_860_800_007n

const table: Table = {
  name: 'sample',
  columns: [
    { name: 'id', type: 'int64', values: [1n, 2n, 3n] },
    { name: 'market_id', type: 'int32', values: [1, 1, 3] },
    { name: 'side', type: 'string', values: ['bid', 'ask', 'a,"b"'] },
    // 2^100 needs all sixteen bytes; 10^21 is a real cbBTC price scale. Both are exact in float64,
    // which is all hyparquet hands back for a DECIMAL.
    { name: 'price', type: 'u128', values: [2n ** 100n, 10n ** 21n, 0n] },
    { name: 'at', type: 'timestamp_us', values: [T0, T0 + 1n, T0 + 999n] },
  ],
}

function toArrayBuffer(b: Uint8Array): ArrayBuffer {
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer
}

describe('parquetBytes', () => {
  const bytes = parquetBytes(table, { license: 'CC-BY-4.0' })

  it('reads back the same values and types', async () => {
    const rows = await parquetReadObjects({ file: toArrayBuffer(bytes) })
    expect(rows.map((r) => r.id)).toEqual([1n, 2n, 3n])
    expect(rows.map((r) => r.market_id)).toEqual([1, 1, 3])
    expect(rows.map((r) => r.side)).toEqual(['bid', 'ask', 'a,"b"'])
    expect(rows.map((r) => r.price)).toEqual([2 ** 100, 10 ** 21, 0])
    expect(rows.map((r) => (r.at as Date).toISOString())).toEqual([
      '2026-09-11T17:31:00.800Z',
      '2026-09-11T17:31:00.800Z',
      '2026-09-11T17:31:00.801Z',
    ])
  })

  it('declares a UTC microsecond timestamp, a DECIMAL(38, 0) price and the licence', () => {
    const meta = parquetMetadata(toArrayBuffer(bytes))
    const at = meta.schema.find((e) => e.name === 'at')
    expect(at?.logical_type).toEqual({ type: 'TIMESTAMP', isAdjustedToUTC: true, unit: 'MICROS' })
    const price = meta.schema.find((e) => e.name === 'price')
    expect([price?.type, price?.type_length, price?.precision, price?.scale]).toEqual([
      'FIXED_LEN_BYTE_ARRAY',
      16,
      38,
      0,
    ])
    expect(meta.schema.slice(1).every((e) => e.repetition_type === 'REQUIRED')).toBe(true)
    expect(meta.key_value_metadata).toContainEqual({ key: 'license', value: 'CC-BY-4.0' })
  })

  it('gives the same bytes for the same rows, so published checksums can be re-made', () => {
    expect(parquetBytes(table, { license: 'CC-BY-4.0' })).toEqual(bytes)
  })
})

describe('writeCsvGz', () => {
  let dir = ''
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'qet-dataset-'))
  })
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('writes a header and one LF-terminated line per row', async () => {
    const path = join(dir, 'sample.csv.gz')
    await writeCsvGz(path, table)
    const text = gunzipSync(await readFile(path)).toString('utf8')
    expect(text).toBe(
      [
        'id,market_id,side,price,at',
        '1,1,bid,1267650600228229401496703205376,2026-09-11T17:31:00.800007Z',
        '2,1,ask,1000000000000000000000,2026-09-11T17:31:00.800008Z',
        '3,3,"a,""b""",0,2026-09-11T17:31:00.801006Z',
        '',
      ].join('\n'),
    )
  })

  it('stamps the gzip header the same on every platform', async () => {
    const a = join(dir, 'a.csv.gz')
    const b = join(dir, 'b.csv.gz')
    await writeCsvGz(a, table)
    await writeCsvGz(b, table)
    const bytes = await readFile(a)
    expect(bytes.readUInt32LE(4)).toBe(0) // no mtime
    expect(bytes[9]).toBe(3)
    expect(bytes.equals(await readFile(b))).toBe(true)
  })
})
