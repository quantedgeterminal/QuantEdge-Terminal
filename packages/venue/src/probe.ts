/**
 * Venue probe (FR-001): address activity in tx/s and the size of its account.
 * Reproduces the measurement from PLAN "Venue probe". Before calling anything
 * dead, the instrument is run against a known-active program.
 *
 *   node src/probe.ts [address ...]
 *   RPC_HTTP_URL=https://... node src/probe.ts
 */
import { Connection, PublicKey } from '@solana/web3.js'
import { type ActivityStats, activityStats, instrumentPasses } from './probe-stats.ts'

const RPC_HTTP_URL = process.env.RPC_HTTP_URL ?? 'https://api.mainnet-beta.solana.com'
const SAMPLE_LIMIT = 1000

/** Raydium AMM v4 never sleeps; 16.7 tx/s at the time of the PLAN measurement. */
const REFERENCE = {
  label: 'Raydium AMM v4 (instrument reference)',
  address: '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8',
  minTxPerSec: 1,
}

const DEFAULT_TARGETS = [
  { label: 'Manifest (program)', address: 'MNFSTqtC93rEfYHB6hF82sKdZpUDFWkViLByLd1k1Ms' },
  {
    label: 'Manifest, M1 reference market',
    address: '4SMRzaLXsuvTi2B5cSVs4LuCUUqQhB2uByTWUvbixjfF',
  },
  { label: 'Phoenix (program)', address: 'PhoeNiXZ8ByJGLkxNfZRnkUfjvmuYqLR89jjFHGqdXY' },
  { label: 'OpenBook v2 (program)', address: 'opnb2LAfJYbRMAHHvqjCwQxanZn7ReEHp1k81EohpZb' },
]

interface Probe {
  label: string
  address: string
  stats: ActivityStats
  space: number | null
  executable: boolean
}

async function probe(conn: Connection, label: string, address: string): Promise<Probe> {
  const pk = new PublicKey(address)
  const [sigs, info] = await Promise.all([
    conn.getSignaturesForAddress(pk, { limit: SAMPLE_LIMIT }),
    conn.getAccountInfo(pk),
  ])
  const stats = activityStats(
    sigs.map((s) => ({ blockTime: s.blockTime ?? null, failed: s.err !== null })),
  )
  return {
    label,
    address,
    stats,
    space: info ? info.data.length : null,
    executable: info?.executable ?? false,
  }
}

function rate(v: number | null, count: number): string {
  if (v !== null) return v.toFixed(4)
  return count > 0 ? '≥sample/1 s' : '—'
}

function print(p: Probe): void {
  const { stats } = p
  let space = 'no account'
  if (p.space !== null) space = p.executable ? 'program' : `${p.space} B`
  console.log(`${p.label}\n  ${p.address}`)
  console.log(
    `  sample ${stats.count} over ${stats.windowSec} s` +
      ` · ${rate(stats.txPerSec, stats.count)} tx/s` +
      ` · successful ${rate(stats.okPerSec, stats.count)}/s` +
      ` · failed ${(stats.failShare * 100).toFixed(0)} %` +
      ` · account: ${space}`,
  )
}

async function main(): Promise<void> {
  const conn = new Connection(RPC_HTTP_URL, 'confirmed')
  const targets =
    process.argv.length > 2
      ? process.argv.slice(2).map((address) => ({ label: address, address }))
      : DEFAULT_TARGETS

  console.log(`RPC: ${RPC_HTTP_URL}\n`)

  const ref = await probe(conn, REFERENCE.label, REFERENCE.address)
  print(ref)
  if (!instrumentPasses(ref.stats, REFERENCE.minTxPerSec)) {
    console.error(
      `\nInstrument check failed: the reference showed ${rate(ref.stats.txPerSec, ref.stats.count)} tx/s` +
        ` against a threshold of ${REFERENCE.minTxPerSec}. Zeros below would mean nothing — stopping.`,
    )
    process.exit(2)
  }
  console.log('  instrument ok\n')

  for (const t of targets) {
    print(await probe(conn, t.label, t.address))
  }
}

main().catch((e: unknown) => {
  console.error(e)
  process.exit(1)
})
