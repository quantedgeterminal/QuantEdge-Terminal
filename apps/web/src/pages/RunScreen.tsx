import { type ReactNode, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { ApiError, api, IncompletePeriod, InvalidParam } from '../api/client.ts'
import type { CoverageSegment, Market, ParamSpec, Preset } from '../api/schemas.ts'
import { Shell } from '../components/Shell.tsx'
import { formatAtoms, formatCount, formatDuration, formatRange } from '../money.ts'

/** Default delay levels — the same as in the API (FR-008). */
const DELAY_LINE = '0 · 50 · 100 · 200 · 400 ms'

const INTRO =
  'Each run replays your strategy over one recorded order book at five feed delays and reports P&L at each. Nothing is sent to any market.'

function Field({ n, title, children }: { n: string; title: string; children: ReactNode }) {
  return (
    <section className="border-t border-[hsl(var(--qe-rule))] pt-3">
      <div className="mb-2 flex items-baseline gap-3">
        <span className="qe-mono text-[11px] text-[hsl(var(--qe-faint))]">{n}</span>
        <h2 className="qe-smallcaps text-[10px] text-[hsl(var(--qe-dim))]">{title}</h2>
      </div>
      {children}
    </section>
  )
}

function Radio({
  checked,
  onSelect,
  children,
}: {
  checked: boolean
  onSelect: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={checked}
      className="flex w-full items-start gap-3 border-b border-[hsl(var(--qe-rule))] py-2 text-left last:border-b-0 hover:bg-[hsl(var(--qe-panel))]"
    >
      <span
        className="mt-[4px] h-[9px] w-[9px] shrink-0 border"
        style={{
          borderColor: checked ? 'hsl(var(--qe-accent))' : 'hsl(var(--qe-rule))',
          background: checked ? 'hsl(var(--qe-accent))' : 'transparent',
        }}
      />
      <span className="min-w-0 flex-1">{children}</span>
    </button>
  )
}

function Note({ children, tone = 'dim' }: { children: ReactNode; tone?: 'dim' | 'loss' }) {
  return (
    <p
      className={`qe-mono mt-3 max-w-[520px] text-[12px] leading-[1.5] ${
        tone === 'loss' ? 'text-[hsl(var(--qe-loss))]' : 'text-[hsl(var(--qe-dim))]'
      }`}
    >
      {children}
    </p>
  )
}

/** A parameter value in human terms: quote amounts by the market's decimals. */
function paramLine(p: ParamSpec, market: Market | undefined): string {
  if (p.unit === 'quote atoms' && market) {
    const quote = market.label.split('/')[1] ?? 'quote'
    return `${p.label} = ${formatAtoms(String(p.default), market.quoteDecimals)} ${quote}`
  }
  return `${p.label} = ${p.default} ${p.unit}`
}

/** FR-014 refusal text — names the missing range and that nothing was computed. */
function cannotRun(ranges: { from: string; to: string }[]): string {
  const named = ranges.map((r) => formatRange(r.from, r.to)).join('; ')
  return `Cannot run. No recorded updates for ${named}. The run needs the full period; nothing was computed.`
}

export default function RunScreen() {
  const navigate = useNavigate()
  const [markets, setMarkets] = useState<Market[] | null>(null)
  const [presets, setPresets] = useState<Preset[] | null>(null)
  const [marketId, setMarketId] = useState<number | null>(null)
  const [coverage, setCoverage] = useState<CoverageSegment[] | null>(null)
  const [segment, setSegment] = useState<number>(0)
  const [presetId, setPresetId] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    Promise.all([api.markets(), api.presets()])
      .then(([m, p]) => {
        if (!alive) return
        setMarkets(m)
        setPresets(p)
        setMarketId(m[0]?.id ?? null)
        setPresetId(p[0]?.id ?? null)
      })
      .catch((e: unknown) => alive && setProblem(describe(e)))
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    if (marketId === null) return
    let alive = true
    setCoverage(null)
    setSegment(0)
    api
      .coverage(marketId)
      .then((c) => alive && setCoverage([...c].reverse())) // newest segment first
      .catch((e: unknown) => alive && setProblem(describe(e)))
    return () => {
      alive = false
    }
  }, [marketId])

  const period = coverage?.[segment]
  const market = markets?.find((m) => m.id === marketId)
  const canRun = marketId !== null && period !== undefined && presetId !== null && !busy

  const onRun = async () => {
    if (!canRun) return
    setBusy(true)
    setProblem(null)
    try {
      const runId = await api.startRun({
        marketId,
        from: period.from,
        to: period.to,
        preset: presetId,
      })
      navigate(`/runs/${runId}`)
    } catch (e) {
      setProblem(e instanceof IncompletePeriod ? cannotRun(e.missingRanges) : describe(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Shell>
      <main className="mx-auto w-full max-w-[560px] px-4 py-6 sm:px-6">
        <h1 className="qe-mono mb-1 text-[13px] tracking-wide text-[hsl(var(--qe-text))]">
          QuantEdge Terminal
        </h1>
        <p className="mb-6 text-[12px] leading-[1.5] text-[hsl(var(--qe-dim))]">{INTRO}</p>

        <div className="space-y-5">
          <Field n="01" title="Market">
            {markets === null ? (
              <Note>Loading markets…</Note>
            ) : markets.length === 0 ? (
              <Note>No markets yet.</Note>
            ) : (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                <select
                  className="qe-mono border border-[hsl(var(--qe-rule))] bg-[hsl(var(--qe-panel))] px-2 py-[6px] text-[13px] text-[hsl(var(--qe-text))] outline-none focus:border-[hsl(var(--qe-accent))]"
                  value={marketId ?? ''}
                  onChange={(e) => setMarketId(Number(e.target.value))}
                >
                  {markets.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label} · {m.venue}
                    </option>
                  ))}
                </select>
                <span className="text-[11px] text-[hsl(var(--qe-dim))]">
                  {markets.length} {markets.length === 1 ? 'market' : 'markets'} available
                </span>
                <Link
                  to="/markets/sol-usdc"
                  className="qe-mono ml-auto text-[12px] text-[hsl(var(--qe-accent))] underline underline-offset-4"
                >
                  Open terminal
                </Link>
              </div>
            )}
          </Field>

          <Field n="02" title="Period">
            {coverage === null ? (
              <Note>Loading recorded periods…</Note>
            ) : coverage.length === 0 ? (
              <Note>No recorded periods for this market yet. The collector has to run first.</Note>
            ) : (
              coverage.map((c, i) => (
                <Radio key={c.from} checked={segment === i} onSelect={() => setSegment(i)}>
                  <span className="qe-mono block text-[13px] text-[hsl(var(--qe-text))]">
                    {formatRange(c.from, c.to)}
                  </span>
                  <span className="qe-mono block text-[11px] text-[hsl(var(--qe-dim))]">
                    {formatDuration(c.from, c.to)} · {formatCount(c.updateCount)} updates
                  </span>
                </Radio>
              ))
            )}
          </Field>

          <Field n="03" title="Preset">
            {presets === null ? (
              <Note>Loading presets…</Note>
            ) : (
              presets.map((p) => (
                <Radio key={p.id} checked={presetId === p.id} onSelect={() => setPresetId(p.id)}>
                  <span className="block text-[13px] text-[hsl(var(--qe-text))]">{p.label}</span>
                  <span className="block text-[11px] text-[hsl(var(--qe-dim))]">{p.summary}</span>
                  <span className="qe-mono block text-[11px] text-[hsl(var(--qe-faint))]">
                    {p.params.map((x) => paramLine(x, market)).join('   ·   ')}
                  </span>
                </Radio>
              ))
            )}
          </Field>

          <Field n="04" title="Delay levels">
            <p className="qe-mono text-[13px] text-[hsl(var(--qe-text))]">{DELAY_LINE}</p>
            <p className="mt-1 text-[11px] text-[hsl(var(--qe-dim))]">
              Five levels, same data, same strategy.
            </p>
          </Field>

          <div className="border-t border-[hsl(var(--qe-rule))] pt-4">
            <button
              type="button"
              onClick={onRun}
              disabled={!canRun}
              className="qe-mono w-full border border-[hsl(var(--qe-accent))] px-4 py-[9px] text-[13px] text-[hsl(var(--qe-accent))] hover:bg-[hsl(var(--qe-accent))] hover:text-[hsl(var(--qe-bg))] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-[hsl(var(--qe-accent))] sm:w-auto"
            >
              {busy ? 'Running…' : 'Run backtest'}
            </button>
            {problem && <Note tone="loss">{problem}</Note>}
          </div>
        </div>
      </main>
    </Shell>
  )
}

function describe(e: unknown): string {
  if (e instanceof InvalidParam) return `${e.field}: ${e.message}`
  if (e instanceof ApiError) return `API error ${e.status} (${e.code}).`
  if (e instanceof Error) return `Could not reach the API: ${e.message}`
  return 'Unknown error.'
}
