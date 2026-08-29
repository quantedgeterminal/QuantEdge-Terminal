import { useState } from 'react'
import { Link } from 'react-router'
import LatencyLadder from '../components/LatencyLadder'
import { DemoStrip, Shell, Toggle } from '../components/Shell'
import {
  costLabel,
  emptyRun,
  type LadderLevel,
  mainRun,
  market,
  newRunLabel,
  tableColumns,
  tableFootnote,
} from '../lib/mockSource'

function HeaderLine({ line }: { line: string }) {
  const [name, ...rest] = line.split(' · ')
  return (
    <p className="qe-mono mb-5 text-[11px] leading-[1.6] text-[hsl(var(--qe-dim))]">
      <Link
        to={`/markets/${market.id}`}
        className="text-[hsl(var(--qe-text))] underline underline-offset-4"
      >
        {name} · {rest[0]}
      </Link>
      {rest.length > 1 ? ` · ${rest.slice(1).join(' · ')}` : ''}
    </p>
  )
}

function Rows({ levels }: { levels: LadderLevel[] }) {
  const cells = (l: LadderLevel) => [
    l.delayLabel,
    l.pnlLabel,
    l.trades,
    l.unfilled,
    l.slippage,
    l.drawdown,
  ]

  return (
    <>
      {/* table, md and up */}
      <table className="hidden w-full border-collapse md:table">
        <thead>
          <tr>
            {tableColumns.map((c, i) => (
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
          {levels.map((l) => (
            <tr
              key={l.delayLabel}
              className="border-b border-[hsl(var(--qe-rule))]"
              style={{
                color: l.loss ? 'hsl(var(--qe-loss))' : 'hsl(var(--qe-text))',
              }}
            >
              {cells(l).map((v, i) => (
                <td
                  key={tableColumns[i]}
                  className={`qe-mono py-[7px] text-[13px] ${i === 0 ? 'text-left' : 'text-right'}`}
                >
                  {v}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      {/* stacked definition lists, below md */}
      <div className="md:hidden">
        {levels.map((l) => (
          <div
            key={l.delayLabel}
            className="border-b border-[hsl(var(--qe-rule))] py-3"
            style={{
              color: l.loss ? 'hsl(var(--qe-loss))' : 'hsl(var(--qe-text))',
            }}
          >
            <p className="qe-mono mb-1 text-[13px]">{l.delayLabel}</p>
            <dl className="space-y-[2px]">
              {tableColumns.slice(1).map((c, i) => (
                <div key={c} className="flex items-baseline justify-between gap-4">
                  <dt className="text-[11px] text-[hsl(var(--qe-dim))]">{c}</dt>
                  <dd className="qe-mono text-[13px]">{cells(l)[i + 1]}</dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </div>
    </>
  )
}

export default function ResultScreen() {
  const [showEmpty, setShowEmpty] = useState(false)
  const run = showEmpty ? emptyRun : mainRun

  return (
    <Shell>
      <main className="mx-auto w-full max-w-[1280px] px-4 py-6 sm:px-6">
        <div className="mb-5 flex items-baseline justify-between gap-4">
          <h1 className="qe-mono text-[13px] text-[hsl(var(--qe-text))]">QuantEdge Terminal</h1>
          <Link
            to="/"
            className="qe-mono text-[12px] text-[hsl(var(--qe-accent))] underline underline-offset-4"
          >
            {newRunLabel}
          </Link>
        </div>

        <HeaderLine line={run.headerLine} />

        {run.cost ? (
          <>
            <section className="border-t border-[hsl(var(--qe-rule))] pt-4">
              <p className="qe-smallcaps mb-2 text-[10px] text-[hsl(var(--qe-dim))]">{costLabel}</p>
              <p className="qe-mono text-[32px] leading-[1.1] text-[hsl(var(--qe-loss))] sm:text-[44px]">
                {run.cost.figure}
              </p>
              <p className="mt-3 max-w-[720px] text-[12px] leading-[1.55] text-[hsl(var(--qe-dim))]">
                {run.cost.sentence}
              </p>
            </section>

            <section className="mt-6 border-t border-[hsl(var(--qe-rule))] pt-4">
              <LatencyLadder
                levels={run.levels}
                segment={{
                  fromIndex: run.cost.fromIndex,
                  toIndex: run.cost.toIndex,
                  label: run.cost.slopeLabel,
                }}
              />
            </section>

            <section className="mt-6">
              <Rows levels={run.levels} />
              <p className="mt-3 max-w-[820px] text-[11px] leading-[1.55] text-[hsl(var(--qe-dim))]">
                {tableFootnote}
              </p>
            </section>
          </>
        ) : (
          <section className="border-t border-[hsl(var(--qe-rule))] pt-8">
            <p className="qe-mono text-[22px] text-[hsl(var(--qe-dim))] sm:text-[28px]">
              {run.empty.headline}
            </p>
            <p className="mt-3 max-w-[640px] text-[12px] leading-[1.55] text-[hsl(var(--qe-dim))]">
              {run.empty.sentence}
            </p>
          </section>
        )}

        <DemoStrip>
          <Toggle label="Show empty run" on={showEmpty} onChange={setShowEmpty} />
        </DemoStrip>
      </main>
    </Shell>
  )
}
