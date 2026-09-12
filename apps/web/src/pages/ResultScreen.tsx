import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import { ApiError, api } from '../api/client.ts'
import type { LevelResult, Preset, Run } from '../api/schemas.ts'
import LatencyLadder, { type LadderLevel } from '../components/LatencyLadder.tsx'
import { Shell } from '../components/Shell.tsx'
import { formatAtoms, formatCount, formatDuration, formatRange, formatSigned } from '../money.ts'
import { paramsLine } from '../params.ts'

const COLUMNS = ['Delay', 'P&L', 'Trades', 'Unfilled', 'Avg slippage', 'Max drawdown'] as const

const FOOTNOTE =
  'Same data, same parameters at every level. The only thing that differs between rows is when the strategy saw the book. Slippage is signed against the price the strategy saw; the limit turns worse prices into unfilled orders, so read slippage together with the unfilled share.'

/** A number for bar geometry only; no digit of it is rendered. */
function geometry(atoms: string, decimals: number): number {
  return Number(atoms) / 10 ** decimals
}

function toLadder(r: LevelResult, decimals: number, quote: string): LadderLevel {
  return {
    delayLabel: `${r.latencyMs} ms`,
    pnl: geometry(r.pnl, decimals),
    pnlLabel: `${formatSigned(r.pnl, decimals)} ${quote}`,
    loss: r.pnl.startsWith('-'),
  }
}

/** Unfilled share with tenths: 128 of 23 896 is 0.5 %, not "0 %". The integer `unfilledPct` stays the engine's threshold. */
function unfilledPctText(r: LevelResult): string {
  if (r.orders === 0) return '0.0'
  return (Math.round((r.unfilled * 1000) / r.orders) / 10).toFixed(1)
}

function cells(r: LevelResult, decimals: number, quote: string): string[] {
  return [
    `${r.latencyMs} ms`,
    `${formatSigned(r.pnl, decimals)} ${quote}`,
    formatCount(r.trades),
    `${unfilledPctText(r)}% (${formatCount(r.unfilled)} of ${formatCount(r.orders)})`,
    r.avgSlippageBp === null ? '—' : `${r.avgSlippageBp.toFixed(2)} bp`,
    `${formatAtoms(r.maxDrawdown, decimals)} ${quote}`,
  ]
}

