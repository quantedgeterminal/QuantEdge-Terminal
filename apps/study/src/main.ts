/**
 * Reproduces the study from the published dataset:
 *
 *   gh release download dataset-v1 -R quantedgeterminal/QuantEdge-Terminal -p '*.csv.gz' \
 *     -p SHA256SUMS -D data/dataset-v1
 *   pnpm --filter @quantedge/study study --data data/dataset-v1 --out study.json
 *
 * No database, no keys: the CSV.gz assets of release `dataset-v1` are the whole input. The files
 * are checked against `SHA256SUMS` first; the output is the JSON the research page is built from.
 */
import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { loadDataset, verifySums } from './load.ts'
import { runStudy } from './study.ts'

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: { data: { type: 'string' }, out: { type: 'string' } },
  })
  if (!values.data || !values.out) {
    console.error('usage: study --data <dir with dataset-v1 CSV.gz files> --out <file.json>')
    return 2
  }
  // pnpm runs the script inside apps/study; relative paths mean where the command was typed.
  const base = process.env.INIT_CWD ?? process.cwd()
  const dir = resolve(base, values.data)
  const out = resolve(base, values.out)

  verifySums(dir)
  const ds = await loadDataset(dir)
  const result = runStudy(ds, (market) => console.log(`running ${market}…`))
  await writeFile(out, `${JSON.stringify(result, null, 2)}\n`)

  const n = result.baseline.length + result.sweep.length + result.control.length
  console.log(`${n} measured configurations, ${result.gridSlope.length} grid slopes → ${out}`)
  return 0
}

process.exitCode = await main()
