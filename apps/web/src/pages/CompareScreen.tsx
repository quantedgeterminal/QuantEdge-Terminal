import { type FormEvent, useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { api } from '../api/client.ts'
import type { ArrivalEvent, Arrivals, LatencySummary, PathRef } from '../api/schemas.ts'
import {
  clock,
  emulatedCell,
  emulatedLabel,
  histogram,
  OFFSET_LIMIT_MS,
  type Profile,
  readProfile,
  realCell,
  realLanes,
} from '../compare.ts'
import { Shell } from '../components/Shell.tsx'

/** How often to re-read the rows and the measurement (the server window is 60 s). */
const POLL_MS = 2000

/** T049 / FR-003c: one real channel — nothing to compare, emulation does not substitute for it. */
export const NOTHING_TO_COMPARE =
  'Nothing to compare. Fewer than two real channels are recording this market. A difference against an emulated channel would only repeat the profile typed into it, so no lane and no distribution are shown until a second real channel is up.'

/** FR-003c: the difference between the emulated lane and a real one is not a measurement. Sits next to the lane. */
export const EMULATED_DISCLAIMER =
  'The emulated lane is the profile you typed, applied to the earliest real arrival. Its distance from the real channels is not a measurement and does not enter the distribution. No provider is claimed to match it.'

const LANE_HEAD = 'qe-smallcaps text-[10px] text-[hsl(var(--qe-dim))]'

function LaneRow({
  event,
  lanes,
  profile,
}: {
  event: ArrivalEvent
  lanes: [PathRef, PathRef]
  profile: Profile | null
}) {
  const lag = (p: PathRef) =>
    event.arrivals.find((a) => a.pathId === p.pathId && a.kind === 'real')?.lagMs ?? null
  const cell = (lagMs: number | null) => (
    <span
      className="qe-mono text-[12px]"
      style={{ color: lagMs === 0 ? 'hsl(var(--qe-accent))' : 'hsl(var(--qe-text))' }}
    >
      {realCell(lagMs)}
    </span>
  )
  return (
    <div
      className={`grid items-baseline gap-3 border-b border-[hsl(var(--qe-rule))] py-[4px] ${
        profile ? 'grid-cols-[minmax(0,100px)_1fr_1fr_1fr]' : 'grid-cols-[minmax(0,100px)_1fr_1fr]'
      }`}
    >
      <span className="qe-mono text-[11px] text-[hsl(var(--qe-dim))]">
        {clock(event.firstRealMs)}
      </span>
      {cell(lag(lanes[0]))}
      {cell(lag(lanes[1]))}
      {profile && (
        <span className="qe-mono text-[12px] text-[hsl(var(--qe-faint))] italic">
          {emulatedCell(profile)}
        </span>
      )}
    </div>
  )
}

/** Distribution of the slower channel's lag — bars per bucket (FR-021). */
function Distribution({
  events,
  lanes,
  summary,
}: {
  events: readonly ArrivalEvent[]
  lanes: [PathRef, PathRef]
  summary: LatencySummary | null
}) {
  const stats = summary?.paths.filter((p) => p.kind === 'real') ?? []
  const slower =
    [...stats].sort((a, b) => (b.p50Ms ?? 0) - (a.p50Ms ?? 0))[0] ??
    (lanes[1] ? { pathId: lanes[1].pathId, name: lanes[1].name } : null)
  if (!slower) return null
  const bins = histogram(events, slower.pathId)
  const total = bins.reduce((s, b) => s + b.count, 0)
  const max = bins.reduce((m, b) => (b.count > m ? b.count : m), 0)
  const p = stats.find((s) => s.pathId === slower.pathId)
  return (
    <section className="border-t border-[hsl(var(--qe-rule))] pt-3">
      <p className={LANE_HEAD}>Distribution · {slower.name} behind the other real channel</p>
      <p className="qe-mono mt-2 text-[16px] text-[hsl(var(--qe-text))]">
        {p && p.p50Ms !== null ? `p50 ${p.p50Ms} ms · p95 ${p.p95Ms} ms` : 'no shared updates yet'}
      </p>
      <p className="mt-1 text-[11px] text-[hsl(var(--qe-dim))]">
        {summary?.windowSec ?? 60} s window · {total} updates seen by both real channels
        {p?.laterPct !== null && p?.laterPct !== undefined ? ` · later on ${p.laterPct}%` : ''}
      </p>
      <div className="mt-3 space-y-[3px]">
        {bins.map((b) => (
          <div key={b.label} className="grid grid-cols-[72px_1fr_40px] items-center gap-2">
            <span className="qe-mono text-[11px] text-[hsl(var(--qe-dim))]">{b.label}</span>
            <span className="relative block h-[8px] bg-[hsl(var(--qe-panel))]">
              <span
                className="absolute top-0 left-0 h-full bg-[hsl(var(--qe-accent))]"
                style={{ width: max === 0 ? 0 : `${(b.count / max) * 100}%`, opacity: 0.6 }}
              />
            </span>
            <span className="qe-mono text-right text-[11px] text-[hsl(var(--qe-text))]">
              {b.count}
            </span>
          </div>
        ))}
      </div>
    </section>
  )
}

/** Emulated lane profile form (T048): offset and source — both, otherwise there is no lane. */
function ProfileForm({
  profile,
  onChange,
}: {
  profile: Profile | null
  onChange: (p: Profile | null) => void
}) {
  const [offset, setOffset] = useState(profile ? String(profile.offsetMs) : '')
  const [source, setSource] = useState(profile?.source ?? '')
  const [error, setError] = useState<string | null>(null)

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const raw = offset.trim()
    if (!/^-?\d+$/.test(raw) || Math.abs(Number(raw)) > OFFSET_LIMIT_MS) {
      setError(`Offset: a whole number of ms within ±${OFFSET_LIMIT_MS}.`)
      return
    }
    if (source.trim() === '') {
      setError('Source: say where the number comes from — it is shown next to the lane.')
      return
    }
    setError(null)
    onChange({ offsetMs: Number(raw), source: source.trim() })
  }

  return (
    <form onSubmit={submit} className="border-t border-[hsl(var(--qe-rule))] pt-3">
      <p className={LANE_HEAD}>Emulated lane</p>
      <p className="mt-1 max-w-[520px] text-[11px] leading-[1.5] text-[hsl(var(--qe-dim))]">
        Add a third lane that shows where updates would land under a delay profile you supply. It is
        always labelled as emulated and never measured against the real channels.
      </p>
      <div className="mt-2 flex flex-wrap items-end gap-2">
        <label className="block">
          <span className="block text-[11px] text-[hsl(var(--qe-dim))]">Offset, ms</span>
          <input
            value={offset}
            onChange={(e) => setOffset(e.target.value)}
            inputMode="numeric"
            placeholder="−100"
            className="qe-mono mt-1 w-[110px] border border-[hsl(var(--qe-rule))] bg-[hsl(var(--qe-panel))] px-2 py-[5px] text-[13px] text-[hsl(var(--qe-text))] outline-none focus:border-[hsl(var(--qe-accent))]"
          />
        </label>
        <label className="block w-full">
          <span className="block text-[11px] text-[hsl(var(--qe-dim))]">Source of the number</span>
          <input
            value={source}
            onChange={(e) => setSource(e.target.value)}
            maxLength={200}
            placeholder="e.g. vendor claim, link, or “my guess”"
            className="qe-mono mt-1 w-full border border-[hsl(var(--qe-rule))] bg-[hsl(var(--qe-panel))] px-2 py-[5px] text-[13px] text-[hsl(var(--qe-text))] outline-none focus:border-[hsl(var(--qe-accent))]"
          />
        </label>
        <button
          type="submit"
          className="qe-mono border border-[hsl(var(--qe-rule))] px-3 py-[6px] text-[12px] text-[hsl(var(--qe-text))] hover:bg-[hsl(var(--qe-panel))]"
        >
          {profile ? 'Update lane' : 'Add lane'}
        </button>
        {profile && (
          <button
            type="button"
            onClick={() => onChange(null)}
            className="qe-mono px-2 py-[6px] text-[12px] text-[hsl(var(--qe-dim))] hover:text-[hsl(var(--qe-loss))]"
          >
            remove
          </button>
        )}
      </div>
      {error && <p className="qe-mono mt-2 text-[11px] text-[hsl(var(--qe-loss))]">{error}</p>}
    </form>
  )
}

