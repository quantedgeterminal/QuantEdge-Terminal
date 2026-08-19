import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema.ts'

/**
 * Runtime connection through the transaction pooler (6543). `prepare: false`
 * is mandatory: a pooler in transaction mode does not keep prepared statements
 * between queries, and without it the second query fails with "prepared statement does not exist".
 */
export function createDb(url: string) {
  const sql = postgres(url, { prepare: false, max: 5 })
  return { db: drizzle(sql, { schema }), sql }
}

export type Db = ReturnType<typeof createDb>['db']
