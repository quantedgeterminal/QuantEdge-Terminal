import { readFileSync } from 'node:fs'
import { packLevels } from '@quantedge/shared'
import { describe, expect, it } from 'vitest'
import {
  arrivalsTable,
  type ColumnType,
  channelsTable,
  coverageTable,
  levelsTable,
  marketsTable,
  statesTable,
  type Table,
} from '../src/tables.ts'

/** The field page on Pages describes the files; a column added here without a row there fails. */
const page = readFileSync(new URL('../../landing/dataset/index.html', import.meta.url), 'utf8')

const state = {
  id: 1n,
  marketId: 1,
  slot: 1n,
  stateHash: '00',
  firstSeenUs: 0n,
  levels: packLevels({ bids: [], asks: [] }),
}
const tables: Table[] = [
  marketsTable([]),
  channelsTable([]),
  coverageTable([1], { fromUs: 0n, toUs: 1n }, [state]),
  statesTable([state]),
  levelsTable([state]),
  arrivalsTable([]),
]

/** The `<tbody>` of the field table that follows a table's heading. */
function section(name: string): string {
  const start = page.indexOf(`id="t-${name}"`)
  if (start < 0) return ''
  const end = page.indexOf('</tbody>', start)
  return page.slice(start, end)
}

const typeOnPage: Record<ColumnType, string> = {
  int32: 'int32',
  int64: 'int64',
  u128: 'decimal(38,0)',
  string: 'string',
  timestamp_us: 'timestamp',
}

describe('dataset page', () => {
  for (const t of tables) {
    it(`describes every column of ${t.name}, in order, with its type`, () => {
      const rows = [
        ...section(t.name).matchAll(/<tr><td>([a-z_]+)<\/td><td class="mono">([^<]+)<\/td>/g),
      ].map((m) => `${m[1]} ${m[2]}`)
      expect(rows).toEqual(t.columns.map((c) => `${c.name} ${typeOnPage[c.type]}`))
    })
  }
})
