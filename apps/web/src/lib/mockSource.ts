/**
 * The terminal (M2, T039) is not wired to the API yet: all its numbers are made up and
 * live here, in one module. The run and result screens already read the API.
 */

export const banner =
  'Prototype screen — every figure below is fictional. No live data is connected to this screen yet.'

export const market = {
  id: 'sol-usdc',
  name: 'SOL/USDC · Manifest',
  tick: '0.01 USDC',
  lot: '0.001 SOL',
} as const

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

export const demoHeading = 'Demo controls'
