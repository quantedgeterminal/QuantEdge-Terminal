/**
 * QuantEdge Terminal — single source of all figures.
 *
 * Every number rendered anywhere in the app lives here as a verbatim string.
 * Numeric fields exist only where geometry needs them (bar heights, depth bars)
 * and are never displayed; the adjacent *Label string is what is rendered.
 */

export const banner =
  'Prototype — every figure on this screen is fictional. No data has been collected and nothing has been measured.'

/* ---------------------------------------------------------------- market */

export const market = {
  id: 'sol-usdc',
  name: 'SOL/USDC · Manifest',
  tick: '0.01 USDC',
  lot: '0.001 SOL',
  availability: '1 market available',
} as const

/* -------------------------------------------------------------- coverage */

export interface Period {
  id: string
  range: string
  length: string
  updates: string
  perHour?: string
  recorded: boolean
}

export const unrecordedPeriod: Period = {
  id: 'p-unrecorded',
  range: '2026-08-27 14:00 → 20:00 UTC',
  length: '6 h',
  updates: 'not recorded',
  recorded: false,
}

export const periods: Period[] = [
  {
    id: 'p-0910',
    range: '2026-08-27 08:00 → 14:00 UTC',
    length: '6 h',
    updates: '40,608 updates',
    perHour: '~6,768 per hour',
    recorded: true,
  },
  {
    id: 'p-0909',
    range: '2026-08-26 10:00 → 13:00 UTC',
    length: '3 h',
    updates: '20,304 updates',
    recorded: true,
  },
  unrecordedPeriod,
]

export const storagePerUpdate = '520 B'

/* --------------------------------------------------------------- presets */

export interface Preset {
  id: string
  name: string
  params: { label: string; value: string }[]
}

export const presets: Preset[] = [
  {
    id: 'spread-capture',
    name: 'Spread capture',
    params: [
      { label: 'Quote offset', value: '1 tick' },
      { label: 'Max position', value: '50.000 SOL' },
    ],
  },
  {
    id: 'top-of-book',
    name: 'Top-of-book follower',
    params: [
      { label: 'Requote threshold', value: '2 ticks' },
      { label: 'Order size', value: '5.000 SOL' },
    ],
  },
  {
    id: 'imbalance-momentum',
    name: 'Imbalance momentum',
    params: [
      { label: 'Imbalance trigger', value: '65%' },
      { label: 'Hold time', value: '800 ms' },
    ],
  },
]

export const delayLine = '0 · 50 · 100 · 200 · 400 ms'
export const delayNote = 'Five levels, same data, same strategy.'

export const runIntro =
  'Each run replays your strategy over one recorded order book at five feed delays and reports P&L at each. Nothing is sent to any market.'

/* ------------------------------------------------------------------ runs */

export interface LadderLevel {
  delayLabel: string
  /** geometry only — never rendered */
  pnl: number
  pnlLabel: string
  trades: string
  unfilled: string
  slippage: string
  drawdown: string
  loss: boolean
}

interface RunBase {
  id: string
  headerLine: string
  presetName: string
  periodRange: string
  levels: LadderLevel[]
}

export interface RunCost {
  figure: string
  sentence: string
  /** indices into levels marking the fitted segment */
  fromIndex: number
  toIndex: number
  slopeLabel: string
}

/** A run either priced the delay or has nothing to price — never both, never neither. */
export type RunRecord =
  | (RunBase & { cost: RunCost; empty: null })
  | (RunBase & { cost: null; empty: { headline: string; sentence: string } })

export const tableColumns = [
  'Delay',
  'P&L',
  'Trades',
  'Unfilled',
  'Avg slippage',
  'Max drawdown',
] as const

export const tableFootnote =
  'Same data, same parameters, same random seed at every level. The only thing that differs between rows is when the strategy saw the book.'

export const mainRun: RunRecord = {
  id: 'run-7f3a',
  headerLine:
    'SOL/USDC · Manifest · Spread capture · 2026-08-27 08:00 → 14:00 UTC · 6 h · 40,608 updates · run-7f3a · 11.4 s',
  presetName: 'Spread capture',
  periodRange: '2026-08-27 08:00 → 14:00 UTC',
  levels: [
    {
      delayLabel: '0 ms',
      pnl: 184.2,
      pnlLabel: '+184.20 USDC',
      trades: '312',
      unfilled: '2.1%',
      slippage: '0.8 bp',
      drawdown: '22.10 USDC',
      loss: false,
    },
    {
      delayLabel: '50 ms',
      pnl: 141.65,
      pnlLabel: '+141.65 USDC',
      trades: '305',
      unfilled: '6.4%',
      slippage: '1.9 bp',
      drawdown: '31.45 USDC',
      loss: false,
    },
    {
      delayLabel: '100 ms',
      pnl: 97.3,
      pnlLabel: '+97.30 USDC',
      trades: '291',
      unfilled: '11.9%',
      slippage: '3.4 bp',
      drawdown: '44.90 USDC',
      loss: false,
    },
    {
      delayLabel: '200 ms',
      pnl: 12.85,
      pnlLabel: '+12.85 USDC',
      trades: '262',
      unfilled: '24.0%',
      slippage: '6.7 bp',
      drawdown: '71.20 USDC',
      loss: false,
    },
    {
      delayLabel: '400 ms',
      pnl: -118.4,
      pnlLabel: '-118.40 USDC',
      trades: '219',
      unfilled: '41.3%',
      slippage: '12.5 bp',
      drawdown: '133.60 USDC',
      loss: true,
    },
  ],
  cost: {
    figure: '-85.68 USDC per 100 ms',
    sentence:
      'Slope of P&L between 0 ms and 200 ms. Beyond 200 ms the strategy stops being the same strategy — most quotes never fill — so the fit stops there.',
    fromIndex: 0,
    toIndex: 3,
    slopeLabel: '-85.68 USDC per 100 ms',
  },
  empty: null,
}

