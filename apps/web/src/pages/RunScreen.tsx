import { type ReactNode, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { DemoStrip, Shell } from '../components/Shell'
import {
  cannotRun,
  delayLine,
  delayNote,
  mainRun,
  market,
  periods,
  presets,
  runIntro,
  unrecordedPeriod,
} from '../lib/mockSource'

const recorded = periods.filter((p) => p.recorded)

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

export default function RunScreen() {
  const navigate = useNavigate()
  const [periodId, setPeriodId] = useState(recorded[0]?.id ?? '')
  const [presetId, setPresetId] = useState(presets[0]?.id ?? '')
  const [blocked, setBlocked] = useState<string | null>(null)

  const onRun = () => {
    const period = periods.find((p) => p.id === periodId)
    if (!period?.recorded) {
      setBlocked(cannotRun(period?.range ?? periodId))
      return
    }
    setBlocked(null)
    navigate(`/runs/${mainRun.id}`)
  }

  const select = (id: string) => {
    setPeriodId(id)
    setBlocked(null)
  }

  return (
    <Shell>
      <main className="mx-auto w-full max-w-[560px] px-4 py-6 sm:px-6">
        <h1 className="qe-mono mb-1 text-[13px] tracking-wide text-[hsl(var(--qe-text))]">
          QuantEdge Terminal
        </h1>
        <p className="mb-6 text-[12px] leading-[1.5] text-[hsl(var(--qe-dim))]">{runIntro}</p>

        <div className="space-y-5">
          <Field n="01" title="Market">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <select
                className="qe-mono border border-[hsl(var(--qe-rule))] bg-[hsl(var(--qe-panel))] px-2 py-[6px] text-[13px] text-[hsl(var(--qe-text))] outline-none focus:border-[hsl(var(--qe-accent))]"
                defaultValue={market.name}
              >
                <option>{market.name}</option>
              </select>
              <span className="text-[11px] text-[hsl(var(--qe-dim))]">{market.availability}</span>
              <Link
                to={`/markets/${market.id}`}
                className="qe-mono ml-auto text-[12px] text-[hsl(var(--qe-accent))] underline underline-offset-4"
              >
                Open terminal
              </Link>
            </div>
          </Field>

          <Field n="02" title="Period">
            {recorded.map((p) => (
              <Radio key={p.id} checked={periodId === p.id} onSelect={() => select(p.id)}>
                <span className="qe-mono block text-[13px] text-[hsl(var(--qe-text))]">
                  {p.range}
                </span>
                <span className="qe-mono block text-[11px] text-[hsl(var(--qe-dim))]">
                  {p.length} · {p.updates}
                  {p.perHour ? ` · ${p.perHour}` : ''}
                </span>
              </Radio>
            ))}
          </Field>

          <Field n="03" title="Preset">
            {presets.map((p) => (
              <Radio key={p.id} checked={presetId === p.id} onSelect={() => setPresetId(p.id)}>
                <span className="block text-[13px] text-[hsl(var(--qe-text))]">{p.name}</span>
                <span className="qe-mono block text-[11px] text-[hsl(var(--qe-dim))]">
                  {p.params.map((x) => `${x.label} = ${x.value}`).join('   ·   ')}
                </span>
              </Radio>
            ))}
          </Field>

          <Field n="04" title="Delay levels">
            <p className="qe-mono text-[13px] text-[hsl(var(--qe-text))]">{delayLine}</p>
            <p className="mt-1 text-[11px] text-[hsl(var(--qe-dim))]">{delayNote}</p>
          </Field>

          <div className="border-t border-[hsl(var(--qe-rule))] pt-4">
            <button
              type="button"
              onClick={onRun}
              className="qe-mono w-full border border-[hsl(var(--qe-accent))] px-4 py-[9px] text-[13px] text-[hsl(var(--qe-accent))] hover:bg-[hsl(var(--qe-accent))] hover:text-[hsl(var(--qe-bg))] sm:w-auto"
            >
              Run backtest
            </button>
            {blocked && (
              <p className="qe-mono mt-3 max-w-[520px] text-[12px] leading-[1.5] text-[hsl(var(--qe-loss))]">
                {blocked}
              </p>
            )}
          </div>
        </div>

        <DemoStrip>
          <Radio
            checked={periodId === unrecordedPeriod.id}
            onSelect={() => select(unrecordedPeriod.id)}
          >
            <span className="qe-mono block text-[13px] text-[hsl(var(--qe-text))]">
              {unrecordedPeriod.range}
            </span>
            <span className="qe-mono block text-[11px] text-[hsl(var(--qe-loss))]">
              not recorded
            </span>
          </Radio>
        </DemoStrip>
      </main>
    </Shell>
  )
}
