import { describe, expect, it } from 'vitest'
import { loadEnv } from '../src/config.ts'

const ok = {
  DATABASE_URL: 'postgresql://x',
  RPC_A_NAME: 'a',
  RPC_A_WS_URL: 'wss://a.example/?key=1',
  RPC_B_NAME: 'b',
  RPC_B_WS_URL: 'wss://b.example/v2/2',
  MARKET_ADDRESSES:
    'Bey9vLee8CrC8S7iqNseb146upQCnSTbJQbu6vLiBRpD, CGA7cpvuPUm232ydGxcQCjbadgZNBsboSVjG9pNryqeZ',
}

describe('loadEnv', () => {
  it('parses the market list and fills in defaults', () => {
    const env = loadEnv(ok)
    expect(env.MARKET_ADDRESSES).toHaveLength(2)
    expect(env.BOOK_DEPTH).toBe(15)
    expect(env.LIVENESS_TIMEOUT_SEC).toBe(5)
  })

  it('LATENCY_MARKETS defaults to unset — channel A takes every market', () => {
    expect(loadEnv(ok).LATENCY_MARKETS).toBeUndefined()
  })

  it('LATENCY_MARKETS beyond the configured markets — refused with both numbers', () => {
    expect(() => loadEnv({ ...ok, LATENCY_MARKETS: '3' })).toThrow(/3 is more than the 2 markets/)
  })

  it('CHANNEL_A_SLOTS defaults to true — the slot pulse stays unless asked otherwise', () => {
    expect(loadEnv(ok).CHANNEL_A_SLOTS).toBe(true)
    expect(loadEnv({ ...ok, CHANNEL_A_SLOTS: 'false' }).CHANNEL_A_SLOTS).toBe(false)
  })

  it('CHANNEL_A_SLOTS takes true/false only — an unset-looking value is not silently false', () => {
    expect(() => loadEnv({ ...ok, CHANNEL_A_SLOTS: '0' })).toThrow(/CHANNEL_A_SLOTS/)
  })

  it('the event-pulse threshold is far longer than the slot one', () => {
    const env = loadEnv(ok)
    expect(env.WATCHDOG_QUIET_SILENCE_SEC).toBeGreaterThan(env.WATCHDOG_SILENCE_SEC)
  })

  it('two identical providers — refused: that is not two channels', () => {
    expect(() => loadEnv({ ...ok, RPC_B_WS_URL: ok.RPC_A_WS_URL })).toThrow(/independent/)
  })

  it('empty market list — refused with the field name', () => {
    expect(() => loadEnv({ ...ok, MARKET_ADDRESSES: ' , ' })).toThrow(/MARKET_ADDRESSES/)
  })

  it('http instead of ws — refused', () => {
    expect(() => loadEnv({ ...ok, RPC_A_WS_URL: 'https://a.example' })).toThrow(/RPC_A_WS_URL/)
  })
})