/** Lanes: a row per event, two real columns and, given a profile, a third emulated one (T047, T048). */
function Lanes({
  arrivals,
  lanes,
  profile,
}: {
  arrivals: Arrivals
  lanes: [PathRef, PathRef]
  profile: Profile | null
}) {
  return (
    <section className="border-t border-[hsl(var(--qe-rule))] pt-3">
      <div
        className={`grid gap-3 pb-2 ${
          profile
            ? 'grid-cols-[minmax(0,100px)_1fr_1fr_1fr]'
            : 'grid-cols-[minmax(0,100px)_1fr_1fr]'
        }`}
      >
        <span className={LANE_HEAD}>Update</span>
        <span className={LANE_HEAD}>{lanes[0].name} · real</span>
        <span className={LANE_HEAD}>{lanes[1].name} · real</span>
        {profile && (
          <span
            className="qe-smallcaps text-[10px] text-[hsl(var(--qe-loss))]"
            data-emulated="true"
          >
            {emulatedLabel(profile)}
          </span>
        )}
      </div>
      {arrivals.events.length === 0 ? (
        <p className="qe-mono py-6 text-[12px] text-[hsl(var(--qe-dim))]">
          No update reached both real channels inside the last {arrivals.windowSec} s.
        </p>
      ) : (
        arrivals.events.map((e) => (
          <LaneRow key={e.eventId} event={e} lanes={lanes} profile={profile} />
        ))
      )}
      {profile && (
        <p className="qe-mono mt-3 max-w-[640px] text-[11px] leading-[1.5] text-[hsl(var(--qe-loss))]">
          {EMULATED_DISCLAIMER}
        </p>
      )}
    </section>
  )
}

