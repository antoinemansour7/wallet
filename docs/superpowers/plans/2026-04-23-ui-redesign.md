# UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the entire Wallet app with a Clean + Institutional (Charcoal + Teal) visual language and extract Portfolio.jsx into focused child components.

**Architecture:** Replace the current `wall-green` Tailwind palette with semantic Charcoal + Teal tokens. Break Portfolio.jsx (~1,076 lines) into ~15 focused presentational components under `src/pages/portfolio/`. All state/effects stay in the parent orchestrator. No functional changes.

**Tech Stack:** React 18, Tailwind CSS 3, Vite

---

## File Structure

### New files to create
- `src/pages/portfolio/constants.js` — color arrays, tab definitions, column definitions, timing constants
- `src/pages/portfolio/helpers.js` — `renderCell`, `pct`, `barWidth`, `getTopPositions`, `getAccountBreakdown`, `getPnlBuckets`
- `src/pages/portfolio/PortfolioHeader.jsx` — header with file name and price timestamp
- `src/pages/portfolio/TabNav.jsx` — tab bar
- `src/pages/portfolio/StatCard.jsx` — individual KPI card
- `src/pages/portfolio/KpiGrid.jsx` — 5-card row
- `src/pages/portfolio/LiveBanner.jsx` — price refresh status
- `src/pages/portfolio/ChartPanel.jsx` — reusable chart wrapper
- `src/pages/portfolio/AccountAllocationChart.jsx` — allocation bar + account list
- `src/pages/portfolio/TopPositionsChart.jsx` — top positions bars
- `src/pages/portfolio/ValueVsBookChart.jsx` — value vs book comparison
- `src/pages/portfolio/PnlBreakdownChart.jsx` — gainers/losers/flat breakdown
- `src/pages/portfolio/HoldingsView.jsx` — account cards with positions
- `src/pages/portfolio/UploadView.jsx` — drag-and-drop + info panels
- `src/pages/portfolio/EmptyState.jsx` — no-data CTA

### Files to modify
- `tailwind.config.js` — replace `wall-*` tokens with new semantic palette
- `src/index.css` — update body background color, remove dot-grid utility or update it
- `src/pages/Portfolio.jsx` — slim down to orchestrator (~120 lines), import child components
- `src/pages/Research.jsx` — reskin accent colors (teal instead of emerald)
- `src/pages/Login.jsx` — reskin to charcoal + teal palette
- `src/components/Navbar.jsx` — reskin to charcoal + teal palette
- `src/utils/portfolioStats.js` — update `pnlColor` to use new token classes

### Files NOT modified
- `src/context/AuthContext.jsx`, `src/components/ProtectedRoute.jsx`, `src/App.jsx`
- All `src/server/*`, `api/*`, `src/utils/parseSpreadsheet.js`, `src/utils/livePrices.js`, `src/utils/portfolioStorage.js`, `src/utils/accountPortfolio.js`
- All test files (unless imports change)

---

## Task 1: Design System — Tailwind Config + CSS

**Files:**
- Modify: `tailwind.config.js`
- Modify: `src/index.css`
- Modify: `src/utils/portfolioStats.js:30-35`

- [ ] **Step 1: Replace color tokens in tailwind.config.js**

Replace the entire `tailwind.config.js` with:

```js
/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'ui-monospace', 'monospace'],
      },
      colors: {
        brand:          '#1c1c1c',
        'brand-light':  '#f4f4f5',
        surface:        '#fafbfc',
        card:           '#ffffff',
        border:         '#e4e4e7',
        'border-subtle':'#f4f4f5',
        'text-primary': '#18181b',
        'text-secondary':'#52525b',
        'text-muted':   '#a1a1aa',
        gain:           '#0d9488',
        'gain-bg':      '#f0fdfa',
        loss:           '#dc2626',
        'loss-bg':      '#fef2f2',
      },
      boxShadow: {
        'card':       '0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)',
        'card-hover': '0 4px 12px rgba(0,0,0,0.08), 0 1px 3px rgba(0,0,0,0.04)',
      },
      animation: {
        'spin-slow':  'spin 1.5s linear infinite',
        'pulse-slow': 'pulse 3s ease-in-out infinite',
        'fade-in':    'fadeIn 0.25s ease-out',
      },
      keyframes: {
        fadeIn: {
          '0%':   { opacity: '0', transform: 'translateY(4px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [],
}
```

- [ ] **Step 2: Update index.css**

Replace `src/index.css` with:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  html {
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
    scroll-behavior: smooth;
  }

  body {
    background-color: #fafbfc;
    color: #18181b;
    font-family: 'Inter', system-ui, sans-serif;
  }

  ::-webkit-scrollbar        { width: 5px; height: 5px; }
  ::-webkit-scrollbar-track  { background: transparent; }
  ::-webkit-scrollbar-thumb  { background: rgba(0,0,0,0.10); border-radius: 9999px; }
  ::-webkit-scrollbar-thumb:hover { background: rgba(0,0,0,0.20); }
}

@layer utilities {
  .tabular {
    font-variant-numeric: tabular-nums;
    font-feature-settings: 'tnum';
  }

  .glass {
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
  }
}
```

- [ ] **Step 3: Update pnlColor in portfolioStats.js**

In `src/utils/portfolioStats.js`, replace the `pnlColor` function (lines 30-35):

```js
export function pnlColor(val) {
  const n = parseNum(val)
  if (n > 0) return 'text-gain'
  if (n < 0) return 'text-loss'
  return 'text-text-muted'
}
```

- [ ] **Step 4: Verify the app still builds**

Run: `npm run build`
Expected: Build succeeds (pages will look broken since classes reference old tokens — that's fine, we'll fix them in subsequent tasks).

- [ ] **Step 5: Commit**

```bash
git add tailwind.config.js src/index.css src/utils/portfolioStats.js
git commit -m "feat: replace wall-green design system with charcoal + teal tokens"
```

---

## Task 2: Extract Portfolio Constants and Helpers

**Files:**
- Create: `src/pages/portfolio/constants.js`
- Create: `src/pages/portfolio/helpers.js`

- [ ] **Step 1: Create constants.js**

Create `src/pages/portfolio/constants.js`:

```js
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

export const CHART_COLORS = ['#1c1c1c', '#3f3f46', '#52525b', '#71717a', '#a1a1aa', '#d4d4d8']

export const CHART_GRADIENTS = [
  ['#1c1c1c', '#3f3f46'],
  ['#3f3f46', '#52525b'],
  ['#52525b', '#71717a'],
  ['#71717a', '#a1a1aa'],
  ['#a1a1aa', '#d4d4d8'],
  ['#1c1c1c', '#52525b'],
]

export const AUTO_PRICE_REFRESH_MS = 5 * 60 * 1000

export const LIVE_META = {
  idle:    { label: 'Waiting for upload',   dot: 'bg-text-muted',        cls: 'border-border bg-card text-text-secondary'       },
  loading: { label: 'Refreshing prices',    dot: 'bg-gain animate-pulse', cls: 'border-gain/20 bg-gain-bg text-gain'            },
  success: { label: 'Prices up to date',    dot: 'bg-gain',              cls: 'border-gain/20 bg-gain-bg text-gain'             },
  partial: { label: 'Partial refresh',      dot: 'bg-amber-400',         cls: 'border-amber-200 bg-amber-50 text-amber-700'     },
  error:   { label: 'Live prices unavail.', dot: 'bg-loss',              cls: 'border-loss/20 bg-loss-bg text-loss'             },
}
```

- [ ] **Step 2: Create helpers.js**

Create `src/pages/portfolio/helpers.js`:

```js
import { fmtCurrency, fmtPct, fmtNumber, pnlColor, parseNum } from '../../utils/portfolioStats'

