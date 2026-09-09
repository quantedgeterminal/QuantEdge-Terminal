import { type ReactNode, useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { ApiError, api, IncompletePeriod, InvalidField } from '../api/client.ts'
import type { CoverageSegment, Market, Preset, Strategy } from '../api/schemas.ts'
import { ParamEditor } from '../components/ParamEditor.tsx'
import { Shell } from '../components/Shell.tsx'
import { formatCount, formatDuration, formatRange } from '../money.ts'
import { paramsLine, parseParams, textsFor } from '../params.ts'

/** Default delay levels — the same as in the API (FR-008). */
const DELAY_LINE = '0 · 50 · 100 · 200 · 400 ms'

const INTRO =
  'Each run replays your strategy over one recorded order book at five feed delays and reports P&L at each. Nothing is sent to any market.'

/**
 * FR-022a: saved strategies hang on an anonymous key held by this
 * browser. The product says so where it offers to save and where the list
 * is empty — instead of a blank space without an explanation.
 */
export const KEY_NOTE =
  'Saved strategies are tied to an anonymous key kept by this browser — no account, no personal data. Clearing site data or switching browsers or devices starts with an empty list; nothing can be recovered.'

export const EMPTY_LIST_NOTE = `No saved strategies in this browser. ${KEY_NOTE}`

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

const inputClass =
  'qe-mono border border-[hsl(var(--qe-rule))] bg-[hsl(var(--qe-panel))] px-2 py-[6px] text-[13px] text-[hsl(var(--qe-text))] outline-none focus:border-[hsl(var(--qe-accent))]'
const buttonClass =
  'qe-mono border px-3 py-[6px] text-[12px] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent'

function MarketPicker({
  markets,
  marketId,
  onSelect,
}: {
  markets: Market[] | null
  marketId: number | null
  onSelect: (id: number) => void
}) {
  if (markets === null) return <Note>Loading markets…</Note>
  if (markets.length === 0) return <Note>No markets yet.</Note>
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
      <select
        className={inputClass}
        value={marketId ?? ''}
        onChange={(e) => onSelect(Number(e.target.value))}
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
        to={`/markets/${marketId}`}
        className="qe-mono ml-auto text-[12px] text-[hsl(var(--qe-accent))] underline underline-offset-4"
      >
        Open terminal
      </Link>
    </div>
  )
}

/** Periods are gap-free coverage segments (FR-006); a run goes only over a complete one. */
function PeriodPicker({
  coverage,
  segment,
  onSelect,
}: {
  coverage: CoverageSegment[] | null
  segment: number
  onSelect: (i: number) => void
}) {
  if (coverage === null) return <Note>Loading recorded periods…</Note>
  if (coverage.length === 0) {
    return <Note>No recorded periods for this market yet. The collector has to run first.</Note>
  }
  return coverage.map((c, i) => (
    <Radio key={c.from} checked={segment === i} onSelect={() => onSelect(i)}>
      <span className="qe-mono block text-[13px] text-[hsl(var(--qe-text))]">
        {formatRange(c.from, c.to)}
      </span>
      <span className="qe-mono block text-[11px] text-[hsl(var(--qe-dim))]">
        {formatDuration(c.from, c.to)} · {formatCount(c.updateCount)} updates
      </span>
    </Radio>
  ))
}

