# Portfolio

Dark theme portfolio tracker with manual cash input.

---

## Features

- **CSV Upload** — import holdings from brokerage exports
- **KPI Grid** — total value, P&L, cash balance, day change
- **Holdings View** — individual position P&L with color coding
- **Charts** — allocation, top positions, PnL breakdown, value vs book

## Cash Balance

The cash balance card previously showed a badge that wrapped to 2 lines on mobile. Fixed by:
- Moving the % into the subtitle text
- Adding a `CashEditor` component for manual cash input
- User can override cached cash value inline

## Design System

| Token | Value | Usage |
|-------|-------|-------|
| `bg-wall-base` | charcoal | page background |
| `bg-wall-surface` | slightly lighter | card surfaces |
| `text-gain` | teal green | positive values |
| `text-loss` | red | negative values |
| `text-white/40` | muted | neutral/zero values |
| `border-white/[0.06]` | subtle | card borders |
| `rounded-card` | 12px | standard card radius |

## Components

- `StatCard` — reusable KPI card with optional action slot
- `KpiGrid` — 4-card grid layout with cash editor
- `HoldingsView` — sortable table of positions
- `ChartPanel` — tabbed chart container
- `UploadView` — drag-and-drop CSV import