export function renderCell(type, val) {
  switch (type) {
    case 'currency': return { text: fmtCurrency(val), cls: 'text-text-secondary' }
    case 'pnl':      return { text: fmtCurrency(val), cls: pnlColor(val) }
    case 'pct':      return { text: fmtPct(val),      cls: pnlColor(val) }
    case 'number':   return { text: fmtNumber(val),   cls: 'text-text-secondary' }
    case 'symbol':   return { text: val ?? '—',       cls: 'text-text-primary font-bold' }
    case 'desc':     return { text: val ?? '—',       cls: 'text-text-muted' }
    default:         return { text: val ?? '—',       cls: 'text-text-secondary' }
  }
}

export function pct(value, total) {
  if (total <= 0) return 0
  return Math.max(0, Math.min(100, (value / total) * 100))
}

export function barWidth(value, max) {
  if (value <= 0 || max <= 0) return '0%'
  return `${Math.max(4, pct(value, max))}%`
}

export function getTopPositions(rows, limit = 6) {
  return rows
    .map((row, index) => ({
      index,
      symbol:      row.SYMBOL || 'Unknown',
      description: row.DESCRIPTION || '',
      value:       parseNum(row['MARKET VALUE']),
      pnl:         parseNum(row['UNREALIZED GAIN/LOSS']),
    }))
    .filter((item) => item.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, limit)
}

export function getAccountBreakdown(accounts) {
  const CHART_COLORS = ['#1c1c1c', '#3f3f46', '#52525b', '#71717a', '#a1a1aa', '#d4d4d8']
  const CHART_GRADIENTS = [
    ['#1c1c1c', '#3f3f46'],
    ['#3f3f46', '#52525b'],
    ['#52525b', '#71717a'],
    ['#71717a', '#a1a1aa'],
    ['#a1a1aa', '#d4d4d8'],
    ['#1c1c1c', '#52525b'],
  ]
  return accounts
    .map((account, index) => ({
      account: account.accountNumber,
      positions: account.positions.length,
      cash: account.cash,
      cashSource: account.cashSource,
      value: account.stats.totalMarketValue,
      color: CHART_COLORS[index % CHART_COLORS.length],
      gradient: CHART_GRADIENTS[index % CHART_GRADIENTS.length],
    }))
    .filter((item) => item.value > 0 || item.cash !== 0)
}

export function getPnlBuckets(rows) {
  const buckets = [
    { id: 'gainers', label: 'Gainers', count: 0, value: 0, gradient: ['#0d9488', '#0f766e'] },
    { id: 'losers',  label: 'Losers',  count: 0, value: 0, gradient: ['#ef4444', '#dc2626'] },
    { id: 'flat',    label: 'Flat',    count: 0, value: 0, gradient: ['#a1a1aa', '#71717a'] },
  ]
  for (const row of rows) {
    const p = parseNum(row['UNREALIZED GAIN/LOSS'])
    if (p > 0)      { buckets[0].count += 1; buckets[0].value += p }
    else if (p < 0) { buckets[1].count += 1; buckets[1].value += Math.abs(p) }
    else            { buckets[2].count += 1 }
  }
  return buckets
}
```

- [ ] **Step 3: Commit**

```bash
git add src/pages/portfolio/constants.js src/pages/portfolio/helpers.js
git commit -m "feat: extract portfolio constants and helpers into separate modules"
```

---

## Task 3: Extract Presentational Components (Part 1 — Small Components)

**Files:**
- Create: `src/pages/portfolio/StatCard.jsx`
- Create: `src/pages/portfolio/ChartPanel.jsx`
- Create: `src/pages/portfolio/LiveBanner.jsx`
- Create: `src/pages/portfolio/EmptyState.jsx`
- Create: `src/pages/portfolio/TabNav.jsx`
- Create: `src/pages/portfolio/PortfolioHeader.jsx`

- [ ] **Step 1: Create StatCard.jsx**

Create `src/pages/portfolio/StatCard.jsx`:

```jsx
import { fmtCurrency } from '../../utils/portfolioStats'

function resolveTone({ tone, pnl }) {
  if (tone) return tone
  if (pnl > 0) return 'positive'
  if (pnl < 0) return 'negative'
  return 'neutral'
}

function cardToneClasses(tone) {
  switch (tone) {
    case 'positive':
      return {
        borderTop: 'bg-gain',
        value: 'text-gain',
        badge: 'border-gain/20 bg-gain-bg text-gain',
        detail: 'border-gain/20 bg-gain-bg',
        detailText: 'text-gain',
      }
    case 'negative':
      return {
        borderTop: 'bg-loss',
        value: 'text-loss',
        badge: 'border-loss/20 bg-loss-bg text-loss',
        detail: 'border-loss/20 bg-loss-bg',
        detailText: 'text-loss',
      }
    case 'accent':
      return {
        borderTop: 'bg-brand',
        value: 'text-brand',
        badge: 'border-border bg-brand-light text-text-secondary',
        detail: 'border-border bg-brand-light',
        detailText: 'text-text-primary',
      }
    default:
      return {
        borderTop: 'bg-border',
        value: 'text-text-primary',
        badge: 'border-border bg-brand-light text-text-muted',
        detail: 'border-border bg-brand-light',
        detailText: 'text-text-secondary',
      }
  }
}

