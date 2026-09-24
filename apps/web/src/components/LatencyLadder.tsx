/** A ladder level: `pnl` is a number for geometry only, `pnlLabel` is what renders. */
export interface LadderLevel {
  readonly delayLabel: string
  readonly pnl: number
  readonly pnlLabel: string
  readonly loss: boolean
}

interface Props {
  levels: LadderLevel[]
  segment?: { fromIndex: number; toIndex: number; label: string } | null
  /**
   * Appended to the axis caption. Equal rungs look like equal measurements, so when some of them
   * repeat their faster neighbour the axis has to say so where the eye already is.
   */
  note?: string | null
}

/* Geometry constants — layout only, no figure is derived for display. */
const W = 960
const H = 300
const PLOT_TOP = 46
const PLOT_BOTTOM = 204
const AXIS_Y = 258
const FIRST_X = 96
const STEP = 192
const BAR_W = 46

export default function LatencyLadder({ levels, segment, note }: Props) {
  const maxPos = Math.max(0, ...levels.map((l) => l.pnl))
  const maxNeg = Math.max(0, ...levels.map((l) => -l.pnl))
  const span = maxPos + maxNeg || 1
  const plotH = PLOT_BOTTOM - PLOT_TOP
  const zeroY = PLOT_TOP + (maxPos / span) * plotH

  const x = (i: number) => FIRST_X + i * STEP
  const barTop = (pnl: number) => (pnl >= 0 ? zeroY - (pnl / span) * plotH : zeroY)
  const barH = (pnl: number) => (Math.abs(pnl) / span) * plotH
  const tipY = (pnl: number) =>
    pnl >= 0 ? zeroY - (pnl / span) * plotH : zeroY + (-pnl / span) * plotH

  const from = segment ? levels[segment.fromIndex] : undefined
  const to = segment ? levels[segment.toIndex] : undefined
  const seg =
    segment && from && to
      ? {
          x1: x(segment.fromIndex),
          y1: tipY(from.pnl),
          x2: x(segment.toIndex),
          y2: tipY(to.pnl),
          label: segment.label,
        }
      : null

  return (
    <div className="w-full overflow-x-auto">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        role="img"
        aria-label="Latency ladder: P&L at each feed delay"
        className="block min-w-[760px]"
      >
        {/* zero line */}
        <line
          x1={24}
          x2={W - 24}
          y1={zeroY}
          y2={zeroY}
          stroke="hsl(var(--qe-rule))"
          strokeWidth={1}
        />
        <text
          x={24}
          y={zeroY - 6}
          fill="hsl(var(--qe-faint))"
          fontSize={10}
          fontFamily="var(--qe-font-mono)"
        >
          0
        </text>

        {levels.map((l, i) => {
          const cx = x(i)
          const color = l.loss ? 'hsl(var(--qe-loss))' : 'hsl(var(--qe-accent))'
          return (
            <g key={l.delayLabel}>
              <rect
                x={cx - BAR_W / 2}
                y={barTop(l.pnl)}
                width={BAR_W}
                height={Math.max(1, barH(l.pnl))}
                fill={color}
                fillOpacity={0.82}
              />
              <text
                x={cx}
                y={l.pnl >= 0 ? barTop(l.pnl) - 9 : barTop(l.pnl) + barH(l.pnl) + 18}
                textAnchor="middle"
                fill={color}
                fontSize={13}
                fontFamily="var(--qe-font-mono)"
              >
                {l.pnlLabel}
              </text>
              {/* rung tick */}
              <line
                x1={cx}
                x2={cx}
                y1={AXIS_Y - 20}
                y2={AXIS_Y - 14}
                stroke="hsl(var(--qe-rule))"
              />
              <text
                x={cx}
                y={AXIS_Y}
                textAnchor="middle"
                fill="hsl(var(--qe-dim))"
                fontSize={12}
                fontFamily="var(--qe-font-mono)"
              >
                {l.delayLabel}
              </text>
            </g>
          )
        })}

        {seg && (
          <g>
            <line
              x1={seg.x1}
              y1={seg.y1}
              x2={seg.x2}
              y2={seg.y2}
              stroke="hsl(var(--qe-text))"
              strokeWidth={1}
            />
            <rect x={seg.x1 - 3} y={seg.y1 - 3} width={6} height={6} fill="hsl(var(--qe-text))" />
            <rect x={seg.x2 - 3} y={seg.y2 - 3} width={6} height={6} fill="hsl(var(--qe-text))" />
            {/* caption sits on the axis line, clear of the bar labels */}
            <line
              x1={24}
              x2={44}
              y1={AXIS_Y + 18}
              y2={AXIS_Y + 18}
              stroke="hsl(var(--qe-text))"
              strokeWidth={1}
            />
            <text
              x={52}
              y={AXIS_Y + 22}
              fill="hsl(var(--qe-text))"
              fontSize={12}
              fontFamily="var(--qe-font-mono)"
            >
              {seg.label}
            </text>
          </g>
        )}

        <text
          x={W - 24}
          y={AXIS_Y + 22}
          textAnchor="end"
          fill="hsl(var(--qe-faint))"
          fontSize={10}
          fontFamily="var(--qe-font-sans)"
        >
          Feed delay — five fixed rungs, equal spacing
          {note ? ` · ${note}` : ''}
        </text>
      </svg>
    </div>
  )
}