export const emptyRun: RunRecord = {
  id: 'run-empty',
  headerLine:
    'SOL/USDC · Manifest · Imbalance momentum · 2026-08-26 10:00 → 13:00 UTC · 3 h · 20,304 updates',
  presetName: 'Imbalance momentum',
  periodRange: '2026-08-26 10:00 → 13:00 UTC',
  levels: [],
  cost: null,
  empty: {
    headline: '0 trades — nothing to price',
    sentence: 'The trigger was never reached in this period. P&L is not zero; it is undefined.',
  },
}

export const costLabel = 'Cost of 100 ms'
export const newRunLabel = 'New run'

/* -------------------------------------------------------------- terminal */

export interface BookRow {
  price: string
  size: string
  /** geometry only — never rendered */
  cumulative: number
}

const askSizes = [
  4.2, 7.85, 12.5, 3.1, 18.0, 9.4, 21.25, 6.6, 14.9, 30.0, 8.75, 11.3, 25.0, 5.4, 40.0,
]
const bidSizes = [
  5.1, 9.3, 11.0, 2.75, 16.4, 20.0, 7.2, 13.65, 10.5, 28.0, 6.9, 15.2, 22.0, 4.8, 35.0,
]

const askPrices = [
  '212.45',
  '212.46',
  '212.47',
  '212.48',
  '212.49',
  '212.50',
  '212.51',
  '212.52',
  '212.53',
  '212.54',
  '212.55',
  '212.56',
  '212.57',
  '212.58',
  '212.59',
]
const bidPrices = [
  '212.44',
  '212.43',
  '212.42',
  '212.41',
  '212.40',
  '212.39',
  '212.38',
  '212.37',
  '212.36',
  '212.35',
  '212.34',
  '212.33',
  '212.32',
  '212.31',
  '212.30',
]

const sizeLabels = [
  '4.200',
  '7.850',
  '12.500',
  '3.100',
  '18.000',
  '9.400',
  '21.250',
  '6.600',
  '14.900',
  '30.000',
  '8.750',
  '11.300',
  '25.000',
  '5.400',
  '40.000',
]
const bidSizeLabels = [
  '5.100',
  '9.300',
  '11.000',
  '2.750',
  '16.400',
  '20.000',
  '7.200',
  '13.650',
  '10.500',
  '28.000',
  '6.900',
  '15.200',
  '22.000',
  '4.800',
  '35.000',
]

function withCumulative(prices: string[], labels: string[], sizes: number[]): BookRow[] {
  let acc = 0
  return prices.map((price, i) => {
    acc += sizes[i] ?? 0
    return { price, size: `${labels[i] ?? ''} SOL`, cumulative: acc }
  })
}

export const book = {
  /** top of book first */
  asks: withCumulative(askPrices, sizeLabels, askSizes),
  bids: withCumulative(bidPrices, bidSizeLabels, bidSizes),
  midLabel: '212.445',
  spreadLabel: '0.01 (1 tick)',
  footer: 'Slot 369,412,887 · 15 levels per side',
  staleLine: 'Stale — last update 7.2 s ago',
  staleAge: '7.2 s',
} as const

export interface InstrumentFigure {
  label: string
  value: string
  note: string
  tooltip?: string
}

export const instrument: InstrumentFigure[] = [
  {
    label: 'Lag, Channel B behind A',
    value: 'p50 38 ms · p95 112 ms',
    note: '60 s window, 1,140 updates. B was later on 71%.',
    tooltip:
      'Measured between our two real channels only: for each book update, when Channel B received it minus when the earliest channel received it. Not latency from the chain event, which cannot be measured at this resolution. Not a measurement of any third-party feed.',
  },
  {
    label: 'Age of last update',
    value: '0.4 s',
    note: 'Time since the newest update reached this screen.',
  },
  {
    label: 'Stale after',
    value: '5 s',
    note: 'Past this, the book is marked stale and its age is shown instead of prices.',
  },
]

/* --------------------------------------------------------- demo controls */

export const demoHeading = 'Demo controls'

export const cannotRun = (range: string) =>
  `Cannot run. No recorded updates for ${range}. The run needs the full period; nothing was computed.`
