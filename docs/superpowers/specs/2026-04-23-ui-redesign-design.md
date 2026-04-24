# UI Redesign — Clean + Institutional (Charcoal + Teal)

## Summary

Full visual redesign of the Wallet app across all pages (Portfolio, Research, Navbar, Login). Pure visual overhaul — no functional changes. Portfolio.jsx is also extracted into focused child components.

**Direction:** Clean + Institutional (Wealthsimple/Fidelity)
**Palette:** Charcoal + Teal — neutral charcoal anchors, teal for positive values, standard red for losses
**Approach:** Reskin + Component Extraction

## Design System — Color Tokens

Defined in `tailwind.config.js` as semantic tokens replacing the current `wall-green` palette:

| Token | Value | Usage |
|---|---|---|
| `brand` | `#1c1c1c` | Primary accent, active tabs, logo |
| `brand-light` | `#f4f4f5` | Hover backgrounds, tab bar bg |
| `surface` | `#fafbfc` | Page background |
| `card` | `#ffffff` | Card/panel backgrounds |
| `border` | `#e4e4e7` | Card borders, dividers |
| `border-subtle` | `#f4f4f5` | Row dividers, light separators |
| `text-primary` | `#18181b` | Headlines, portfolio value |
| `text-secondary` | `#52525b` | Body text, prices |
| `text-muted` | `#a1a1aa` | Labels, descriptions, sub-text |
| `gain` | `#0d9488` | Positive P&L, day change (teal-600) |
| `gain-bg` | `#f0fdfa` | Gain badge/card background |
| `loss` | `#dc2626` | Negative P&L (red-600) |
| `loss-bg` | `#fef2f2` | Loss badge/card background |

Remove all existing `wall-*` color tokens and replace throughout.

## Component Extraction

Break `Portfolio.jsx` (~1,076 lines) into focused components:

```
src/
  components/
    Navbar.jsx              — reskin
    ProtectedRoute.jsx      — no change
  pages/
    Login.jsx               — reskin
    Portfolio.jsx            — slim orchestrator (~120 lines): state, effects, layout
    Research.jsx             — reskin (keeps dark theme, shifted to new token palette)
  pages/portfolio/
    PortfolioHeader.jsx      — header: file name, price timestamp
    TabNav.jsx               — Overview/Charts/Holdings/Upload tab bar
    KpiGrid.jsx              — 5 stat cards row
    LiveBanner.jsx           — price refresh status banner
    StatCard.jsx             — individual KPI card with tone variants
    ChartPanel.jsx           — reusable chart section wrapper (title + meta + children)
    AccountAllocationChart.jsx — allocation bar + account list
    TopPositionsChart.jsx    — top positions bars
    ValueVsBookChart.jsx     — value vs book comparison bars
    PnlBreakdownChart.jsx    — gainers/losers/flat breakdown
    HoldingsView.jsx         — account cards with position rows + cash rows + subtotals
    UploadView.jsx           — drag-and-drop zone + info panels sidebar
    EmptyState.jsx           — no-data CTA with upload button
```

### Rules

- `Portfolio.jsx` keeps ALL state and side effects. Child components are pure presentational — they receive data via props and render UI.
- Helpers (`renderCell`, `pct`, `barWidth`, `getTopPositions`, `getAccountBreakdown`, `getPnlBuckets`) move to `src/pages/portfolio/helpers.js`.
- Constants (`COLS`, `TABS`, `CHART_COLORS`, `CHART_GRADIENTS`, `AUTO_PRICE_REFRESH_MS`, `LIVE_META`) move to `src/pages/portfolio/constants.js`.
- No changes to business logic files: `portfolioStats.js`, `accountPortfolio.js`, `livePrices.js`, `parseSpreadsheet.js`, `portfolioStorage.js`.

## Page-by-Page Visual Changes

### Portfolio Page
- Background: `surface` (#fafbfc)
- Cards: white with `border` (#e4e4e7), subtle shadow, 12px border-radius
- Tab bar: `brand-light` bg, active tab gets `brand` bg + white text
- KPI values: `text-primary` for neutral, `gain` for positive, `loss` for negative
- Stat card top accents: thin top-border gradient replaced with a 2px solid line in the tone color
- Allocation/chart bars: charcoal gradient scale (#1c1c1c → #525252 → #a1a1aa)
- Holdings rows: clean grid, hover with #fafafa, position icon in `brand` bg with white initials
- Upload zone: dashed `border`, `surface` background, no dot-grid pattern
- Remove "Live · 5 min" badge and "Upload file" button from header (per prior request)

### Research Page
- Keeps dark theme but shifts to the new palette: `#0f0f11` background
- Surface cards: `#18181b` with `rgba(255,255,255,0.06)` borders (current pattern, keep)
- Positive values: teal (`#0d9488`) instead of current emerald
- Market snapshot bar, pick cards, news feed: same layout, updated accent colors
- Tag pill colors stay as-is (they work well on dark)

### Navbar
- Background: white with bottom `border`
- Logo/brand text: `text-primary`
- Nav links: `text-muted`, hover `text-primary`
- Active link: `text-primary` with `brand` underline or indicator

### Login Page
- Clean centered card on `surface` background
- Google sign-in button: standard styling
- Minimal branding with `brand` color

## What Does NOT Change

- All state management and side effects in Portfolio.jsx
- All utility/business logic files (portfolioStats, accountPortfolio, livePrices, parseSpreadsheet, portfolioStorage)
- All server-side files (api/, src/server/)
- All test files (update only if imports change due to component extraction)
- Firebase config, routing structure, auth flow
- Data flow, props shape, column definitions