/** T049: one real channel — name the reason instead of showing a difference against emulation. */
function NothingToCompare({ paths }: { paths: readonly PathRef[] }) {
  return (
    <section className="border-t border-[hsl(var(--qe-rule))] pt-4">
      <p className="qe-mono text-[16px] text-[hsl(var(--qe-text))]">Nothing to compare</p>
      <p className="mt-2 max-w-[560px] text-[12px] leading-[1.5] text-[hsl(var(--qe-dim))]">
        {NOTHING_TO_COMPARE}
      </p>
      <p className="qe-mono mt-3 text-[11px] text-[hsl(var(--qe-faint))]">
        Real channels configured:{' '}
        {paths
          .filter((p) => p.kind === 'real')
          .map((p) => p.name)
          .join(', ') || 'none'}
      </p>
    </section>
  )
}

export default function CompareScreen() {
  const { marketId } = useParams()
  const id = Number(marketId)
  const validId = Number.isInteger(id) && id > 0
  const [search, setSearch] = useSearchParams()
  const profile = readProfile(search)
  const [label, setLabel] = useState<string | null>(null)
  const [arrivals, setArrivals] = useState<Arrivals | null>(null)
  const [summary, setSummary] = useState<LatencySummary | null>(null)
  const [problem, setProblem] = useState<string | null>(null)

  useEffect(() => {
    if (!validId) return
    let alive = true
    api
      .market(id)
      .then((m) => alive && setLabel(m ? `${m.label} · ${m.venue}` : 'No such market'))
      .catch((e: unknown) => alive && setProblem(e instanceof Error ? e.message : 'error'))
    const poll = () => {
      Promise.all([api.arrivals(id), api.latency(id)])
        .then(([a, s]) => {
          if (!alive) return
          setArrivals(a)
          setSummary(s)
          setProblem(null)
        })
        .catch((e: unknown) => alive && setProblem(e instanceof Error ? e.message : 'error'))
    }
    poll()
    const timer = setInterval(poll, POLL_MS)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [id, validId])

  const setProfile = (p: Profile | null) => {
    const next = new URLSearchParams(search)
    if (p) {
      next.set('offsetMs', String(p.offsetMs))
      next.set('source', p.source)
    } else {
      next.delete('offsetMs')
      next.delete('source')
    }
    setSearch(next, { replace: true })
  }

  const lanes = arrivals ? realLanes(arrivals.paths) : null
  // FR-003c: a measurement exists only between two real channels; without them — no lane and no distribution.
  const measurable = summary?.measurable ?? lanes !== null

  return (
    <Shell>
      <main className="mx-auto w-full max-w-[1280px] px-4 py-6 sm:px-6">
        <div className="mb-5 flex flex-wrap items-baseline justify-between gap-4">
          <h1 className="qe-mono text-[13px] text-[hsl(var(--qe-text))]">
            {validId ? (label ?? 'Loading…') : 'No such market'} · channels side by side
          </h1>
          <span className="flex gap-4">
            <Link
              to={`/markets/${id}`}
              className="qe-mono text-[12px] text-[hsl(var(--qe-accent))] underline underline-offset-4"
            >
              Terminal
            </Link>
            <Link
              to="/"
              className="qe-mono text-[12px] text-[hsl(var(--qe-accent))] underline underline-offset-4"
            >
              New run
            </Link>
          </span>
        </div>
        <p className="mb-5 max-w-[720px] text-[12px] leading-[1.5] text-[hsl(var(--qe-dim))]">
          The same order book arriving over two real channels. Each row is one update; each real
          lane shows how far behind the earliest real arrival that channel was. Lag from the chain
          event itself is not shown — it cannot be measured at this resolution.
        </p>

        {problem && (
          <p className="qe-mono mb-3 text-[12px] text-[hsl(var(--qe-loss))]">{problem}</p>
        )}

        {arrivals === null ? (
          <p className="qe-mono py-6 text-[12px] text-[hsl(var(--qe-dim))]">
            {validId ? 'Loading arrivals…' : 'Nothing to show.'}
          </p>
        ) : !measurable || lanes === null ? (
          <NothingToCompare paths={arrivals.paths} />
        ) : (
          <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,400px)]">
            <Lanes arrivals={arrivals} lanes={lanes} profile={profile} />

            <div className="space-y-6">
              <Distribution events={arrivals.events} lanes={lanes} summary={summary} />
              <ProfileForm profile={profile} onChange={setProfile} />
            </div>
          </div>
        )}
      </main>
    </Shell>
  )
}
