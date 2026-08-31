export const COLS = [
  { key: 'SYMBOL',                 label: 'Symbol',      align: 'left',  type: 'symbol'   },
  { key: 'DESCRIPTION',            label: 'Description', align: 'left',  type: 'desc'     },
  { key: 'QUANTITY',               label: 'Qty',         align: 'right', type: 'number'   },
  { key: 'MARKET PRICE',           label: 'Price',       align: 'right', type: 'currency' },
  { key: 'MARKET VALUE',           label: 'Mkt Value',   align: 'right', type: 'currency' },
  { key: 'BOOK VALUE',             label: 'Book Value',  align: 'right', type: 'currency' },
  { key: 'DAY CHANGE',             label: 'Day Chg',     align: 'right', type: 'pnl'      },
  { key: 'DAY CHANGE %',           label: 'Day %',       align: 'right', type: 'pct'      },
  { key: 'UNREALIZED GAIN/LOSS',   label: 'P&L',         align: 'right', type: 'pnl'      },
  { key: 'UNREALIZED GAIN/LOSS %', label: 'P&L %',       align: 'right', type: 'pct'      },
]

export const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'charts',   label: 'Charts'   },
  { id: 'holdings', label: 'Holdings' },
  { id: 'trade',    label: 'Live Trade' },
  { id: 'upload',   label: 'Upload'   },
]

// Monochrome greyscale ramp for categorical UI charts (account allocation, etc.)
export const CHART_COLORS = ['#fafafa', '#d4d4d8', '#a1a1aa', '#71717a', '#52525b', '#3f3f46']

export const CHART_GRADIENTS = [
  ['#fafafa', '#d4d4d8'],
  ['#d4d4d8', '#a1a1aa'],
  ['#a1a1aa', '#818188'],
  ['#818188', '#52525b'],
  ['#71717a', '#3f3f46'],
  ['#52525b', '#27272a'],
]

export const AUTO_PRICE_REFRESH_MS = 5 * 60 * 1000

export const LIVE_META = {
  idle:    { label: 'Waiting for upload',   dot: 'bg-white/40',             cls: 'border-white/[0.06] bg-wall-surface text-white/60'  },
  loading: { label: 'Refreshing prices',    dot: 'bg-gain animate-pulse',   cls: 'border-gain/20 bg-gain/10 text-gain'                },
  success: { label: 'Prices up to date',    dot: 'bg-gain',                 cls: 'border-gain/20 bg-gain/10 text-gain'                },
  partial: { label: 'Partial refresh',      dot: 'bg-warning',              cls: 'border-warning/20 bg-warning/10 text-warning' },
  error:   { label: 'Live prices unavail.', dot: 'bg-loss',                 cls: 'border-loss/20 bg-loss/10 text-loss'                },
}
