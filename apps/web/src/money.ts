/**
 * Money formatting at the UI boundary: a decimal string in the smallest units →
 * a human notation with `decimals` digits after the point. No float: the string is sliced,
 * not divided.
 */
export function formatAtoms(atoms: string, decimals: number, fractionDigits = 2): string {
  const negative = atoms.startsWith('-')
  const digits = negative ? atoms.slice(1) : atoms
  const padded = digits.padStart(decimals + 1, '0')
  const whole = padded.slice(0, padded.length - decimals)
  const frac = padded.slice(padded.length - decimals).padEnd(fractionDigits, '0')
  const wholeGrouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  const body =
    fractionDigits === 0 ? wholeGrouped : `${wholeGrouped}.${frac.slice(0, fractionDigits)}`
  return negative && /[1-9]/.test(body) ? `-${body}` : body
}

/** With a "+" sign for positives — for P&L. */
export function formatSigned(atoms: string, decimals: number, fractionDigits = 2): string {
  const s = formatAtoms(atoms, decimals, fractionDigits)
  return s.startsWith('-') || /^[0.,]+$/.test(s) ? s : `+${s}`
}

export function formatUtc(iso: string): string {
  return iso.replace('T', ' ').slice(0, 16)
}

/** "2026-08-27 08:00 → 14:00 UTC", or with a date on the far end if the day differs. */
export function formatRange(fromIso: string, toIso: string): string {
  const from = formatUtc(fromIso)
  const to = formatUtc(toIso)
  const sameDay = from.slice(0, 10) === to.slice(0, 10)
  return `${from} → ${sameDay ? to.slice(11) : to} UTC`
}

export function formatDuration(fromIso: string, toIso: string): string {
  const ms = Date.parse(toIso) - Date.parse(fromIso)
  const minutes = Math.round(ms / 60_000)
  if (minutes < 60) return `${minutes} min`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m === 0 ? `${h} h` : `${h} h ${m} min`
}

export function formatCount(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}
