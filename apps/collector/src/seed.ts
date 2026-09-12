/**
 * Reference rows for the collector: markets from `MARKET_ADDRESSES` (symbols from `MARKET_SYMBOLS`,
 * because a mint without metadata has no symbol) and two real channels from `RPC_A_NAME`/`RPC_B_NAME`.
 * Idempotent — running it again duplicates nothing but refreshes symbols and label.
 *
 *   pnpm --filter @quantedge/collector seed   (reads .env: DATABASE_URL_MIGRATE, MARKET_ADDRESSES, MARKET_SYMBOLS, RPC_*_NAME)
 */

import { deliveryPaths, markets } from '@quantedge/db'
import { decodeMarketHeader } from '@quantedge/venue'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { z } from 'zod'

const Env = z.object({
  DATABASE_URL_MIGRATE: z.string().min(1),
  RPC_HTTP_URL: z.string().url().prefault('https://api.mainnet-beta.solana.com'),
  MARKET_ADDRESSES: z.string().transform((s) =>
    s
      .split(',')
      .map((a) => a.trim())
      .filter(Boolean),
  ),
  /** "BASE/QUOTE" per address, in the same order. */
  MARKET_SYMBOLS: z.string().transform((s) =>
    s
      .split(',')
      .map((a) => a.trim())
      .filter(Boolean)
      .map((pair) => {
        const [base, quote] = pair.split('/')
        if (!base || !quote) throw new Error(`MARKET_SYMBOLS: expected BASE/QUOTE, got "${pair}"`)
        return { base, quote }
      }),
  ),
  RPC_A_NAME: z.string().min(1),
  RPC_B_NAME: z.string().min(1),
})
const env = Env.parse(process.env)
if (env.MARKET_SYMBOLS.length !== env.MARKET_ADDRESSES.length) {
  throw new Error(
    `MARKET_SYMBOLS (${env.MARKET_SYMBOLS.length}) and MARKET_ADDRESSES (${env.MARKET_ADDRESSES.length}) must match in length and order`,
  )
}

const AccountInfo = z.object({
  result: z.object({
    value: z.object({ data: z.tuple([z.string(), z.literal('base64')]), owner: z.string() }),
  }),
})

const MANIFEST_PROGRAM = 'MNFSTqtC93rEfYHB6hF82sKdZpUDFWkViLByLd1k1Ms'

async function fetchAccount(address: string): Promise<Uint8Array> {
  const r = await fetch(env.RPC_HTTP_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'getAccountInfo',
      params: [address, { encoding: 'base64' }],
    }),
  })
  const parsed = AccountInfo.parse(await r.json())
  if (parsed.result.value.owner !== MANIFEST_PROGRAM) {
    throw new Error(`${address}: owner ${parsed.result.value.owner}, not the Manifest program`)
  }
  return new Uint8Array(Buffer.from(parsed.result.value.data[0], 'base64'))
}

/** Dependency-free base58: 32 mint bytes → address. */
function base58(bytes: Uint8Array): string {
  const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
  let n = 0n
  for (const b of bytes) n = (n << 8n) | BigInt(b)
  let out = ''
  while (n > 0n) {
    out = ALPHABET[Number(n % 58n)] + out
    n /= 58n
  }
  for (const b of bytes) {
    if (b !== 0) break
    out = `1${out}`
  }
  return out
}

const sql = postgres(env.DATABASE_URL_MIGRATE, { max: 1 })
const db = drizzle(sql)

for (const [i, address] of env.MARKET_ADDRESSES.entries()) {
  const symbols = env.MARKET_SYMBOLS[i]
  if (!symbols) throw new Error(`no symbols for ${address}`)
  const data = await fetchAccount(address)
  const h = decodeMarketHeader(data)
  const base = base58(h.baseMint)
  const quote = base58(h.quoteMint)
  const label = `${symbols.base}/${symbols.quote}` // the UI appends the venue
  await db
    .insert(markets)
    .values({
      venue: 'manifest',
      address,
      baseMint: base,
      quoteMint: quote,
      baseDecimals: h.baseDecimals,
      quoteDecimals: h.quoteDecimals,
      baseSymbol: symbols.base,
      quoteSymbol: symbols.quote,
      label,
      active: true,
    })
    .onConflictDoUpdate({
      target: markets.address,
      set: { baseSymbol: symbols.base, quoteSymbol: symbols.quote, label },
    })
  console.log(
    `market ${address} ${label} (${base.slice(0, 8)}/${quote.slice(0, 8)}) ${h.baseDecimals}/${h.quoteDecimals}`,
  )
}

for (const name of [env.RPC_A_NAME, env.RPC_B_NAME]) {
  await db
    .insert(deliveryPaths)
    .values({ name, kind: 'real', provider: name })
    .onConflictDoNothing({ target: deliveryPaths.name })
  console.log(`path ${name} real`)
}

await sql.end()