/** Strategies saved in this browser (FR-017); an empty list explains why (FR-022a). */
function SavedStrategies({
  strategies,
  presets,
  market,
  loadedId,
  onLoad,
  onDelete,
}: {
  strategies: Strategy[] | null
  presets: Preset[]
  market: Market | undefined
  loadedId: string | null
  onLoad: (preset: Preset, strategy: Strategy) => void
  onDelete: (strategy: Strategy) => void
}) {
  if (strategies === null) return null
  if (strategies.length === 0) {
    return (
      <p className="qe-mono mb-3 max-w-[520px] text-[11px] leading-[1.5] text-[hsl(var(--qe-faint))]">
        {EMPTY_LIST_NOTE}
      </p>
    )
  }
  return (
    <div className="mb-4">
      <p className="qe-smallcaps mb-1 text-[10px] text-[hsl(var(--qe-faint))]">
        Saved in this browser
      </p>
      {strategies.map((s) => {
        const p = presets.find((x) => x.id === s.preset)
        return (
          <div
            key={s.id}
            className="flex items-start gap-2 border-b border-[hsl(var(--qe-rule))] last:border-b-0"
          >
            <Radio checked={loadedId === s.id} onSelect={() => p && onLoad(p, s)}>
              <span className="block text-[13px] text-[hsl(var(--qe-text))]">
                {s.name}
                <span className="text-[hsl(var(--qe-dim))]"> · {p?.label ?? s.preset}</span>
              </span>
              <span className="qe-mono block text-[11px] text-[hsl(var(--qe-faint))]">
                {p ? paramsLine(p.params, market, s.params) : ''}
              </span>
            </Radio>
            <button
              type="button"
              onClick={() => onDelete(s)}
              aria-label={`Delete ${s.name}`}
              className="qe-mono mt-2 shrink-0 text-[11px] text-[hsl(var(--qe-dim))] hover:text-[hsl(var(--qe-loss))]"
            >
              delete
            </button>
          </div>
        )
      })}
    </div>
  )
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
  /** Parameter field text — what was typed; it becomes a number at run time. */
  const [texts, setTexts] = useState<Record<string, string>>({})
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [strategies, setStrategies] = useState<Strategy[] | null>(null)
  const [loadedStrategy, setLoadedStrategy] = useState<string | null>(null)
  const [saveName, setSaveName] = useState('')
  const [saveNote, setSaveNote] = useState<string | null>(null)
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
    api
      .strategies()
      .then((s) => alive && setStrategies(s))
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
  const preset = presets?.find((p) => p.id === presetId)

  /** Choosing a preset or a saved strategy: the fields are filled with its values. */
  const load = useCallback(
    (p: Preset, values: Readonly<Record<string, number>>, strategyId: string | null) => {
      setPresetId(p.id)
      setTexts(textsFor(p.params, market, values))
      setFieldErrors({})
      setLoadedStrategy(strategyId)
      setSaveNote(null)
    },
    [market],
  )

  // First preset after load and on market change: quote amounts depend on the market.
  // biome-ignore lint/correctness/useExhaustiveDependencies: refill only when the market changes or presets appear
  useEffect(() => {
    if (preset) load(preset, {}, null)
  }, [presets, marketId])

  const onParam = (key: string, text: string) => {
    setTexts((t) => ({ ...t, [key]: text }))
    setFieldErrors((e) => {
      if (!(key in e)) return e
      const { [key]: _, ...rest } = e
      return rest
    })
    setLoadedStrategy(null)
  }

  /** Parameters from the fields or errors under the fields; `null` — do not run. */
  const collectParams = (): Record<string, number> | null => {
    if (!preset) return null
    const parsed = parseParams(preset.params, market, texts)
    if ('errors' in parsed) {
      setFieldErrors(parsed.errors)
      return null
    }
    return parsed.params
  }

  const onFailure = (e: unknown) => {
    if (e instanceof InvalidField && e.isParam) {
      setFieldErrors((f) => ({ ...f, [e.field]: e.message }))
      return
    }
    setProblem(e instanceof IncompletePeriod ? cannotRun(e.missingRanges) : describe(e))
  }

  const canRun = marketId !== null && period !== undefined && preset !== undefined && !busy

  const onRun = async () => {
    if (!canRun) return
    setProblem(null)
    const params = collectParams()
    if (!params) return
    setBusy(true)
    try {
      const runId = await api.startRun({
        marketId,
        from: period.from,
        to: period.to,
        preset: preset.id,
        params,
      })
      navigate(`/runs/${runId}`)
    } catch (e) {
      onFailure(e)
    } finally {
      setBusy(false)
    }
  }

  const onSave = async () => {
    if (!preset || busy) return
    setProblem(null)
    setSaveNote(null)
    const params = collectParams()
    if (!params) return
    const name = saveName.trim()
    if (name === '') {
      setSaveNote('Give the strategy a name first.')
      return
    }
    setBusy(true)
    try {
      const saved = await api.saveStrategy({ name, preset: preset.id, params })
      setStrategies((s) => [saved, ...(s ?? [])])
      setLoadedStrategy(saved.id)
      setSaveName('')
      setSaveNote(`Saved as “${saved.name}”.`)
    } catch (e) {
      onFailure(e)
    } finally {
      setBusy(false)
    }
  }

  const onDelete = async (s: Strategy) => {
    if (busy) return
    setProblem(null)
    try {
      await api.deleteStrategy(s.id)
      setStrategies((list) => (list ?? []).filter((x) => x.id !== s.id))
      if (loadedStrategy === s.id) setLoadedStrategy(null)
    } catch (e) {
      onFailure(e)
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
            <MarketPicker markets={markets} marketId={marketId} onSelect={setMarketId} />
          </Field>

          <Field n="02" title="Period">
            <PeriodPicker coverage={coverage} segment={segment} onSelect={setSegment} />
          </Field>

          <Field n="03" title="Strategy">
            {presets === null ? (
              <Note>Loading presets…</Note>
            ) : (
              <>
                <SavedStrategies
                  strategies={strategies}
                  presets={presets}
                  market={market}
                  loadedId={loadedStrategy}
                  onLoad={(p, st) => load(p, st.params, st.id)}
                  onDelete={onDelete}
                />

                <p className="qe-smallcaps mb-1 text-[10px] text-[hsl(var(--qe-faint))]">Presets</p>
                {presets.map((p) => (
                  <Radio
                    key={p.id}
                    checked={presetId === p.id && loadedStrategy === null}
                    onSelect={() => load(p, {}, null)}
                  >
                    <span className="block text-[13px] text-[hsl(var(--qe-text))]">{p.label}</span>
                    <span className="block text-[11px] text-[hsl(var(--qe-dim))]">{p.summary}</span>
                  </Radio>
                ))}

                {preset && (
                  <div className="mt-4 border-l-2 border-[hsl(var(--qe-rule))] pl-3">
                    <p className="qe-smallcaps text-[10px] text-[hsl(var(--qe-faint))]">
                      Parameters · {preset.label}
                    </p>
                    <ParamEditor
                      specs={preset.params}
                      market={market}
                      texts={texts}
                      errors={fieldErrors}
                      onChange={onParam}
                    />
                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      <input
                        aria-label="Strategy name"
                        placeholder="Name to save as…"
                        value={saveName}
                        maxLength={60}
                        onChange={(e) => setSaveName(e.target.value)}
                        className={`${inputClass} min-w-0 flex-1`}
                      />
                      <button
                        type="button"
                        onClick={onSave}
                        disabled={busy}
                        className={`${buttonClass} border-[hsl(var(--qe-rule))] text-[hsl(var(--qe-text))] hover:bg-[hsl(var(--qe-panel))]`}
                      >
                        Save
                      </button>
                    </div>
                    {saveNote && (
                      <p className="qe-mono mt-2 text-[11px] text-[hsl(var(--qe-dim))]">
                        {saveNote}
                      </p>
                    )}
                    <p className="qe-mono mt-2 max-w-[520px] text-[11px] leading-[1.5] text-[hsl(var(--qe-faint))]">
                      {KEY_NOTE}
                    </p>
                  </div>
                )}
              </>
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
              {busy ? 'Working…' : 'Run backtest'}
            </button>
            {Object.keys(fieldErrors).length > 0 && (
              <Note tone="loss">Fix the highlighted parameters first.</Note>
            )}
            {problem && <Note tone="loss">{problem}</Note>}
          </div>
        </div>
      </main>
    </Shell>
  )
}

function describe(e: unknown): string {
  if (e instanceof InvalidField) return `${e.field}: ${e.message}`
  if (e instanceof ApiError) return `API error ${e.status} (${e.code}).`
  if (e instanceof Error) return `Could not reach the API: ${e.message}`
  return 'Unknown error.'
}
