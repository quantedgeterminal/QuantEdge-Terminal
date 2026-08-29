import { useState } from 'react'
import { Link } from 'react-router'
import { DemoStrip, Shell, Toggle } from '../components/Shell'
import { type BookRow, book, type InstrumentFigure, instrument, market } from '../lib/mockSource'

const maxAsk = Math.max(...book.asks.map((r) => r.cumulative))
const maxBid = Math.max(...book.bids.map((r) => r.cumulative))

function Row({
  row,
  max,
  side,
  stale,
}: {
  row: BookRow
  max: number
  side: 'ask' | 'bid'
  stale: boolean
}) {
  const color = side === 'ask' ? 'hsl(var(--qe-loss))' : 'hsl(var(--qe-accent))'
  const pct = (row.cumulative / max) * 100
  return (
    <div className="grid grid-cols-[minmax(0,72px)_minmax(0,1fr)_minmax(0,96px)] items-center gap-3 border-b border-[hsl(var(--qe-rule))] py-[3px]">
      <span
        className="qe-mono text-[12px]"
        style={{
          color,
          textDecorationLine: stale ? 'line-through' : 'none',
          textDecorationColor: 'hsl(var(--qe-loss))',
        }}
      >
        {row.price}
      </span>
      <span className="relative block h-[6px] bg-[hsl(var(--qe-panel))]">
        <span
          className="absolute left-0 top-0 h-full"
          style={{ width: `${pct}%`, background: color, opacity: 0.35 }}
        />
      </span>
      <span
        className="qe-mono text-right text-[12px] text-[hsl(var(--qe-text))]"
        style={{
          textDecorationLine: stale ? 'line-through' : 'none',
          textDecorationColor: 'hsl(var(--qe-loss))',
        }}
      >
        {row.size}
      </span>
    </div>
  )
}

function Figure({ f, isAge, stale }: { f: InstrumentFigure; isAge: boolean; stale: boolean }) {
  const [tip, setTip] = useState(false)
  const value = isAge && stale ? book.staleAge : f.value

  return (
    <div className="relative border-b border-[hsl(var(--qe-rule))] py-4">
      <button
        type="button"
        className="inline-block text-left"
        disabled={!f.tooltip}
        aria-expanded={f.tooltip ? tip : undefined}
        onMouseEnter={f.tooltip ? () => setTip(true) : undefined}
        onMouseLeave={f.tooltip ? () => setTip(false) : undefined}
        onFocus={f.tooltip ? () => setTip(true) : undefined}
        onBlur={f.tooltip ? () => setTip(false) : undefined}
        onClick={f.tooltip ? () => setTip(true) : undefined}
      >
        <p className="qe-smallcaps mb-2 text-[10px] text-[hsl(var(--qe-dim))]">{f.label}</p>
        <p
          className="qe-mono text-[20px] leading-none"
          style={{
            color: isAge && stale ? 'hsl(var(--qe-loss))' : 'hsl(var(--qe-text))',
            cursor: f.tooltip ? 'help' : 'default',
          }}
        >
          {value}
        </p>
      </button>
      <p className="mt-2 max-w-[420px] text-[11px] leading-[1.5] text-[hsl(var(--qe-dim))]">
        {f.note}
      </p>
      {f.tooltip && tip && (
        <div
          role="tooltip"
          className="absolute left-0 top-full z-10 mt-1 max-w-[420px] border border-[hsl(var(--qe-rule))] bg-[hsl(var(--qe-panel))] p-3 text-[11px] leading-[1.55] text-[hsl(var(--qe-text))]"
        >
          {f.tooltip}
        </div>
      )}
    </div>
  )
}

export default function TerminalScreen() {
  const [stale, setStale] = useState(false)

  return (
    <Shell>
      <main className="mx-auto w-full max-w-[1280px] px-4 py-6 sm:px-6">
        <div className="mb-5 flex items-baseline justify-between gap-4">
          <h1 className="qe-mono text-[13px] text-[hsl(var(--qe-text))]">{market.name}</h1>
          <Link
            to="/"
            className="qe-mono text-[12px] text-[hsl(var(--qe-accent))] underline underline-offset-4"
          >
            New run
          </Link>
        </div>

        <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,440px)]">
          {/* book */}
          <section
            className="border-t border-[hsl(var(--qe-rule))] pt-3"
            style={{ opacity: stale ? 0.45 : 1 }}
          >
            <div className="grid grid-cols-[minmax(0,72px)_minmax(0,1fr)_minmax(0,96px)] gap-3 pb-2">
              <span className="qe-smallcaps text-[10px] text-[hsl(var(--qe-dim))]">Price</span>
              <span className="qe-smallcaps text-[10px] text-[hsl(var(--qe-dim))]">Depth</span>
              <span className="qe-smallcaps text-right text-[10px] text-[hsl(var(--qe-dim))]">
                Size
              </span>
            </div>

            {[...book.asks].reverse().map((r) => (
              <Row key={r.price} row={r} max={maxAsk} side="ask" stale={stale} />
            ))}

            <div className="my-[2px] flex items-baseline justify-between gap-4 border-y border-[hsl(var(--qe-rule))] py-[6px]">
              {stale ? (
                <span className="qe-mono text-[12px] text-[hsl(var(--qe-loss))]">
                  {book.staleLine}
                </span>
              ) : (
                <>
                  <span className="qe-mono text-[13px] text-[hsl(var(--qe-text))]">
                    Mid {book.midLabel}
                  </span>
                  <span className="qe-mono text-[12px] text-[hsl(var(--qe-dim))]">
                    Spread {book.spreadLabel}
                  </span>
                </>
              )}
            </div>

            {book.bids.map((r) => (
              <Row key={r.price} row={r} max={maxBid} side="bid" stale={stale} />
            ))}

            <p className="qe-mono mt-3 text-[11px] text-[hsl(var(--qe-dim))]">{book.footer}</p>
          </section>

          {/* instrument panel */}
          <section className="border-t border-[hsl(var(--qe-rule))]">
            {instrument.map((f, i) => (
              <Figure key={f.label} f={f} isAge={i === 1} stale={stale} />
            ))}
            <p className="qe-mono mt-4 text-[11px] text-[hsl(var(--qe-faint))]">
              Tick {market.tick} · Lot {market.lot}
            </p>
          </section>
        </div>

        <DemoStrip>
          <Toggle label="Simulate stale feed" on={stale} onChange={setStale} />
        </DemoStrip>
      </main>
    </Shell>
  )
}
