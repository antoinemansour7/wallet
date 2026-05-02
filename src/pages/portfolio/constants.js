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
  { id: 'upload',   label: 'Upload'   },
]

export const CHART_COLORS = ['#191c1f', '#494fdf', '#00a87e', '#505a63', '#8d969e', '#c9c9cd']

export const CHART_GRADIENTS = [
  ['#191c1f', '#505a63'],
  ['#494fdf', '#191c1f'],
  ['#00a87e', '#191c1f'],
  ['#505a63', '#8d969e'],
  ['#8d969e', '#c9c9cd'],
  ['#191c1f', '#8d969e'],
]

export const AUTO_PRICE_REFRESH_MS = 5 * 60 * 1000

export const LIVE_META = {
  idle:    { label: 'Waiting for upload',   dot: 'bg-white/40',             cls: 'border-white/[0.06] bg-wall-surface text-white/60'  },
  loading: { label: 'Refreshing prices',    dot: 'bg-gain animate-pulse',   cls: 'border-gain/20 bg-gain/10 text-gain'                },
  success: { label: 'Prices up to date',    dot: 'bg-gain',                 cls: 'border-gain/20 bg-gain/10 text-gain'                },
  partial: { label: 'Partial refresh',      dot: 'bg-amber-400',            cls: 'border-amber-400/20 bg-amber-400/10 text-amber-400' },
  error:   { label: 'Live prices unavail.', dot: 'bg-loss',                 cls: 'border-loss/20 bg-loss/10 text-loss'                },
}
