import type { Market, ParamSpec } from './api/schemas.ts'

/** What the market must provide to show amounts: the symbol and the quote decimals. */
export type QuoteInfo = Pick<Market, 'quoteSymbol' | 'quoteDecimals'>

/**
 * Preset parameters at the UI boundary (FR-015, FR-016). The engine and the API know only
 * integers in the smallest units; a person types an amount in the quote currency
 * (`100.5` USDC), not `100500000` atoms. Conversion is by strings and BigInt, no float:
 * fractional arithmetic here would yield a different atom than the one shown.
 */

/** The unit a person sees: quote amounts in the market's currency. */
export function unitLabel(spec: ParamSpec, market: QuoteInfo | undefined): string {
  if (spec.unit === 'quote atoms') return market?.quoteSymbol ?? 'quote'
  return spec.unit
}

function isQuote(spec: ParamSpec): boolean {
  return spec.unit === 'quote atoms'
}

/** Atoms → decimal string without grouping, as for an input field. */
export function atomsToDecimal(atoms: number, decimals: number): string {
  const negative = atoms < 0
  const digits = String(Math.abs(atoms)).padStart(decimals + 1, '0')
  const whole = digits.slice(0, digits.length - decimals)
  const frac = digits.slice(digits.length - decimals).replace(/0+$/, '')
  return `${negative ? '-' : ''}${whole}${frac ? `.${frac}` : ''}`
}

/** Decimal string → atoms; `null` if the input is not a number or has more digits than the market. */
export function decimalToAtoms(text: string, decimals: number): number | null {
  const m = /^(-?)(\d+)(?:\.(\d*))?$/.exec(text.trim())
  if (!m) return null
  const [, sign, whole = '', frac = ''] = m
  if (frac.length > decimals) return null
  const atoms = BigInt(whole + frac.padEnd(decimals, '0'))
  if (atoms > BigInt(Number.MAX_SAFE_INTEGER)) return null
  return Number(sign === '-' ? -atoms : atoms)
}

/** A parameter value in input-field form. */
export function displayParam(
  spec: ParamSpec,
  market: QuoteInfo | undefined,
  value: number,
): string {
  return isQuote(spec) && market ? atomsToDecimal(value, market.quoteDecimals) : String(value)
}

/** Bounds in human form: `1…1,000,000,000 USDC` or `0…3600000 ms`. */
export function rangeLabel(spec: ParamSpec, market: QuoteInfo | undefined): string {
  return `${displayParam(spec, market, spec.min)}…${displayParam(spec, market, spec.max)} ${unitLabel(spec, market)}`
}

export type Parsed = { value: number } | { error: string }

/**
 * Field string → integer parameter value or an error on that field. The same
 * bounds as on the API: the server checks again, but the user sees the error
 * before the request.
 */
export function parseParam(spec: ParamSpec, market: QuoteInfo | undefined, text: string): Parsed {
  const raw = text.trim()
  if (raw === '') return { error: 'required' }
  let value: number | null
  if (isQuote(spec) && market) {
    value = decimalToAtoms(raw, market.quoteDecimals)
    if (value === null) return { error: `a number with at most ${market.quoteDecimals} decimals` }
  } else {
    value = /^-?\d+$/.test(raw) ? Number(raw) : null
    if (value === null || !Number.isSafeInteger(value)) return { error: 'a whole number' }
  }
  if (value < spec.min || value > spec.max) {
    return { error: `outside ${rangeLabel(spec, market)}` }
  }
  return { value }
}

/** All preset fields together: either full parameters or per-field errors. */
export function parseParams(
  specs: readonly ParamSpec[],
  market: QuoteInfo | undefined,
  texts: Readonly<Record<string, string>>,
): { params: Record<string, number> } | { errors: Record<string, string> } {
  const params: Record<string, number> = {}
  const errors: Record<string, string> = {}
  for (const spec of specs) {
    const parsed = parseParam(spec, market, texts[spec.key] ?? '')
    if ('error' in parsed) errors[spec.key] = parsed.error
    else params[spec.key] = parsed.value
  }
  return Object.keys(errors).length > 0 ? { errors } : { params }
}

/** Field text for a set of values (defaults or saved). */
export function textsFor(
  specs: readonly ParamSpec[],
  market: QuoteInfo | undefined,
  values: Readonly<Record<string, number>>,
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const spec of specs)
    out[spec.key] = displayParam(spec, market, values[spec.key] ?? spec.default)
  return out
}

/** Parameters in one line: `Order size = 100 USDC · Hold time = 800 ms`. */
export function paramsLine(
  specs: readonly ParamSpec[],
  market: QuoteInfo | undefined,
  values: Readonly<Record<string, number>>,
): string {
  return specs
    .map(
      (p) =>
        `${p.label} = ${displayParam(p, market, values[p.key] ?? p.default)} ${unitLabel(p, market)}`,
    )
    .join('   ·   ')
}