export default function StatCard({ label, value, sub, pnl = 0, tone, badge, breakdown = [] }) {
  const resolvedTone = resolveTone({ tone, pnl })
  const classes      = cardToneClasses(resolvedTone)

  return (
    <div className="relative overflow-hidden rounded-xl border border-border bg-card p-5 shadow-card transition-all duration-200 hover:shadow-card-hover">
      <div className={`absolute inset-x-0 top-0 h-0.5 ${classes.borderTop}`} />
      <div className="mb-3 flex items-start justify-between gap-3">
        <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-text-muted">{label}</p>
        {badge && (
          <span className={`rounded-full border px-2.5 py-1 font-mono text-[10px] font-semibold tabular ${classes.badge}`}>
            {badge}
          </span>
        )}
      </div>
      <p className={`font-mono text-[26px] font-bold tabular leading-none tracking-tight ${value ? classes.value : 'text-text-muted'}`}>
        {value ?? '—'}
      </p>
      {sub && (
        <p className="mt-2.5 text-xs leading-relaxed text-text-muted">
          {sub}
        </p>
      )}
      {breakdown.length > 0 && (
        <div className="mt-4 grid grid-cols-2 gap-2">
          {breakdown.map((item) => {
            const itemTone = resolveTone({ tone: item.tone, pnl: item.pnl ?? 0 })
            const itemClasses = cardToneClasses(itemTone)
            return (
              <div key={item.label} className={`rounded-lg border px-3 py-2 ${itemClasses.detail}`}>
                <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-text-muted">{item.label}</span>
                <p className={`mt-1 font-mono text-xs font-semibold tabular ${itemClasses.detailText}`}>{item.value}</p>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Create ChartPanel.jsx**

Create `src/pages/portfolio/ChartPanel.jsx`:

```jsx
export default function ChartPanel({ title, meta, children, large = false }) {
  return (
    <section className={`rounded-xl border border-border bg-card p-5 shadow-card ${large ? 'min-h-[380px]' : ''}`}>
      <div className="mb-5 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-text-primary">{title}</h2>
        {meta && (
          <span className="rounded-full border border-border bg-brand-light px-2.5 py-0.5 font-mono text-[10px] tabular text-text-muted">
            {meta}
          </span>
        )}
      </div>
      {children}
    </section>
  )
}
```

- [ ] **Step 3: Create LiveBanner.jsx**

Create `src/pages/portfolio/LiveBanner.jsx`:

```jsx
import { LIVE_META } from './constants'

export default function LiveBanner({ liveStatus, liveMessage, lastUpdatedAt }) {
  if (liveStatus === 'idle' && !liveMessage) return null
  const meta = LIVE_META[liveStatus] ?? LIVE_META.idle
  return (
    <div className={`mb-5 flex items-start gap-3 rounded-xl border px-4 py-3 ${meta.cls}`}>
      <span className={`mt-[5px] h-2 w-2 shrink-0 rounded-full ${meta.dot}`} />
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-0.5">
          <p className="text-sm font-semibold">{meta.label}</p>
          {lastUpdatedAt && (
            <span className="font-mono text-xs opacity-60">
              {lastUpdatedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
        </div>
        <p className="mt-0.5 text-xs leading-relaxed opacity-75">
          {liveMessage || 'Quantities and book values come from the uploaded file. Cash uses broker cash rows when present, otherwise upload-to-upload trade deltas.'}
        </p>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Create EmptyState.jsx**

Create `src/pages/portfolio/EmptyState.jsx`:

```jsx
import UploadIcon from './UploadIcon'

export default function EmptyState({ onUploadClick }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-border px-6 py-16 text-center">
      <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl border-2 border-border bg-card">
        <UploadIcon />
      </div>
      <p className="text-base font-semibold text-text-primary">No portfolio loaded</p>
      <p className="mx-auto mt-2 max-w-sm text-xs leading-relaxed text-text-muted">
        Upload a CSV, Excel, or PDF from any broker to populate the dashboard.
      </p>
      <button
        type="button"
        onClick={onUploadClick}
        className="mt-5 rounded-full border border-brand bg-brand px-5 py-2 text-sm font-semibold text-white shadow-sm transition-all hover:bg-zinc-800"
      >
        Upload a file
      </button>
    </div>
  )
}

export function EmptyChart() {
  return (
    <div className="flex h-40 items-center justify-center rounded-xl border-2 border-dashed border-border-subtle">
      <p className="text-sm text-text-muted">No data available</p>
    </div>
  )
}
```

- [ ] **Step 5: Create UploadIcon.jsx (shared tiny component)**

Create `src/pages/portfolio/UploadIcon.jsx`:

```jsx
export default function UploadIcon({ active = false }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={active ? 'text-brand' : 'text-text-muted'}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  )
}
```

- [ ] **Step 6: Create TabNav.jsx**

Create `src/pages/portfolio/TabNav.jsx`:

```jsx
import { TABS } from './constants'

export default function TabNav({ activeView, hasData, onChange }) {
  return (
    <div className="mb-7 flex gap-1 rounded-xl border border-border bg-brand-light p-1 shadow-sm">
      {TABS.map((tab) => {
        const disabled = !hasData && tab.id !== 'upload'
        const isActive = activeView === tab.id
        return (
          <button
            key={tab.id}
            type="button"
            disabled={disabled}
            onClick={() => onChange(tab.id)}
            className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-150 ${
              isActive
                ? 'bg-brand text-white shadow-sm'
                : 'text-text-muted hover:bg-black/[0.04] hover:text-text-primary'
            } ${disabled ? 'cursor-not-allowed opacity-30 hover:bg-transparent hover:text-text-muted' : ''}`}
          >
            {tab.label}
          </button>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 7: Create PortfolioHeader.jsx**

Create `src/pages/portfolio/PortfolioHeader.jsx`:

```jsx
export default function PortfolioHeader({ fileName, hasData, lastUpdatedAt }) {
  return (
    <header className="mb-8 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
      <div>
        <p className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.2em] text-text-muted">Dashboard</p>
        <h1 className="text-[28px] font-bold tracking-tight text-text-primary">Portfolio</h1>
        <p className="mt-1.5 text-sm text-text-muted">AI-parsed holdings · live market prices</p>
        {hasData && (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 text-text-secondary">
              <span className="h-1.5 w-1.5 rounded-full bg-brand" />
              {fileName}
            </span>
            {lastUpdatedAt && (
              <span className="rounded-full border border-border bg-brand-light px-3 py-1 font-mono text-text-muted">
                Prices at {lastUpdatedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
          </div>
        )}
      </div>
    </header>
  )
}
```

- [ ] **Step 8: Commit**

```bash
git add src/pages/portfolio/
git commit -m "feat: extract small presentational components from Portfolio"
```

---

## Task 4: Extract Chart Components

**Files:**
- Create: `src/pages/portfolio/AccountAllocationChart.jsx`
- Create: `src/pages/portfolio/TopPositionsChart.jsx`
- Create: `src/pages/portfolio/ValueVsBookChart.jsx`
- Create: `src/pages/portfolio/PnlBreakdownChart.jsx`

- [ ] **Step 1: Create AccountAllocationChart.jsx**

Create `src/pages/portfolio/AccountAllocationChart.jsx`:

```jsx
import { fmtCurrency } from '../../utils/portfolioStats'
import ChartPanel from './ChartPanel'
import { EmptyChart } from './EmptyState'
import { pct, getAccountBreakdown } from './helpers'

export default function AccountAllocationChart({ accounts, large = false }) {
  const items = getAccountBreakdown(accounts)
  const total = items.reduce((s, i) => s + i.value, 0)

  return (
    <ChartPanel title="Allocation by Account" meta={fmtCurrency(total)} large={large}>
      {items.length === 0 ? <EmptyChart /> : (
        <>
          <div className="mb-5 flex h-2.5 overflow-hidden rounded-full bg-brand-light">
            {items.map((item) => (
              <div
                key={item.account}
                style={{ width: `${pct(item.value, total)}%`, background: `linear-gradient(90deg, ${item.gradient[0]}, ${item.gradient[1]})` }}
                className="h-full transition-all duration-700"
                title={`Account ${item.account}: ${fmtCurrency(item.value)}`}
              />
            ))}
          </div>
          <div className="space-y-3.5">
            {items.map((item) => (
              <div key={item.account} className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2.5">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: item.color }} />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-text-secondary">Account {item.account}</p>
                    <p className="text-[11px] text-text-muted">
                      {item.positions} positions
                      {item.cash !== 0 ? ` · ${fmtCurrency(item.cash)} ${item.cashSource === 'explicit' ? 'cash' : 'inferred cash'}` : ''}
                    </p>
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <p className="font-mono text-sm tabular font-semibold text-text-primary">{fmtCurrency(item.value)}</p>
                  <p className="font-mono text-[11px] tabular text-text-muted">{pct(item.value, total).toFixed(1)}%</p>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </ChartPanel>
  )
}
```

- [ ] **Step 2: Create TopPositionsChart.jsx**

Create `src/pages/portfolio/TopPositionsChart.jsx`:

```jsx
import { fmtCurrency, parseNum } from '../../utils/portfolioStats'
import ChartPanel from './ChartPanel'
import { EmptyChart } from './EmptyState'
import { pct, barWidth, getTopPositions } from './helpers'
import { CHART_GRADIENTS } from './constants'

export default function TopPositionsChart({ rows, large = false }) {
  const items = getTopPositions(rows, large ? 10 : 6)
  const max   = Math.max(...items.map((i) => i.value), 0)
  const total = rows.reduce((s, r) => s + parseNum(r['MARKET VALUE']), 0)

  return (
    <ChartPanel title="Top Positions" meta={`${items.length} shown`} large={large}>
      {items.length === 0 ? <EmptyChart /> : (
        <div className="space-y-4">
          {items.map((item, index) => {
            const [c0, c1] = CHART_GRADIENTS[index % CHART_GRADIENTS.length]
            const isPositive = item.pnl >= 0
            return (
              <div key={`${item.symbol}-${item.index}`}>
                <div className="mb-1.5 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-mono text-sm font-bold text-text-primary">{item.symbol}</p>
                    {item.description && <p className="truncate text-[11px] text-text-muted">{item.description}</p>}
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="font-mono text-sm tabular font-semibold text-text-primary">{fmtCurrency(item.value)}</p>
                    <p className={`font-mono text-[11px] tabular ${isPositive ? 'text-gain' : 'text-loss'}`}>{fmtCurrency(item.pnl)}</p>
                  </div>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-brand-light">
                  <div
                    className="h-full rounded-full transition-all duration-700"
                    style={{ width: barWidth(item.value, max), background: `linear-gradient(90deg, ${c0}90, ${c1})` }}
                  />
                </div>
                <p className="mt-1 font-mono text-[10px] tabular text-text-muted">{pct(item.value, total).toFixed(1)}% of portfolio</p>
              </div>
            )
          })}
        </div>
      )}
    </ChartPanel>
  )
}
```

- [ ] **Step 3: Create ValueVsBookChart.jsx**

Create `src/pages/portfolio/ValueVsBookChart.jsx`:

```jsx
import { fmtCurrency } from '../../utils/portfolioStats'
import ChartPanel from './ChartPanel'
import { barWidth } from './helpers'

function GradientBar({ label, value, max, from, to }) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm text-text-muted">{label}</span>
        <span className="font-mono text-sm tabular font-semibold text-text-primary">{fmtCurrency(value)}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-brand-light">
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{ width: barWidth(value, max), background: `linear-gradient(90deg, ${from}, ${to})` }}
        />
      </div>
    </div>
  )
}

export default function ValueVsBookChart({ stats }) {
  const max = Math.max(stats.totalMarketValue, stats.totalBookValue, stats.totalCashValue, 1)

  return (
    <ChartPanel title="Value vs Book" meta={fmtCurrency(stats.totalPnl)}>
      <div className="space-y-5">
        <GradientBar label="Portfolio value" value={stats.totalMarketValue} max={max} from="#1c1c1c90" to="#1c1c1c" />
        <GradientBar label="Book value" value={stats.totalBookValue} max={max} from="#a1a1aa90" to="#71717a" />
        <GradientBar label="Cash reserve" value={stats.totalCashValue} max={max} from="#0d948890" to="#0f766e" />
      </div>
      <div className="mt-5 rounded-lg border border-border bg-brand-light px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs font-medium text-text-muted">Total P&L</span>
          <span className={`font-mono text-sm tabular font-bold ${stats.totalPnl >= 0 ? 'text-gain' : 'text-loss'}`}>{fmtCurrency(stats.totalPnl)}</span>
        </div>
      </div>
    </ChartPanel>
  )
}
```

- [ ] **Step 4: Create PnlBreakdownChart.jsx**

Create `src/pages/portfolio/PnlBreakdownChart.jsx`:

```jsx
import { fmtCurrency } from '../../utils/portfolioStats'
import ChartPanel from './ChartPanel'
import { barWidth, getPnlBuckets } from './helpers'

export default function PnlBreakdownChart({ rows }) {
  const buckets = getPnlBuckets(rows)
  const max     = Math.max(...buckets.map((b) => b.value), 1)

  return (
    <ChartPanel title="P&L Breakdown" meta={`${rows.length} positions`}>
      <div className="space-y-4">
        {buckets.map((b) => (
          <div key={b.id}>
            <div className="mb-1.5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: b.gradient[1] }} />
                <span className="text-sm text-text-secondary">{b.label}</span>
              </div>
              <span className="font-mono text-sm tabular font-semibold text-text-primary">
                {b.count} · {fmtCurrency(b.value)}
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-brand-light">
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{
                  width: b.value > 0 ? barWidth(b.value, max) : b.count > 0 ? '8%' : '0%',
                  background: `linear-gradient(90deg, ${b.gradient[0]}90, ${b.gradient[1]})`,
                }}
              />
            </div>
          </div>
        ))}
      </div>
    </ChartPanel>
  )
}
```

- [ ] **Step 5: Commit**

```bash
git add src/pages/portfolio/
git commit -m "feat: extract chart components with new color tokens"
```

---

## Task 5: Extract HoldingsView and UploadView

**Files:**
- Create: `src/pages/portfolio/HoldingsView.jsx`
- Create: `src/pages/portfolio/UploadView.jsx`

- [ ] **Step 1: Create HoldingsView.jsx**

Create `src/pages/portfolio/HoldingsView.jsx`:

```jsx
import { fmtCurrency, fmtNumber, fmtPct, parseNum } from '../../utils/portfolioStats'
import EmptyState from './EmptyState'

export default function HoldingsView({ rows, accounts, onUploadClick }) {
  if (!accounts.length && !rows.length) return <EmptyState onUploadClick={onUploadClick} />

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-text-primary">Accounts & Positions</h2>
        <span className="rounded-full border border-border bg-card px-3 py-1 font-mono text-xs text-text-muted shadow-sm">
          {accounts.length} accounts · {rows.length} positions
        </span>
      </div>

      {accounts.map((account) => {
        const acct = account.accountNumber
        const acctRows = account.positions
        const acctStats = account.stats
        const cashSourceLabel = account.cashSource === 'explicit' ? 'Cash from file' : account.cashSource === 'inferred' ? 'Inferred cash' : 'Cash'

        return (
          <div key={acct} className="overflow-hidden rounded-xl border border-border bg-card shadow-card">
            {/* Account header */}
            <div className="flex items-center justify-between border-b border-border-subtle bg-brand-light px-4 py-3">
              <div className="flex items-center gap-2.5">
                <span className="h-2 w-2 rounded-full bg-brand" />
                <span className="text-xs font-bold tracking-wide text-text-secondary">Account {acct}</span>
                <span className="rounded-full bg-black/[0.04] px-2 py-0.5 text-[10px] font-medium text-text-muted">
                  {acctRows.length} positions
                </span>
                {account.cash !== 0 && (
                  <span className="rounded-full bg-gain-bg px-2 py-0.5 text-[10px] font-medium text-gain">
                    {cashSourceLabel}
                  </span>
                )}
              </div>
              <div className="text-right">
                <span className="font-mono text-sm font-bold tabular text-text-primary">
                  {fmtCurrency(acctStats.totalMarketValue)}
                </span>
                <p className="font-mono text-[10px] tabular text-text-muted">
                  {fmtCurrency(account.cash)} cash
                </p>
              </div>
            </div>

            {/* Column labels */}
            <div className="grid grid-cols-[1fr_auto_auto_auto_auto] items-center gap-x-4 border-b border-border-subtle px-4 py-2">
              <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-text-muted">Position</span>
              <span className="w-20 text-right text-[10px] font-bold uppercase tracking-[0.1em] text-text-muted">Price · Qty</span>
              <span className="w-28 text-right text-[10px] font-bold uppercase tracking-[0.1em] text-text-muted">Mkt Value</span>
              <span className="w-28 text-right text-[10px] font-bold uppercase tracking-[0.1em] text-text-muted">P&L</span>
              <span className="w-16 text-right text-[10px] font-bold uppercase tracking-[0.1em] text-text-muted">Today</span>
            </div>

            {/* Position rows */}
            <div className="divide-y divide-border-subtle">
              {acctRows.length === 0 && (
                <div className="px-4 py-4 text-sm text-text-muted">
                  No open positions in this account.
                </div>
              )}
              {acctRows.map((row, i) => {
                const isCdrRow = /\bCDR\b/i.test(String(row.DESCRIPTION ?? ''))
                const symbol   = row.SYMBOL ?? '—'
                const pnl      = parseNum(row['UNREALIZED GAIN/LOSS'])
                const pnlPct   = row['UNREALIZED GAIN/LOSS %']
                const dayAmt   = parseNum(row['DAY CHANGE'])
                const dayPct   = row['DAY CHANGE %']
                const price    = parseNum(row['MARKET PRICE'])
                const mktVal   = parseNum(row['MARKET VALUE'])
                const bookVal  = parseNum(row['BOOK VALUE'])
                const qty      = parseNum(row.QUANTITY)
                const gainCls  = pnl > 0 ? 'text-gain' : pnl < 0 ? 'text-loss' : 'text-text-muted'
                const dayCls   = dayAmt > 0 ? 'text-gain' : dayAmt < 0 ? 'text-loss' : 'text-text-muted'

                return (
                  <div
                    key={i}
                    className="grid grid-cols-[1fr_auto_auto_auto_auto] items-center gap-x-4 px-4 py-3.5 transition-colors hover:bg-surface"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand text-sm font-bold text-white">
                        {symbol[0]}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono text-sm font-bold text-text-primary">{symbol}</span>
                          {isCdrRow && (
                            <span
                              className="rounded bg-gain-bg px-1 py-px text-[9px] font-bold tracking-wide text-gain"
                              title="Canadian Depositary Receipt"
                            >
                              CDR
                            </span>
                          )}
                        </div>
                        <p className="truncate text-[11px] text-text-muted" title={row.DESCRIPTION ?? ''}>
                          {row.DESCRIPTION ?? '—'}
                        </p>
                      </div>
                    </div>

                    <div className="w-20 text-right">
                      <p className="font-mono text-sm font-semibold tabular text-text-primary">{fmtCurrency(price)}</p>
                      <p className="text-[11px] tabular text-text-muted">{fmtNumber(qty)} units</p>
                    </div>

                    <div className="w-28 text-right">
                      <p className="font-mono text-sm font-bold tabular text-text-primary">{fmtCurrency(mktVal)}</p>
                      <p className="text-[11px] tabular text-text-muted">{fmtCurrency(bookVal)} cost</p>
                    </div>

                    <div className="w-28 text-right">
                      <p className={`font-mono text-sm font-bold tabular ${gainCls}`}>{fmtCurrency(pnl)}</p>
                      <p className={`text-[11px] font-medium ${gainCls}`}>{pnlPct ?? '—'}</p>
                    </div>

                    <div className="w-16 text-right">
                      <p className={`text-xs font-bold ${dayCls}`}>{dayPct ?? '—'}</p>
                      <p className={`font-mono text-[11px] tabular ${dayCls}`}>
                        {dayAmt !== 0 ? fmtCurrency(dayAmt) : ''}
                      </p>
                    </div>
                  </div>
                )
              })}
              {account.cash !== 0 && (
                <div className="grid grid-cols-[1fr_auto_auto_auto_auto] items-center gap-x-4 bg-gain-bg/60 px-4 py-3.5">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gain/10 text-sm font-bold text-gain">
                      $
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-sm font-bold text-text-primary">CASH</span>
                      </div>
                      <p className="truncate text-[11px] text-text-muted">{cashSourceLabel}</p>
                    </div>
                  </div>
                  <div className="w-20 text-right">
                    <p className="font-mono text-sm font-semibold tabular text-text-primary">{account.currency || 'CAD'}</p>
                    <p className="text-[11px] tabular text-text-muted">balance</p>
                  </div>
                  <div className="w-28 text-right">
                    <p className="font-mono text-sm font-bold tabular text-text-primary">{fmtCurrency(account.cash)}</p>
                    <p className="text-[11px] tabular text-text-muted">cash held</p>
                  </div>
                  <div className="w-28 text-right">
                    <p className="font-mono text-sm font-bold tabular text-text-muted">{fmtCurrency(0)}</p>
                    <p className="text-[11px] font-medium text-text-muted">—</p>
                  </div>
                  <div className="w-16 text-right">
                    <p className="text-xs font-bold text-text-muted">—</p>
                    <p className="font-mono text-[11px] tabular text-text-muted" />
                  </div>
                </div>
              )}
            </div>

            {/* Account subtotal */}
            <div className="grid grid-cols-4 gap-4 border-t border-border bg-brand-light px-4 py-3">
              <div>
                <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-text-muted">Book Cost</p>
                <p className="font-mono text-xs font-semibold tabular text-text-secondary">{fmtCurrency(acctStats.totalBookValue)}</p>
              </div>
              <div>
                <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-text-muted">Cash</p>
                <p className="font-mono text-xs font-semibold tabular text-text-secondary">{fmtCurrency(account.cash)}</p>
              </div>
              <div>
                <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-text-muted">Total P&L</p>
                <p className={`font-mono text-xs font-semibold tabular ${acctStats.totalPnl >= 0 ? 'text-gain' : 'text-loss'}`}>
                  {fmtCurrency(acctStats.totalPnl)}&nbsp;
                  <span className="font-normal">({fmtPct(acctStats.totalPnlPct)})</span>
                </p>
              </div>
              <div>
                <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-text-muted">Today</p>
                <p className={`font-mono text-xs font-semibold tabular ${acctStats.totalDayChange >= 0 ? 'text-gain' : 'text-loss'}`}>
                  {fmtCurrency(acctStats.totalDayChange)}
                </p>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 2: Create UploadView.jsx**

Create `src/pages/portfolio/UploadView.jsx`:

```jsx
import UploadIcon from './UploadIcon'

function InfoPanel({ title, icon, children }) {
  return (
    <section className="rounded-xl border border-border bg-card p-4 shadow-card">
      <h2 className="mb-3 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-text-muted">
        <span>{icon}</span>{title}
      </h2>
      {children}
    </section>
  )
}

export default function UploadView({ error, fileName, hasData, inputRef, isDragging, loading, loadingMsg, rows, onDragLeave, onDragOver, onDrop, onFile }) {
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div>
        <div
          className={`relative cursor-pointer rounded-2xl border-2 border-dashed p-14 text-center transition-all duration-200 ${
            isDragging
              ? 'scale-[1.005] border-brand/40 bg-brand-light'
              : loading
              ? 'border-border bg-card'
              : 'border-border bg-surface hover:border-brand/30 hover:bg-brand-light/60'
          }`}
          onClick={() => inputRef.current?.click()}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
        >
          <input ref={inputRef} type="file" accept=".csv,.xlsx,.xls,.pdf" className="hidden" onChange={(e) => onFile(e.target.files[0])} />

          {loading ? (
            <div className="flex flex-col items-center gap-4">
              <div className="relative h-12 w-12">
                <div className="absolute inset-0 rounded-full border-2 border-border" />
                <div className="absolute inset-0 rounded-full border-2 border-brand border-t-transparent animate-spin" />
              </div>
              <div>
                <p className="text-sm font-semibold text-text-secondary">{loadingMsg}</p>
                <p className="mt-1 text-xs text-text-muted">This may take a few seconds</p>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-4">
              <div className={`flex h-14 w-14 items-center justify-center rounded-2xl border-2 transition-all duration-200 ${isDragging ? 'border-brand bg-brand-light' : 'border-border bg-card'}`}>
                <UploadIcon active={isDragging} />
              </div>
              <div>
                <p className="text-base font-semibold text-text-secondary">{isDragging ? 'Drop to import' : 'Drop your portfolio here'}</p>
                <p className="mt-1.5 text-xs text-text-muted">CSV · XLSX · XLS · PDF</p>
                <p className="mt-3 text-xs text-text-muted">
                  or <span className="cursor-pointer text-brand underline underline-offset-2 hover:text-zinc-700">browse files</span>
                </p>
              </div>
            </div>
          )}
        </div>

        {error && (
          <div className="mt-4 flex items-start gap-3 rounded-xl border border-loss/20 bg-loss-bg px-4 py-3">
            <svg className="mt-0.5 h-4 w-4 shrink-0 text-loss" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><circle cx="12" cy="16" r="0.5" fill="currentColor" />
            </svg>
            <p className="text-sm text-loss">{error}</p>
          </div>
        )}
      </div>

      <aside className="space-y-3">
        <InfoPanel title="Current File" icon="📄">
          {hasData ? (
            <>
              <p className="truncate text-sm font-semibold text-text-secondary" title={fileName}>{fileName}</p>
              <p className="mt-0.5 text-xs text-text-muted">{rows.length} positions</p>
            </>
          ) : (
            <p className="text-sm text-text-muted">No file loaded</p>
          )}
        </InfoPanel>
        <InfoPanel title="AI Parsing" icon="✦">
          <p className="text-xs leading-relaxed text-text-muted">
            Works with any broker — Questrade, TD, CIBC, Wealthsimple, and more. The AI maps your headers automatically.
          </p>
        </InfoPanel>
        <InfoPanel title="Live Prices" icon="⚡">
          <p className="text-xs leading-relaxed text-text-muted">
            US stocks refresh from Polygon/Massive when configured; Canadian CDRs and fallback quotes use Yahoo Finance.
          </p>
        </InfoPanel>
      </aside>
    </div>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add src/pages/portfolio/HoldingsView.jsx src/pages/portfolio/UploadView.jsx
git commit -m "feat: extract HoldingsView and UploadView components"
```

---

## Task 6: Rewrite Portfolio.jsx as Slim Orchestrator

**Files:**
- Modify: `src/pages/Portfolio.jsx`
- Create: `src/pages/portfolio/KpiGrid.jsx`

- [ ] **Step 1: Create KpiGrid.jsx**

Create `src/pages/portfolio/KpiGrid.jsx`:

```jsx
import { fmtCurrency, fmtPct } from '../../utils/portfolioStats'
import StatCard from './StatCard'

export default function KpiGrid({ rows, stats, accounts }) {
  const accountsWithCash = accounts.filter((account) => account.cash !== 0).length
  const cashShare = stats.totalMarketValue > 0 ? (stats.totalCashValue / stats.totalMarketValue) * 100 : 0
  return (
    <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
      <StatCard label="Total Value" value={fmtCurrency(stats.totalMarketValue)} sub={`${rows.length} positions`} />
      <StatCard
        label="Cash Balance"
        value={fmtCurrency(stats.totalCashValue)}
        sub={accountsWithCash > 0 ? 'Cash on hand across your tracked accounts' : 'No cash balance is currently tracked'}
        tone={stats.totalCashValue !== 0 ? 'accent' : 'neutral'}
        badge={`${cashShare.toFixed(1)}% of value`}
      />
      <StatCard
        label="All-time P&L"
        value={fmtCurrency(stats.totalPnl)}
        sub="Combined closed-trade gains and open-position performance"
        pnl={stats.totalPnl}
        badge={fmtPct(stats.totalPnlPct)}
      />
      <StatCard label="Today's Change" value={fmtCurrency(stats.totalDayChange)} sub="Move since the prior close" badge={fmtPct(stats.dayChangePct)} pnl={stats.totalDayChange} />
      <StatCard label="Accounts" value={String(accounts.length)} sub={`${rows.length} positions total`} />
    </div>
  )
}
```

- [ ] **Step 2: Rewrite Portfolio.jsx**

Replace the entire `src/pages/Portfolio.jsx` with:

```jsx
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { parseSpreadsheet } from '../utils/parseSpreadsheet'
import { enrichRowsWithLivePrices } from '../utils/livePrices'
import { loadLocalPortfolio, loadSavedPortfolioWithTimeout, savePortfolio } from '../utils/portfolioStorage'
import { useAuth } from '../context/AuthContext'
import { buildAccountPortfolio, getAccountEntries, hasAccountPortfolio } from '../utils/accountPortfolio'
import { computeStats } from '../utils/portfolioStats'
import { AUTO_PRICE_REFRESH_MS } from './portfolio/constants'
import PortfolioHeader from './portfolio/PortfolioHeader'
import TabNav from './portfolio/TabNav'
import KpiGrid from './portfolio/KpiGrid'
import LiveBanner from './portfolio/LiveBanner'
import AccountAllocationChart from './portfolio/AccountAllocationChart'
import TopPositionsChart from './portfolio/TopPositionsChart'
import ValueVsBookChart from './portfolio/ValueVsBookChart'
import PnlBreakdownChart from './portfolio/PnlBreakdownChart'
import HoldingsView from './portfolio/HoldingsView'
import UploadView from './portfolio/UploadView'
import EmptyState from './portfolio/EmptyState'

export default function Portfolio() {
  const [rows, setRows]                   = useState([])
  const [accounts, setAccounts]           = useState({})
  const [fileName, setFileName]           = useState('')
  const [error, setError]                 = useState('')
  const [loading, setLoading]             = useState(false)
  const [loadingMsg, setLoadingMsg]       = useState('')
  const [isDragging, setIsDragging]       = useState(false)
  const [activeView, setActiveView]       = useState('upload')
  const [liveStatus, setLiveStatus]       = useState('idle')
  const [liveMessage, setLiveMessage]     = useState('')
  const [lastUpdatedAt, setLastUpdatedAt] = useState(null)
  const inputRef = useRef(null)

  const { user } = useAuth()
  const uid = user?.uid

  const accountEntries = useMemo(() => (
    getAccountEntries(accounts).map((account) => ({
      ...account,
      stats: computeStats(account.positions, { cashValue: account.cash, realizedPnl: account.realizedPnl }),
    }))
  ), [accounts])
  const totalCashValue = useMemo(() => accountEntries.reduce((sum, account) => sum + account.cash, 0), [accountEntries])
  const totalRealizedPnl = useMemo(() => accountEntries.reduce((sum, account) => sum + account.realizedPnl, 0), [accountEntries])
  const hasData     = rows.length > 0 || hasAccountPortfolio(accounts)
  const stats       = useMemo(() => (
    hasData
      ? computeStats(rows, { cashValue: totalCashValue, realizedPnl: totalRealizedPnl })
      : null
  ), [hasData, rows, totalCashValue, totalRealizedPnl])
  const visibleView = hasData ? activeView : 'upload'

  const applyPortfolioRows = useCallback((nextRows, {
    previousAccounts = accounts,
    cashEntries = [],
  } = {}) => {
    const nextAccounts = buildAccountPortfolio({
      rows: nextRows,
      previousAccounts,
      cashEntries,
    })
    setRows(nextRows)
    setAccounts(nextAccounts)
    return nextAccounts
  }, [accounts])

  useEffect(() => {
    if (!uid) return
    const local = loadLocalPortfolio(uid)
    const applySaved = (saved) => {
      if (!saved) return
      setRows(saved.rows ?? [])
      setAccounts(saved.accounts ?? {})
      setFileName(saved.fileName || '')
      setLastUpdatedAt(saved.lastPriceRefreshAt ? new Date(saved.lastPriceRefreshAt) : null)
      setActiveView('overview')
    }

    if (local) applySaved(local)

    const localUpdatedAt = local?.updatedAt ? new Date(local.updatedAt).getTime() : 0
    const remoteTimeoutMs = local ? 2500 : 10000

    loadSavedPortfolioWithTimeout(uid, remoteTimeoutMs)
      .then((saved) => {
        if (!saved) return
        const remoteUpdatedAt = saved.updatedAt ? new Date(saved.updatedAt).getTime() : 0
        if (!local || remoteUpdatedAt >= localUpdatedAt) applySaved(saved)
      })
      .catch(() => {})
  }, [uid])

  useEffect(() => {
    if (!uid || !fileName || !hasData) return
    const timer = setTimeout(() => {
      savePortfolio(uid, {
        fileName,
        rows,
        accounts,
        lastPriceRefreshAt: lastUpdatedAt,
      }).catch(() => {})
    }, 1000)
    return () => clearTimeout(timer)
  }, [accounts, fileName, hasData, lastUpdatedAt, rows, uid])

  const refreshRowsWithLivePrices = useCallback(async (sourceRows, options = {}) => {
    if (!sourceRows.length) {
      applyPortfolioRows(sourceRows, options)
      setLiveStatus('idle')
      setLiveMessage('')
      return sourceRows
    }
    setLiveStatus('loading')
    setLiveMessage('Refreshing current prices from market data providers…')
    try {
      const result   = await enrichRowsWithLivePrices(sourceRows)
      const nextRows = result.rows
      applyPortfolioRows(nextRows, options)
      if (result.updatedRows > 0) setLastUpdatedAt(new Date())
      const cache = result.cache
      if (result.updatedRows === 0 && result.errors?.length > 0) {
        setLiveStatus('error'); setLiveMessage(result.errors[0].error)
      } else if (result.updatedRows === 0) {
        setLiveStatus('partial'); setLiveMessage('No market quotes matched the uploaded symbols.')
      } else if (result.missing.length > 0 || result.errors?.length > 0) {
        setLiveStatus('partial')
        setLiveMessage(`${result.updatedRows} positions refreshed; ${result.missing.length} symbols not found by market providers.`)
      } else if (cache?.refreshed === 0 && cache?.hits > 0) {
        setLiveStatus('success'); setLiveMessage(`${result.updatedRows} positions loaded from cache.`)
      } else {
        setLiveStatus('success')
        setLiveMessage(`${result.updatedRows} positions updated · ${cache?.hits ?? 0} from cache.`)
      }
      return nextRows
    } catch (err) {
      applyPortfolioRows(sourceRows, options)
      setLiveStatus('error'); setLiveMessage(`Price refresh failed: ${err.message}`)
      return sourceRows
    }
  }, [applyPortfolioRows])

  useEffect(() => {
    if (!rows.length) return undefined
    const id = window.setInterval(() => {
      if (liveStatus !== 'loading') refreshRowsWithLivePrices(rows, { previousAccounts: accounts })
    }, AUTO_PRICE_REFRESH_MS)
    return () => window.clearInterval(id)
  }, [accounts, rows, liveStatus, refreshRowsWithLivePrices])

  const handleFile = async (file) => {
    if (!file) return
    setError('')
    setLoading(true)
    setLoadingMsg('Analyzing with AI…')
    try {
      const parsed     = await parseSpreadsheet(file)
      const parsedRows = parsed.rows ?? []
      const cashEntries = parsed.cashEntries ?? []
      const nextAccounts = applyPortfolioRows(parsedRows, {
        previousAccounts: accounts,
        cashEntries,
      })
      setFileName(file.name)
      setActiveView(parsedRows.length > 0 || cashEntries.length > 0 ? 'overview' : 'upload')
      if (parsedRows.length > 0) {
        setLoadingMsg('Fetching live prices…')
        await refreshRowsWithLivePrices(parsedRows, {
          previousAccounts: nextAccounts,
          cashEntries,
        })
      } else if (cashEntries.length > 0) {
        setLiveStatus('success')
        setLiveMessage('Cash balances imported from the uploaded file.')
      } else {
        setLiveStatus('idle')
        setLiveMessage('No positions found in the uploaded file.')
      }
    } catch (err) {
      setError(err.message); setLiveStatus('idle'); setLiveMessage('')
    } finally {
      setLoading(false); setLoadingMsg('')
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  const onDrop = (e) => { e.preventDefault(); setIsDragging(false); handleFile(e.dataTransfer.files[0]) }

  return (
    <div className="min-h-screen bg-surface">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-10">
        <PortfolioHeader fileName={fileName} hasData={hasData} lastUpdatedAt={lastUpdatedAt} />
        <TabNav activeView={visibleView} hasData={hasData} onChange={setActiveView} />

        {visibleView === 'overview' && stats && (
          <>
            <LiveBanner liveStatus={liveStatus} liveMessage={liveMessage} lastUpdatedAt={lastUpdatedAt} />
            <KpiGrid rows={rows} stats={stats} accounts={accountEntries} />
            <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
              <AccountAllocationChart accounts={accountEntries} />
              <ValueVsBookChart stats={stats} />
            </div>
            <div className="mt-4 grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
              <TopPositionsChart rows={rows} />
              <PnlBreakdownChart rows={rows} />
            </div>
          </>
        )}
        {visibleView === 'overview' && !stats && <EmptyState onUploadClick={() => setActiveView('upload')} />}

        {visibleView === 'charts' && stats && (
          <>
            <LiveBanner liveStatus={liveStatus} liveMessage={liveMessage} lastUpdatedAt={lastUpdatedAt} />
            <div className="grid gap-4 lg:grid-cols-2">
              <TopPositionsChart rows={rows} large />
              <AccountAllocationChart accounts={accountEntries} large />
              <ValueVsBookChart stats={stats} />
              <PnlBreakdownChart rows={rows} />
            </div>
          </>
        )}
        {visibleView === 'charts' && !stats && <EmptyState onUploadClick={() => setActiveView('upload')} />}

        {visibleView === 'holdings' && (
          <HoldingsView rows={rows} accounts={accountEntries} onUploadClick={() => setActiveView('upload')} />
        )}
        {visibleView === 'upload' && (
          <UploadView
            error={error} fileName={fileName} hasData={hasData} isDragging={isDragging}
            loading={loading} loadingMsg={loadingMsg} rows={rows} inputRef={inputRef}
            onDrop={onDrop}
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
            onDragLeave={() => setIsDragging(false)}
            onFile={handleFile}
          />
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: Build succeeds with no errors.

- [ ] **Step 4: Commit**

```bash
git add src/pages/Portfolio.jsx src/pages/portfolio/KpiGrid.jsx
git commit -m "feat: rewrite Portfolio.jsx as slim orchestrator with extracted components"
```

---

## Task 7: Reskin Navbar

**Files:**
- Modify: `src/components/Navbar.jsx`

- [ ] **Step 1: Replace Navbar.jsx**

Replace the entire `src/components/Navbar.jsx` with:

```jsx
import { NavLink } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function Navbar() {
  const { user, signOut } = useAuth()

  return (
    <nav className="sticky top-0 z-50 h-14 border-b border-border bg-card/90 px-5 glass">
      <div className="flex h-full items-center justify-between">
        <div className="flex items-center gap-5">
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand shadow-sm">
              <LogoIcon />
            </div>
            <span className="text-sm font-bold tracking-tight text-text-primary">WallAI</span>
          </div>

          <div className="h-4 w-px bg-border" />

          <div className="flex items-center gap-0.5">
            <NavItem to="/portfolio" icon={<PortfolioIcon />}>Portfolio</NavItem>
            <NavItem to="/research" icon={<ResearchIcon />}>Research</NavItem>
          </div>
        </div>

        {user && (
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2.5">
              {user.photoURL ? (
                <img
                  src={user.photoURL}
                  alt={user.displayName}
                  className="h-7 w-7 rounded-full ring-1 ring-border"
                />
              ) : (
                <div className="flex h-7 w-7 items-center justify-center rounded-full border border-border bg-brand-light text-xs font-bold text-text-secondary">
                  {user.displayName?.[0] ?? '?'}
                </div>
              )}
              <span className="hidden text-sm text-text-muted sm:block">
                {user.displayName?.split(' ')[0]}
              </span>
            </div>

            <div className="h-4 w-px bg-border" />

            <button
              onClick={signOut}
              className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-text-muted transition-all hover:bg-brand-light hover:text-text-primary"
            >
              Sign out
            </button>
          </div>
        )}
      </div>
    </nav>
  )
}

function NavItem({ to, icon, children }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-all duration-150 ${
          isActive
            ? 'bg-brand text-white'
            : 'text-text-muted hover:bg-brand-light hover:text-text-primary'
        }`
      }
    >
      {icon}
      {children}
    </NavLink>
  )
}

function LogoIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 22 22" fill="none">
      <path d="M2 16L7 9L11 13L15 6L20 10" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function PortfolioIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="7" width="20" height="14" rx="2" />
      <path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" />
    </svg>
  )
}

function ResearchIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" />
      <path d="M21 21l-4.35-4.35" />
    </svg>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/Navbar.jsx
git commit -m "feat: reskin Navbar with charcoal + teal tokens"
```

---

## Task 8: Reskin Login Page

**Files:**
- Modify: `src/pages/Login.jsx`

- [ ] **Step 1: Replace Login.jsx**

Replace the entire `src/pages/Login.jsx` with:

```jsx
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

const BENEFITS = [
  'Saved portfolio reloads instantly on return.',
  'CDR-aware pricing — Canadian listings stay in CAD.',
  'Live FX conversion for USD stocks in CAD accounts.',
  'Prices refreshed every 5 min via Yahoo Finance.',
]

function getSignInErrorMessage(err) {
  switch (err?.code) {
    case 'auth/unauthorized-domain':
      return 'This domain is not allowed in Firebase Auth. Add the Vercel domain to Firebase Authentication authorized domains.'
    case 'auth/invalid-api-key':
    case 'auth/api-key-not-valid':
      return 'Firebase API key is missing or invalid in Vercel environment variables.'
    case 'auth/configuration-not-found':
    case 'auth/operation-not-allowed':
      return 'Google sign-in is not enabled for this Firebase project.'
    case 'auth/popup-blocked':
      return 'The Google sign-in popup was blocked by your browser.'
    case 'auth/popup-closed-by-user':
      return 'The Google sign-in popup was closed before sign-in finished.'
    default:
      return err?.message || 'Could not complete Google sign-in. Please try again.'
  }
}

export default function Login() {
  const { user, signInWithGoogle } = useAuth()
  const navigate = useNavigate()
  const [error, setError]         = useState('')
  const [isSigningIn, setSigningIn] = useState(false)

  useEffect(() => {
    if (user) navigate('/portfolio', { replace: true })
  }, [user, navigate])

  const handleSignIn = async () => {
    setError('')
    setSigningIn(true)
    try {
      await signInWithGoogle()
    } catch (err) {
      console.error('Sign-in failed:', err)
      setError(getSignInErrorMessage(err))
    } finally {
      setSigningIn(false)
    }
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-surface">
      <div className="pointer-events-none absolute -top-32 left-1/3 h-[480px] w-[480px] rounded-full bg-brand/[0.03] blur-[100px]" />
      <div className="pointer-events-none absolute -bottom-20 right-0 h-[400px] w-[400px] rounded-full bg-brand-light/80 blur-[90px]" />

      <div className="relative mx-auto max-w-7xl px-5 py-10 lg:px-10">
        <nav className="mb-14 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand shadow-sm">
              <LogoMark />
            </div>
            <div className="leading-none">
              <p className="text-sm font-bold tracking-tight text-text-primary">WallAI</p>
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-text-muted">Portfolio OS</p>
            </div>
          </div>
          <span className="rounded-full border border-border bg-brand-light px-3 py-1 text-xs font-semibold text-text-secondary">
            Private beta
          </span>
        </nav>

        <div className="grid items-start gap-12 lg:grid-cols-[1fr_400px] lg:gap-16">
          <div className="animate-fade-in">
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-border bg-card px-3.5 py-1.5 text-xs font-semibold text-text-muted shadow-sm">
              <span className="h-1.5 w-1.5 rounded-full bg-brand" />
              Your brokerage spreadsheet, turned into a living dashboard.
            </div>

            <h1 className="mb-5 font-serif text-[clamp(2.8rem,5.5vw,5.2rem)] font-semibold leading-[0.92] tracking-[-0.05em] text-text-primary">
              See what your<br />portfolio is really doing.
            </h1>

            <p className="mb-10 max-w-md text-[1.05rem] leading-relaxed text-text-muted">
              Upload holdings once, sign back in anytime. WallAI maps your broker's columns, fetches live prices, and gives you clean P&L with account-level context.
            </p>
          </div>

          <div className="lg:sticky lg:top-10">
            <div className="relative overflow-hidden rounded-[2rem] border border-border bg-card p-8 shadow-[0_20px_70px_rgba(28,28,28,0.06)]">
              <div className="pointer-events-none absolute right-0 top-0 h-28 w-28 rounded-bl-[2rem] bg-brand-light opacity-70" />

              <div className="relative">
                <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.22em] text-brand">Sign in</p>
                <h2 className="mb-2 text-2xl font-bold tracking-[-0.03em] text-text-primary">
                  Continue to your workspace.
                </h2>
                <p className="mb-7 text-sm leading-relaxed text-text-muted">
                  Your portfolio, saved uploads, and refreshed quote cache are tied to your Google account.
                </p>

                <button
                  type="button"
                  onClick={handleSignIn}
                  disabled={isSigningIn}
                  className="flex w-full items-center justify-center gap-3 rounded-2xl bg-brand px-4 py-[14px] text-sm font-bold text-white shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0"
                >
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white">
                    <GoogleIcon />
                  </span>
                  {isSigningIn ? 'Opening Google…' : 'Continue with Google'}
                </button>

                {error && (
                  <div className="mt-4 rounded-xl border border-loss/20 bg-loss-bg px-4 py-3 text-sm text-loss">
                    {error}
                  </div>
                )}

                <div className="mt-7 space-y-3 border-t border-border pt-6">
                  {BENEFITS.map((b) => (
                    <div key={b} className="flex items-start gap-2.5">
                      <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-gain-bg text-gain">
                        <CheckIcon />
                      </span>
                      <span className="text-sm leading-snug text-text-secondary">{b}</span>
                    </div>
                  ))}
                </div>

                <div className="mt-6 flex items-start gap-2.5 rounded-xl bg-brand-light px-3.5 py-3">
                  <span className="mt-px shrink-0 text-text-muted"><LockIcon /></span>
                  <p className="text-xs leading-relaxed text-text-muted">
                    Authentication via Firebase. API keys and market data providers stay server-side only.
                  </p>
                </div>
              </div>
            </div>

            <p className="mt-4 text-center text-xs leading-relaxed text-text-muted">
              By continuing, you agree to use WallAI for tracking only — not financial advice.
            </p>
          </div>
        </div>
      </div>
    </main>
  )
}

function LogoMark() {
  return (
    <svg width="20" height="20" viewBox="0 0 22 22" fill="none">
      <path d="M2 16L7 9L11 13L15 6L20 10" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M2 19h18" stroke="white" strokeWidth="1.5" strokeLinecap="round" opacity="0.35" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
      <path d="M10 3L4.75 8.25L2 5.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function LockIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  )
}

function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/pages/Login.jsx
git commit -m "feat: reskin Login page with charcoal + teal tokens"
```

---

## Task 9: Reskin Research Page

**Files:**
- Modify: `src/pages/Research.jsx`

- [ ] **Step 1: Update Research.jsx accent colors**

In `src/pages/Research.jsx`, make these replacements (use find-and-replace across the file):

1. Replace `text-emerald-400` with `text-gain` (globally)
2. Replace `bg-emerald-400/10` with `bg-gain/10` (globally)
3. Replace `border-emerald-400/20` with `border-gain/20` (globally)
4. Replace `bg-emerald-400` with `bg-gain` (globally)
5. Replace `bg-emerald-500` with `bg-gain` (globally)
6. Replace `text-red-400` with `text-loss` (in the market snapshot bar — the `isNeg` ternary on line 278)

Leave the `TAG_COLORS` object and everything else untouched — the amber, blue, purple, and orange tag pills work well on the dark surface.

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/pages/Research.jsx
git commit -m "feat: reskin Research page accents to teal"
```

---

## Task 10: Run Tests and Final Verification

**Files:** None (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npm run test:run`
Expected: All tests pass. If any tests reference old class names (like `wall-green`), update the test assertions to match the new tokens.

- [ ] **Step 2: Run the build**

Run: `npm run build`
Expected: Clean build with no errors or warnings.

- [ ] **Step 3: Visual check**

Run: `npm run dev`
Open http://localhost:5173 and verify:
- Login page: charcoal button, teal check icons, no green
- Navbar: charcoal logo + active tabs, clean white background
- Portfolio (with data): teal gains, red losses, charcoal bars, no green anywhere
- Research: teal positive numbers in market bar, dark theme intact

- [ ] **Step 4: Final commit if any test fixes were needed**

```bash
git add -A
git commit -m "fix: update tests for new design token class names"
```
