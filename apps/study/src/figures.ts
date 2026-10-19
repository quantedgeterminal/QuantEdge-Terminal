import type { Measured, StudyResult } from './study.ts'

/**
 * Every number the research page prints, by name, formatted the way the page prints it. The page
 * marks each one with `data-fig="<name>"` and a test compares the two, so a figure on the page
 * either comes out of the published run or the build fails — none is typed in by hand.
 */

const en = (digits: number) =>
  new Intl.NumberFormat('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })

/** A signed amount: the page writes the minus sign as U+2212, as typeset text does. */
export function fmt(x: number, digits: number): string {
  const s = en(digits).format(Math.abs(x))
  return x < 0 && s !== en(digits).format(0) ? `−${s}` : s
}

function p(x: number): string {
  return x < 0.001 ? '<0.001' : en(x < 0.01 ? 4 : 3).format(x)
}

function find(list: readonly Measured[], test: (m: Measured) => boolean, what: string): Measured {
  const m = list.find(test)
  if (!m) throw new RangeError(`no measurement for ${what}`)
  return m
}

const short: Record<string, string> = {
  'imbalance-momentum': 'imb',
  'momentum-chase': 'mom',
  'queue-depletion': 'queue',
  'stale-quote': 'stale',
}

/** The effect as a share of what was traded: bp of turnover at 0 ms over the summed windows. */
function effectBp(m: Measured): number | null {
  const first = m.pnlByLevel[0]
  const last = m.pnlByLevel[m.pnlByLevel.length - 1]
  if (first === undefined || last === undefined || m.turnoverAt0 === 0) return null
  return ((first - last) / m.turnoverAt0) * 10_000
}

function describe(out: Record<string, string>, key: string, m: Measured): void {
  out[`${key}.mean`] = fmt(m.meanEffect, 2)
  out[`${key}.signs`] = `${m.sign.negative} / ${m.sign.positive} / ${m.sign.ties}`
  out[`${key}.p`] = p(m.sign.p)
  out[`${key}.sd3`] = fmt(m.threeSigmaDiff, 2)
  out[`${key}.base3`] = fmt(m.threeSigmaBase, 2)
  out[`${key}.pnl0`] = fmt(m.pnlByLevel[0] ?? 0, 2)
  const bp = effectBp(m)
  out[`${key}.bp`] = bp === null ? '—' : fmt(bp, 3)
}

export function figures(r: StudyResult): Record<string, string> {
  const out: Record<string, string> = {}
  const all = [...r.baseline, ...r.sweep, ...r.control]
  out.configs = String(all.length)
  out.baselineCount = String(r.baseline.length)
  out.sweepCount = String(r.sweep.length)
  out.controlCount = String(r.control.length)
  out.unfilledAt0 = String(all.reduce((s, m) => s + m.unfilledAt0, 0))
  out.ordersAt0 = en(0).format(all.reduce((s, m) => s + m.ordersAt0, 0))

  let states = 0
  for (const { symbol, grain } of r.dataset.markets) {
    states += grain.states
    out[`${symbol}.states`] = en(0).format(grain.states)
    out[`${symbol}.gap`] = en(0).format(grain.medianGapMs ?? 0)
    out[`${symbol}.perSlot`] = en(2).format(grain.statesPerSlot)
    out[`${symbol}.shift50`] = en(0).format(grain.shiftedFromZeroPct[1] ?? 0)
    out[`${symbol}.shift400`] = en(2).format(grain.shiftedFromFasterPct[4] ?? 0)
    out[`${symbol}.shift100`] = en(2).format(grain.shiftedFromFasterPct[2] ?? 0)
  }
  out.states = en(0).format(states)

  for (const m of r.baseline) {
    describe(out, `base.${m.config.market}.${short[m.config.strategy]}.${m.windowSet}`, m)
  }
  for (const m of r.control) {
    describe(out, `ctrl.${m.config.market}.${m.config.edgeBp}.${m.windowSet}`, m)
  }

  const sw = r.sweep
  const traded = sw.filter((m) => m.slippageBp400 !== null)
  const slips = traded.map((m) => m.slippageBp400 ?? 0)
  out['sweep.positiveMean'] = String(sw.filter((m) => m.meanEffect > 0).length)
  out['sweep.sigNeg'] = String(
    sw.filter((m) => m.sign.p < 0.05 && m.sign.negative > m.sign.positive).length,
  )
  out['sweep.sigPos'] = String(
    sw.filter((m) => m.sign.p < 0.05 && m.sign.positive > m.sign.negative).length,
  )
  out['sweep.clearsBase'] = String(sw.filter((m) => m.clearsBase).length)
  out['sweep.clearsDiff'] = String(sw.filter((m) => m.clearsDiff).length)
  out['sweep.noTrades'] = String(sw.length - traded.length)
  out['sweep.traded'] = String(traded.length)
  out['sweep.slipNeg'] = String(slips.filter((s) => s < 0).length)
  out['sweep.slipMin'] = fmt(Math.min(...slips), 2)
  out['sweep.slipMax'] = fmt(Math.max(...slips), 2)
  out['all.clearsBase'] = String(all.filter((m) => m.clearsBase).length)
  out['all.clearsDiff'] = String(all.filter((m) => m.clearsDiff).length)

  const renderImb = (bp: number) =>
    find(
      sw,
      (m) =>
        m.config.market === 'RENDER' &&
        m.config.strategy === 'imbalance-momentum' &&
        m.config.notionalQuote === 10_000_000_000 &&
        m.config.maxSlippageBp === bp,
      `RENDER imbalance-momentum at 10,000 USDC and ${bp} bp`,
    )
  const cand = renderImb(2)
  out['cand.mean'] = fmt(cand.meanEffect, 2)
  out['cand.t'] = fmt(cand.t ?? 0, 2)
  out['cand.signs'] = `${cand.sign.positive} of ${cand.sign.negative + cand.sign.positive}`
  out['cand.p'] = p(cand.sign.p)
  out['cand1.mean'] = fmt(renderImb(1).meanEffect, 2)

  const usdtBig = find(
    sw,
    (m) =>
      m.config.market === 'USDT' &&
      m.config.strategy === 'queue-depletion' &&
      m.config.notionalQuote === 1_000_000_000_000 &&
      m.config.maxSlippageBp === 10,
    'USDT queue-depletion at 1M',
  )
  describe(out, 'usdtBig', usdtBig)

  for (const g of r.gridSlope) {
    const key = `slope.${g.market}.${short[g.strategy]}`
    out[`${key}.narrow`] = g.narrow ? fmt(g.narrow.cost, 2) : '—'
    out[`${key}.wide`] = g.wide ? fmt(g.wide.cost, 2) : '—'
    out[`${key}.wideTo`] = g.wide ? en(0).format(g.wide.toMs) : '—'
  }
  out['slope.identical'] = String(r.gridSlope.filter((g) => g.subStateLevelsIdentical).length)
  out['slope.count'] = String(r.gridSlope.length)
  return out
}
