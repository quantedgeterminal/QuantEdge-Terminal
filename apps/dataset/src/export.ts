/**
 * Exports a frozen window of recorded order books as an open dataset: every table as Parquet and
 * as gzipped CSV, plus SHA256SUMS. Read-only against the database; refuses a window that is not
 * fully covered (FR-014) and any channel that is not real (rule 4).
 *
 *   pnpm --filter @quantedge/dataset export \
 *     --from 2026-09-11T17:31:00.800740Z --to 2026-09-12T09:05:00Z \
 *     --name quantedge-dataset-v1 --out <dir>
 *
 * Reads DATABASE_URL from .env. `--markets 1,2,3` narrows the markets; by default all of them.
 */

import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import postgres from 'postgres'
import { z } from 'zod'
import { readSnapshot } from './source.ts'
import {
  arrivalsTable,
  channelsTable,
  checkChannels,
  checkCoverage,
  coverageTable,
  isoMicros,
  levelsTable,
  marketsTable,
  parseIsoMicros,
  rowCount,
  statesTable,
  type Window,
} from './tables.ts'
import { parquetBytes, writeCsvGz } from './write.ts'

const Env = z.object({ DATABASE_URL: z.string().min(1) })

const Args = z.object({
  from: z.string(),
  to: z.string(),
  name: z.string().regex(/^[a-z0-9][a-z0-9.-]*$/),
  out: z.string().min(1),
  markets: z
    .string()
    .regex(/^\d+(,\d+)*$/)
    .transform((s) => s.split(',').map(Number))
    .optional(),
})

const REPO = 'https://github.com/quantedgeterminal/QuantEdge-Terminal'

async function main(): Promise<number> {
  const env = Env.parse(process.env)
  const { values } = parseArgs({
    options: {
      from: { type: 'string' },
      to: { type: 'string' },
      name: { type: 'string' },
      out: { type: 'string' },
      markets: { type: 'string' },
    },
  })
  const args = Args.parse(values)
  const w: Window = { fromUs: parseIsoMicros(args.from), toUs: parseIsoMicros(args.to) }
  // pnpm runs the script inside apps/dataset; a relative --out means where the command was typed.
  const out = resolve(process.env.INIT_CWD ?? process.cwd(), args.out)

  const sql = postgres(env.DATABASE_URL, { max: 1, prepare: false, onnotice: () => {} })
  try {
    const marketIds =
      args.markets ??
      (await sql<{ id: number }[]>`select id from markets order by id`).map((r) => r.id)
    const snap = await readSnapshot(sql, marketIds, w)

    const missing = marketIds.filter((m) => !snap.markets.some((r) => r.id === m))
    if (missing.length > 0) throw new Error(`no such markets: ${missing.join(', ')}`)
    checkCoverage(marketIds, snap.coverage, w)
    checkChannels(snap.channels)
    for (const m of marketIds) {
      if (!snap.states.some((s) => s.marketId === m)) throw new Error(`market ${m}: no states`)
    }

    const metadata = {
      dataset: args.name,
      license: 'CC-BY-4.0',
      source: REPO,
      window_from: isoMicros(w.fromUs),
      window_to: isoMicros(w.toUs),
    }
    const tables = [
      marketsTable(snap.markets),
      channelsTable(snap.channels),
      coverageTable(marketIds, w, snap.states),
      statesTable(snap.states),
      levelsTable(snap.states),
      arrivalsTable(snap.arrivals),
    ]

    await mkdir(out, { recursive: true })
    const files: string[] = []
    for (const t of tables) {
      const base = `${args.name}-${t.name}`
      await writeFile(join(out, `${base}.parquet`), parquetBytes(t, { ...metadata, table: t.name }))
      await writeCsvGz(join(out, `${base}.csv.gz`), t)
      files.push(`${base}.parquet`, `${base}.csv.gz`)
      console.log(`${t.name}: ${rowCount(t)} rows`)
    }

    let sums = ''
    for (const f of files.sort()) {
      const hash = createHash('sha256')
        .update(await readFile(join(out, f)))
        .digest('hex')
      sums += `${hash}  ${f}\n`
    }
    await writeFile(join(out, 'SHA256SUMS'), sums)
    console.log(`wrote ${files.length} files and SHA256SUMS to ${out}`)
    return 0
  } finally {
    await sql.end()
  }
}

process.exitCode = await main()
