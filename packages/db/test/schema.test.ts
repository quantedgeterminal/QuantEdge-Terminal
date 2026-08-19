import { PathKind } from '@quantedge/shared'
import { getTableColumns, getTableName } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import * as schema from '../src/schema.ts'

describe('schema', () => {
  it('the path_kind enum in the DB matches PathKind in shared', () => {
    expect([...schema.pathKind.enumValues]).toEqual([...PathKind.options])
  })

  it('every table from PLAN "Data model" is present', () => {
    const names = Object.values(schema)
      .filter((v): v is (typeof schema)['markets'] => typeof v === 'object' && 'getSQL' in v)
      .map((t) => getTableName(t))
      .sort()
    expect(names).toEqual([
      'arrivals',
      'backtest_runs',
      'book_updates',
      'dataset_coverage',
      'delivery_paths',
      'markets',
      'run_results',
      'sessions',
      'strategies',
    ])
  })

  it('money and sizes in run_results are bigint, not fractional', () => {
    const cols = getTableColumns(schema.runResults)
    for (const name of ['pnl', 'slippageSum', 'maxDrawdown'] as const) {
      expect(cols[name].dataType, name).toBe('bigint')
    }
  })
})
