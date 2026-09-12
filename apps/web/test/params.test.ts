import { describe, expect, it } from 'vitest'
import type { Market, ParamSpec } from '../src/api/schemas.ts'
import {
  atomsToDecimal,
  decimalToAtoms,
  parseParam,
  parseParams,
  rangeLabel,
  textsFor,
} from '../src/params.ts'

const market: Market = {
  id: 1,
  label: 'cbBTC/USDC',
  venue: 'manifest',
  active: true,
  baseDecimals: 8,
  quoteDecimals: 6,
  baseSymbol: 'cbBTC',
  quoteSymbol: 'USDC',
}

const notional: ParamSpec = {
  key: 'notionalQuote',
  label: 'Order size',
  unit: 'quote atoms',
  min: 1,
  max: 1_000_000_000_000_000,
  default: 100_000_000,
}
const hold: ParamSpec = {
  key: 'holdMs',
  label: 'Hold time',
  unit: 'ms',
  min: 0,
  max: 3_600_000,
  default: 800,
}

describe('atoms ↔ decimal string without float', () => {
  it('round-trips at the boundary values', () => {
    expect(atomsToDecimal(100_000_000, 6)).toBe('100')
    expect(atomsToDecimal(100_500_000, 6)).toBe('100.5')
    expect(atomsToDecimal(1, 6)).toBe('0.000001')
    expect(decimalToAtoms('100.5', 6)).toBe(100_500_000)
    expect(decimalToAtoms('0.000001', 6)).toBe(1)
    expect(decimalToAtoms('100.', 6)).toBe(100_000_000)
  })

  it('refuses extra digits, non-numbers and values beyond safe integer', () => {
    expect(decimalToAtoms('0.0000001', 6)).toBeNull()
    expect(decimalToAtoms('1e3', 6)).toBeNull()
    expect(decimalToAtoms('abc', 6)).toBeNull()
    expect(decimalToAtoms('', 6)).toBeNull()
    expect(decimalToAtoms('99999999999999', 6)).toBeNull()
  })
})

describe('parseParam — the same bounds as on the API', () => {
  it('quote amount in USDC → atoms', () => {
    expect(parseParam(notional, market, '250')).toEqual({ value: 250_000_000 })
    expect(parseParam(notional, market, '0.5')).toEqual({ value: 500_000 })
  })

  it('an integer field does not accept fractions', () => {
    expect(parseParam(hold, market, '800')).toEqual({ value: 800 })
    expect(parseParam(hold, market, '1.5')).toEqual({ error: 'a whole number' })
    expect(parseParam(hold, market, '')).toEqual({ error: 'required' })
  })

  it('out of bounds — names the bounds in human units', () => {
    expect(parseParam(hold, market, '3600001')).toEqual({ error: 'outside 0…3600000 ms' })
    expect(parseParam(notional, market, '0')).toEqual({
      error: 'outside 0.000001…1000000000 USDC',
    })
    expect(rangeLabel(notional, market)).toBe('0.000001…1000000000 USDC')
  })

  it('all fields together: per-field errors or full parameters', () => {
    expect(parseParams([notional, hold], market, { notionalQuote: '100', holdMs: 'x' })).toEqual({
      errors: { holdMs: 'a whole number' },
    })
    expect(parseParams([notional, hold], market, textsFor([notional, hold], market, {}))).toEqual({
      params: { notionalQuote: 100_000_000, holdMs: 800 },
    })
  })
})
