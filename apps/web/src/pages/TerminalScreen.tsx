import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import { api } from '../api/client.ts'
import type { LatencySummary, PathLatency } from '../api/schemas.ts'
import { type Frame, openBookStream } from '../api/stream.ts'
import { Shell } from '../components/Shell.tsx'
import { formatPrice, formatSize, priceDigits } from '../money.ts'

/** How often to re-read the differential-latency measurement (the server window is 60 s). */
const LATENCY_POLL_MS = 5000

const LAG_TOOLTIP =
  'Measured between our two real channels only: for each book update, when this channel received it minus when the earliest real channel received it. Not latency from the chain event, which cannot be measured at this resolution. Not a measurement of any third-party feed.'

interface Row {
  price: string
  size: string
  /** For depth bar geometry only. */
  cumulative: number
}

type MarketMeta = Frame['market']

function rows(levels: Frame['bids'], market: MarketMeta, digits: number): Row[] {
  let acc = 0
  return levels.map((l) => {
    acc += Number(l.size)
    return {
      price: formatPrice(l.price, market.baseDecimals, market.quoteDecimals, digits),
      size: formatSize(l.size, market.baseDecimals, 4),
      cumulative: acc,
    }
  })
}

function BookRow({
  row,
  max,
  side,
  stale,
}: {
  row: Row
  max: number
  side: 'ask' | 'bid'
  stale: boolean
}) {
  const color = side === 'ask' ? 'hsl(var(--qe-loss))' : 'hsl(var(--qe-accent))'
  const pct = max === 0 ? 0 : (row.cumulative / max) * 100
  const struck = { textDecorationLine: stale ? 'line-through' : 'none' } as const
  return (
    <div className="grid grid-cols-[minmax(0,110px)_minmax(0,1fr)_minmax(0,110px)] items-center gap-3 border-b border-[hsl(var(--qe-rule))] py-[3px]">
      <span className="qe-mono text-[12px]" style={{ color, ...struck }}>
        {row.price}
      </span>
      <span className="relative block h-[6px] bg-[hsl(var(--qe-panel))]">
        <span
          className="absolute top-0 left-0 h-full"
          style={{ width: `${pct}%`, background: color, opacity: 0.35 }}
        />
      </span>
      <span className="qe-mono text-right text-[12px] text-[hsl(var(--qe-text))]" style={struck}>
        {row.size}
      </span>
    </div>
  )
}

function Figure({
  label,
  value,
  note,
  tooltip,
  loss = false,
}: {
  label: string
  value: string
  note: string
  tooltip?: string
  loss?: boolean
}) {
  const [tip, setTip] = useState(false)
  return (
    <div className="relative border-b border-[hsl(var(--qe-rule))] py-4">
      <button
        type="button"
        className="inline-block text-left"
        disabled={!tooltip}
        aria-expanded={tooltip ? tip : undefined}
        onMouseEnter={tooltip ? () => setTip(true) : undefined}
        onMouseLeave={tooltip ? () => setTip(false) : undefined}
        onFocus={tooltip ? () => setTip(true) : undefined}
        onBlur={tooltip ? () => setTip(false) : undefined}
        onClick={tooltip ? () => setTip(true) : undefined}
      >
        <p className="qe-smallcaps mb-2 text-[10px] text-[hsl(var(--qe-dim))]">{label}</p>
        <p
          className="qe-mono text-[20px] leading-none"
          style={{
            color: loss ? 'hsl(var(--qe-loss))' : 'hsl(var(--qe-text))',
            cursor: tooltip ? 'help' : 'default',
          }}
        >
          {value}
        </p>
      </button>
      <p className="mt-2 max-w-[420px] text-[11px] leading-[1.5] text-[hsl(var(--qe-dim))]">
        {note}
      </p>
      {tooltip && tip && (
        <div
          role="tooltip"
          className="absolute top-full left-0 z-10 mt-1 max-w-[420px] border border-[hsl(var(--qe-rule))] bg-[hsl(var(--qe-panel))] p-3 text-[11px] leading-[1.55] text-[hsl(var(--qe-text))]"
        >
          {tooltip}
        </div>
      )}
    </div>
  )
}