function Rows({ run }: { run: Run }) {
  const decimals = run.market.quoteDecimals
  const quote = run.market.quoteSymbol
  return (
    <>
      <table className="hidden w-full border-collapse md:table">
        <thead>
          <tr>
            {COLUMNS.map((c, i) => (
              <th
                key={c}
                className={`qe-smallcaps border-b border-[hsl(var(--qe-rule))] pb-2 text-[10px] font-normal text-[hsl(var(--qe-dim))] ${
                  i === 0 ? 'text-left' : 'text-right'
                }`}
              >
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {run.results.map((r) => (
            <tr
              key={r.latencyMs}
              className="border-b border-[hsl(var(--qe-rule))]"
              style={{
                color: r.pnl.startsWith('-') ? 'hsl(var(--qe-loss))' : 'hsl(var(--qe-text))',
              }}
            >
              {cells(r, decimals, quote).map((v, i) => (
                <td
                  key={COLUMNS[i]}
                  className={`qe-mono py-[7px] text-[13px] ${i === 0 ? 'text-left' : 'text-right'}`}
                >
                  {v}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      <div className="md:hidden">
        {run.results.map((r) => (
          <div
            key={r.latencyMs}
            className="border-b border-[hsl(var(--qe-rule))] py-3"
            style={{ color: r.pnl.startsWith('-') ? 'hsl(var(--qe-loss))' : 'hsl(var(--qe-text))' }}
          >
            <p className="qe-mono mb-1 text-[13px]">{r.latencyMs} ms</p>
            <dl className="space-y-[2px]">
              {COLUMNS.slice(1).map((c, i) => (
                <div key={c} className="flex items-baseline justify-between gap-4">
                  <dt className="text-[11px] text-[hsl(var(--qe-dim))]">{c}</dt>
                  <dd className="qe-mono text-[13px]">{cells(r, decimals, quote)[i + 1]}</dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </div>
    </>
  )
}

function costSentence(run: Run): string {
  const c = run.cost
  if (c === null) {
    return 'Undefined: fewer than two delay levels where most orders filled, so there is no slope to take.'
  }
  const base = `Slope of P&L between ${c.fromMs} ms and ${c.toMs} ms.`
  if (c.excludedMs.length === 0) return base
  return `${base} Levels ${c.excludedMs.join(', ')} ms are left out: at least half the orders there never filled, so the strategy stops being the same strategy and the fit stops before them.`
}

function Loaded({ run, preset }: { run: Run; preset: Preset | undefined }) {
  const decimals = run.market.quoteDecimals
  const quote = run.market.quoteSymbol
  const header = [
    preset?.label ?? run.preset,
    formatRange(run.from, run.to),
    formatDuration(run.from, run.to),
    `run-${run.id.slice(0, 4)}`,
  ].join(' · ')
  const anyTrades = run.results.some((r) => r.trades > 0)

  return (
    <>
      <p className="qe-mono mb-5 text-[11px] leading-[1.6] text-[hsl(var(--qe-dim))]">
        <Link
          to={`/markets/${run.market.id}`}
          className="text-[hsl(var(--qe-text))] underline underline-offset-4"
        >
          {run.market.label} · Manifest
        </Link>{' '}
        · {header}
      </p>
      {preset && (
        <p className="qe-mono -mt-4 mb-5 text-[11px] leading-[1.6] text-[hsl(var(--qe-faint))]">
          {paramsLine(preset.params, run.market, run.params)}
        </p>
      )}

      {run.status === 'failed' ? (
        <Section>
          <Big dim>Run failed</Big>
          <Sentence>{run.error ?? 'No reason was recorded.'}</Sentence>
        </Section>
      ) : !anyTrades ? (
        <Section>
          <Big dim>0 trades — nothing to price</Big>
          <Sentence>
            The strategy never entered in this period at any delay. P&L is not zero; it is
            undefined.
          </Sentence>
        </Section>
      ) : (
        <>
          <Section>
            <p className="qe-smallcaps mb-2 text-[10px] text-[hsl(var(--qe-dim))]">
              Cost of 100 ms
            </p>
            {run.cost ? (
              <Big loss={run.cost.costPer100Ms.startsWith('-')}>
                {formatSigned(run.cost.costPer100Ms, decimals)} {quote} per 100 ms
              </Big>
            ) : (
              <Big dim>—</Big>
            )}
            <Sentence>{costSentence(run)}</Sentence>
          </Section>

          <section className="mt-6 border-t border-[hsl(var(--qe-rule))] pt-4">
            <LatencyLadder
              levels={run.results.map((r) => toLadder(r, decimals, quote))}
              segment={
                run.cost
                  ? {
                      fromIndex: run.results.findIndex((r) => r.latencyMs === run.cost?.fromMs),
                      toIndex: run.results.findIndex((r) => r.latencyMs === run.cost?.toMs),
                      label: `${formatSigned(run.cost.costPer100Ms, decimals)} ${quote} per 100 ms`,
                    }
                  : null
              }
            />
          </section>

          <section className="mt-6">
            <Rows run={run} />
            <p className="mt-3 max-w-[820px] text-[11px] leading-[1.55] text-[hsl(var(--qe-dim))]">
              {FOOTNOTE}
            </p>
          </section>
        </>
      )}
    </>
  )
}

function Section({ children }: { children: React.ReactNode }) {
  return <section className="border-t border-[hsl(var(--qe-rule))] pt-4">{children}</section>
}

function Big({
  children,
  dim = false,
  loss = false,
}: {
  children: React.ReactNode
  dim?: boolean
  loss?: boolean
}) {
  const color = dim
    ? 'text-[hsl(var(--qe-dim))]'
    : loss
      ? 'text-[hsl(var(--qe-loss))]'
      : 'text-[hsl(var(--qe-accent))]'
  return <p className={`qe-mono text-[28px] leading-[1.1] sm:text-[44px] ${color}`}>{children}</p>
}

function Sentence({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-3 max-w-[720px] text-[12px] leading-[1.55] text-[hsl(var(--qe-dim))]">
      {children}
    </p>
  )
}

export default function ResultScreen() {
  const { runId } = useParams()
  const [run, setRun] = useState<Run | null>(null)
  const [preset, setPreset] = useState<Preset | undefined>(undefined)
  const [problem, setProblem] = useState<string | null>(null)

  useEffect(() => {
    if (!runId) return
    let alive = true
    Promise.all([api.run(runId), api.presets()])
      .then(([r, presets]) => {
        if (!alive) return
        setRun(r)
        setPreset(presets.find((p) => p.id === r.preset))
      })
      .catch((e: unknown) => {
        if (!alive) return
        if (e instanceof ApiError && e.status === 404) setProblem('No such run in this session.')
        else setProblem(e instanceof Error ? e.message : 'Unknown error.')
      })
    return () => {
      alive = false
    }
  }, [runId])

  return (
    <Shell>
      <main className="mx-auto w-full max-w-[1280px] px-4 py-6 sm:px-6">
        <div className="mb-5 flex items-baseline justify-between gap-4">
          <h1 className="qe-mono text-[13px] text-[hsl(var(--qe-text))]">QuantEdge Terminal</h1>
          <Link
            to="/"
            className="qe-mono text-[12px] text-[hsl(var(--qe-accent))] underline underline-offset-4"
          >
            New run
          </Link>
        </div>
        {problem ? (
          <p className="qe-mono text-[12px] text-[hsl(var(--qe-loss))]">{problem}</p>
        ) : run === null ? (
          <p className="qe-mono text-[12px] text-[hsl(var(--qe-dim))]">Loading run…</p>
        ) : (
          <Loaded run={run} preset={preset} />
        )}
      </main>
    </Shell>
  )
}
