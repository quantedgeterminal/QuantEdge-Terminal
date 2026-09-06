import { describe, expect, it } from 'vitest'
import { formatAtoms, formatPrice, formatSigned, priceDigits } from '../src/money.ts'

describe('formatAtoms / formatSigned — no float', () => {
  it('USDC (6): atoms → dollars with two decimals, thousands grouping', () => {
    expect(formatAtoms('123456789', 6)).toBe('123.45')
    expect(formatAtoms('-8568000', 6)).toBe('-8.56')
    expect(formatAtoms('1234567890123', 6)).toBe('1,234,567.89')
    expect(formatAtoms('5', 6)).toBe('0.00')
    expect(formatAtoms('-5', 6)).toBe('0.00') // zero without a minus
  })

  it('plus sign only for positives', () => {
    expect(formatSigned('184200000', 6)).toBe('+184.20')
    expect(formatSigned('-118400000', 6)).toBe('-118.40')
    expect(formatSigned('0', 6)).toBe('0.00')
  })
})

describe('formatPrice — u128 × 10^18 → quote per unit', () => {
  // cbBTC (8) / USDC (6): 110 000 USDC per BTC = 110000×10^6 quote atoms per 10^8 base atoms
  const price = ((110_000n * 10n ** 6n * 10n ** 18n) / 10n ** 8n).toString()
  it('recovers 110,000.00', () => {
    expect(formatPrice(price, 8, 6, 2)).toBe('110,000.00')
    expect(priceDigits(price, 8, 6)).toBe(2)
  })
  it('a small price gets more digits', () => {
    // 0.0123 USDC per token with 9 decimals
    const small = ((123n * 10n ** 6n * 10n ** 18n) / (10_000n * 10n ** 9n)).toString()
    expect(priceDigits(small, 9, 6)).toBe(6)
    expect(formatPrice(small, 9, 6, 6)).toBe('0.012300')
  })
})