/** Lag measurement: the slower real channel against the faster one (FR-003, FR-003c). */
function lagFigure(summary: LatencySummary | null): { value: string; note: string } {
  if (summary === null) return { value: '…', note: 'Loading the channel measurement.' }
  if (!summary.measurable) {
    return {
      value: 'nothing to compare',
      note: 'Fewer than two real channels are recording. A difference against an emulated channel would only repeat its profile, so none is shown.',
    }
  }
  const real = summary.paths.filter((p): p is PathLatency => p.kind === 'real')
  const measured = real.filter((p) => p.p50Ms !== null)
  const slower = [...measured].sort((a, b) => (b.p50Ms ?? 0) - (a.p50Ms ?? 0))[0]
  if (!slower || summary.sharedEvents === 0) {
    return {
      value: 'no shared updates yet',
      note: `${summary.windowSec} s window. Both real channels are up, but no update reached both inside the window.`,
    }
  }
  const others = real.filter((p) => p.pathId !== slower.pathId).map((p) => p.name)
  return {
    value: `p50 ${slower.p50Ms} ms · p95 ${slower.p95Ms} ms`,
    note: `${summary.windowSec} s window, ${summary.sharedEvents} updates. ${slower.name} behind ${others.join(', ')}; it was later on ${slower.laterPct}%.`,
  }
}

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)} s`
}

/** Render-side derivatives of a frame: rows, bar maxima, mid and spread. */
function derive(frame: Frame, market: MarketMeta) {
  const best = frame.asks[0]?.price
  const digits = best ? priceDigits(best, market.baseDecimals, market.quoteDecimals) : 2
  const asks = rows(frame.asks, market, digits)
  const bids = rows(frame.bids, market, digits)
  const bestAsk = frame.asks[0]?.price
  const bestBid = frame.bids[0]?.price
  const px = (v: bigint, d: number) =>
    formatPrice(v.toString(), market.baseDecimals, market.quoteDecimals, d)
  return {
    asks,
    bids,
    maxAsk: asks.reduce((m, r) => (r.cumulative > m ? r.cumulative : m), 0),
    maxBid: bids.reduce((m, r) => (r.cumulative > m ? r.cumulative : m), 0),
    mid: bestAsk && bestBid ? px((BigInt(bestAsk) + BigInt(bestBid)) / 2n, digits + 1) : null,
    spread: bestAsk && bestBid ? px(BigInt(bestAsk) - BigInt(bestBid), digits) : null,
  }
}

function Book({ frame, market }: { frame: Frame; market: MarketMeta }) {
  const d = derive(frame, market)
  const stale = frame.stale
  return (
    <>
      {[...d.asks].reverse().map((r) => (
        <BookRow key={r.price} row={r} max={d.maxAsk} side="ask" stale={stale} />
      ))}
      <div className="my-[2px] flex items-baseline justify-between gap-4 border-y border-[hsl(var(--qe-rule))] py-[6px]">
        {stale ? (
          <span className="qe-mono text-[12px] text-[hsl(var(--qe-loss))]">
            Stale — last update {seconds(frame.ageMs)} ago
          </span>
        ) : (
          <>
            <span className="qe-mono text-[13px] text-[hsl(var(--qe-text))]">
              Mid {d.mid ?? '—'}
            </span>
            <span className="qe-mono text-[12px] text-[hsl(var(--qe-dim))]">
              Spread {d.spread ?? '—'}
            </span>
          </>
        )}
      </div>
      {d.bids.map((r) => (
        <BookRow key={r.price} row={r} max={d.maxBid} side="bid" stale={stale} />
      ))}
      <p className="qe-mono mt-3 text-[11px] text-[hsl(var(--qe-dim))]">
        Update {frame.t.replace('T', ' ').slice(0, 19)} UTC · {frame.asks.length} asks ·{' '}
        {frame.bids.length} bids · channel: {frame.pathName} ({frame.pathKind})
      </p>
    </>
  )
}

export default function TerminalScreen() {
  const { marketId } = useParams()
  const id = Number(marketId)
  const validId = Number.isInteger(id) && id > 0
  const [frame, setFrame] = useState<Frame | null>(null)
  const [latency, setLatency] = useState<LatencySummary | null>(null)
  const [problem, setProblem] = useState<string | null>(null)

  // The first screen is built from the first stream frame: market metadata rides in the frame,
  // there is no separate request before opening the stream (SC-004).
  useEffect(() => {
    if (!validId) return
    const stream = openBookStream(
      id,
      (f) => {
        setFrame(f)
        setProblem(null)
      },
      (e) => setProblem(e.message),
    )
    const poll = () => {
      api
        .latency(id)
        .then(setLatency)
        .catch(() => setLatency(null))
    }
    poll()
    const timer = setInterval(poll, LATENCY_POLL_MS)
    return () => {
      stream.close()
      clearInterval(timer)
    }
  }, [id, validId])

  const market = frame?.market ?? null
  const stale = frame?.stale ?? false
  const lag = lagFigure(latency)
  const title = !validId
    ? 'No such market'
    : market
      ? `${market.label} · ${market.venue}`
      : 'Waiting for the first book update…'

  return (
    <Shell>
      <main className="mx-auto w-full max-w-[1280px] px-4 py-6 sm:px-6">
        <div className="mb-5 flex items-baseline justify-between gap-4">
          <h1 className="qe-mono text-[13px] text-[hsl(var(--qe-text))]">{title}</h1>
          <Link
            to="/"
            className="qe-mono text-[12px] text-[hsl(var(--qe-accent))] underline underline-offset-4"
          >
            New run
          </Link>
        </div>

        {problem && (
          <p className="qe-mono mb-3 text-[12px] text-[hsl(var(--qe-loss))]">{problem}</p>
        )}

        <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,440px)]">
          <section
            className="border-t border-[hsl(var(--qe-rule))] pt-3"
            style={{ opacity: stale ? 0.45 : 1 }}
          >
            <div className="grid grid-cols-[minmax(0,110px)_minmax(0,1fr)_minmax(0,110px)] gap-3 pb-2">
              <span className="qe-smallcaps text-[10px] text-[hsl(var(--qe-dim))]">Price</span>
              <span className="qe-smallcaps text-[10px] text-[hsl(var(--qe-dim))]">Depth</span>
              <span className="qe-smallcaps text-right text-[10px] text-[hsl(var(--qe-dim))]">
                Size
              </span>
            </div>
            {frame && market ? (
              <Book frame={frame} market={market} />
            ) : (
              <p className="qe-mono py-6 text-[12px] text-[hsl(var(--qe-dim))]">
                {validId ? 'Waiting for the first book update…' : 'Nothing to show.'}
              </p>
            )}
          </section>

          <section className="border-t border-[hsl(var(--qe-rule))]">
            <Figure
              label="Lag, slower channel behind faster"
              value={lag.value}
              note={lag.note}
              tooltip={LAG_TOOLTIP}
            />
            <Figure
              label="Age of last update"
              value={frame ? seconds(frame.ageMs) : '—'}
              note="Time since the newest update reached this screen."
              loss={stale}
            />
            <Figure
              label="Stale after"
              value={frame ? seconds(frame.staleAfterMs) : '5.0 s'}
              note="Past this, the book is marked stale and its age is shown instead of prices."
            />
          </section>
        </div>
      </main>
    </Shell>
  )
}
