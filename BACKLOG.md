# Backlog

Raised 2026-08-31. Each ticket states the current behaviour, why it is a problem,
what "done" means, and where the code lives.

Priority is about sequencing, not importance: **P1** blocks or bothers on every
visit, **P2** is a real improvement, **P3** is worth doing when nearby.

| # | Ticket | Priority | Size |
|---|--------|----------|------|
| 1 | [Quieten the refresh banner and drop the duplicated page title](#1) | P1 | S |
| 2 | [Stock logos still look soft](#2) | P1 | S |
| 3 | [Portfolio page looks dated](#3) | P1 | L |
| 4 | [Sort holdings by value, descending](#4) | P1 | XS |
| 5 | [Remove the Live Trade desk](#5) | P2 | S |
| 6 | [Replace Upload with a real "Add account" flow](#6) | P1 | XL |
| 7 | [Light / dark theme switch](#7) | P2 | L |
| 8 | [Revamp the top bar](#8) | P2 | M |
| 9 | [Research page still reads like a quant wrote it](#9) | P1 | M |
| 10 | [Every stock reports SELL](#10) | P2 | M |

---

<a id="1"></a>
## 1. Quieten the refresh banner and drop the duplicated page title

**P1 · Small**

Two small irritations on the portfolio page, both about noise.

### 1a — The refresh banner reports plumbing

Every visit shows:

> **Partial refresh** · 01:51 PM
> 14 positions refreshed; 0 symbols not found by market providers.

Nothing there needs saying when nothing went wrong. "0 symbols not found" is a
non-event announced as if it were news, and "Partial refresh" reads as a warning
about a run that succeeded. The banner is doing status reporting for the
developer rather than for the person holding the portfolio.

**Done when**

- The normal case is one quiet line: `Prices as of 1:51 PM`. No heading, no
  counts, no colour.
- Counts and the "not found" list appear **only** when something actually
  failed, and then name the symbols so it is actionable.
- The dismiss behaviour already in place keeps working — dismissal is keyed to
  the message so the 5-minute auto-refresh cannot resurrect a dismissed banner.

**Where** — [src/pages/portfolio/LiveBanner.jsx](src/pages/portfolio/LiveBanner.jsx),
message construction in [src/pages/Portfolio.jsx](src/pages/Portfolio.jsx)

### 1b — "Dashboard / Portfolio" is said twice

The five sub-tabs sit directly under a page header that already says the same
thing. The top bar establishes where you are; repeating it below costs vertical
space on every page for no information.

**Done when** the page reads top bar → tabs, with no restated title, or the
header keeps a single line that says something the tabs do not.

**Where** — [src/pages/portfolio/TabNav.jsx](src/pages/portfolio/TabNav.jsx),
[src/pages/portfolio/PortfolioHeader.jsx](src/pages/portfolio/PortfolioHeader.jsx)

---

<a id="2"></a>
## 2. Stock logos still look soft

**P1 · Small**

Logos read as blurry across the app.

A first pass has landed: the component used to request `size × 2` regardless of
screen density, so a 3× phone upscaled a 2× image. It now offers 1x/2x/3x via
`srcSet` and snaps to size buckets so the CDN actually caches them. Verified
serving 192 real pixels for a 64px logo at DPR 3.

They reportedly still look unclear, so the remaining cause is upstream or
presentational, not resolution maths. Candidates, in the order worth checking:

1. **Source quality per symbol.** Parqet may hold a small original for some
   tickers and upscale it server-side. Compare the 512px render of a few symbols
   against the same logos from another provider.
2. **`object-contain` inside a white circle.** Logos with little internal
   padding now sit edge-to-edge; a little inset may read as sharper.
3. **Provider.** Evaluate alternatives — logo.dev, Clearbit, or Finnhub's
   `logo` field — on coverage of Canadian and CDR tickers specifically, which is
   where this app is unusual.

**Done when** a side-by-side of 5–6 held tickers at 24/40/64px on a 2× and a 3×
screen is judged sharp, and whatever was chosen is written down in the component
so the next person does not re-derive it.

**Where** — [src/components/CompanyLogo.jsx](src/components/CompanyLogo.jsx)

---

<a id="3"></a>
## 3. Portfolio page looks dated

**P1 · Large**

The reported example:

> **Value vs Book** −$6,755.86 · Portfolio value $55,294.38 · Book value
> $57,786.55 · Cash reserve $4,972.54 · Total P&L −$6,755.86
>
> **P&L Breakdown** — 14 positions · Gainers 3 · $2,485.76 · Losers 11 ·
> $9,950.47 · Flat 0 · $0.00

The problems are structural rather than cosmetic:

- **Total P&L is printed twice** in the same card, once as the headline and once
  as a row.
- **"Book value" is jargon.** Most brokerages say *cost* or *amount invested*.
- **"Gainers 3 · $2,485.76 / Losers 11 · $9,950.47"** buries the only number
  that matters — that 11 of 14 positions are down — under a layout that gives
  the three buckets equal visual weight.
- **No time dimension anywhere.** Every number is a snapshot with no sense of
  whether things are getting better or worse.

### Research first

Look at how this is actually solved before redesigning: Wealthsimple and
Robinhood (one dominant number, everything else subordinate), Public and Schwab
(position tables that lead with weight and day change), Revolut (compact stat
rows with sparklines). Note specifically what they choose *not* to show.

**Done when**

- One unmistakable headline number, with the comparison stated in words rather
  than implied by a label.
- Nothing appears twice on the same screen.
- Plain language throughout — "amount invested", not "book value".
- The concentration of losses is visible at a glance, not reconstructed from
  three equal-weight tiles.
- Verified rendered at 1440 / 1180 / 390px.

**Where** — [src/pages/Portfolio.jsx](src/pages/Portfolio.jsx),
[src/pages/portfolio/ValueVsBookChart.jsx](src/pages/portfolio/ValueVsBookChart.jsx),
[src/pages/portfolio/PnlBreakdownChart.jsx](src/pages/portfolio/PnlBreakdownChart.jsx),
[src/pages/portfolio/KpiGrid.jsx](src/pages/portfolio/KpiGrid.jsx)

---

<a id="4"></a>
## 4. Sort holdings by value, descending

**P1 · Extra small**

The holdings table does not lead with the largest position. Sorted by market
value descending is what every broker does, because position size is the first
thing anyone looks for.

**Done when** holdings default to market value descending. Consider making the
column headers sortable while in there, but the default is the ticket.

**Where** — [src/pages/portfolio/HoldingsView.jsx](src/pages/portfolio/HoldingsView.jsx)
(`aggregatePositionsBySymbol` in
[src/pages/portfolio/helpers.js](src/pages/portfolio/helpers.js) already returns
an unsorted list)

---

<a id="5"></a>
## 5. Remove the Live Trade desk

**P2 · Small**

Delete the tab and everything only it uses.

**Worth knowing before starting:** this removes work landed on 2026-08-31 that
rebuilt the signal engine around agreement rather than accumulation. If the
intent is "this feature is not worth having", the removal is right. If it is
"the signal is wrong", see [#10](#10) — that is a different fix and this ticket
would throw away a working engine along with the broken presentation.

**Two things this buys**

- Deleting `api/live-quote.js` frees a serverless function slot. The project is
  at **12 of 12** on Vercel Hobby, which is why market conditions had to be
  served from `get-research` rather than its own route.
- `computeSignal` has exactly one caller (`api/live-quote.js`), so the whole
  engine and its 20 tests come out cleanly with nothing left dangling.

**Done when** the tab, its route, `TradeView`, `SignalPanel`, `tradeSignal.js`
and its tests, and `api/live-quote.js` are gone, and nothing references them.

**Where** — [src/pages/portfolio/TradeView.jsx](src/pages/portfolio/TradeView.jsx),
[src/pages/portfolio/SignalPanel.jsx](src/pages/portfolio/SignalPanel.jsx),
[src/server/tradeSignal.js](src/server/tradeSignal.js),
[api/live-quote.js](api/live-quote.js),
[src/pages/portfolio/TabNav.jsx](src/pages/portfolio/TabNav.jsx)

---

<a id="6"></a>
## 6. Replace Upload with a real "Add account" flow

**P1 · Extra large**

Today the only way in is uploading a file, and every upload is treated as a new
world. The mental model should be **accounts**, not files.

The concrete case: *"I have a TFSA with another brokerage and I just want to add
it to my existing TFSA account on WallAI."* There is currently no way to express
that — the app has no notion of an account you are adding **to**.

### Shape

1. **Add account** replaces **Upload** in the tabs.
2. Choose how: **connect a brokerage** (Plaid — `api/plaid.js` and
   `react-plaid-link` are already installed and unused for this) or **upload a
   statement** (the existing CSV/XLSX/PDF path, kept as the fallback for
   brokerages Plaid does not cover, which in Canada is most of them).
3. Then choose where: **create a new account** or **add to an existing one**,
   picking from accounts already held.
4. Merging into an existing account has to state what it will do *before* doing
   it — positions added, positions updated, duplicates detected — and be
   reversible.

### Open questions to settle first

- What identifies "the same account" across two statements from different
  brokerages? Account number is not stable across institutions.
- On merge, do same-ticker positions **sum** (two TFSAs both holding VFV) or
  **replace** (a newer statement for the same account)? These are different
  operations and the UI must not guess.
- Plaid coverage for Canadian brokerages is thin. Decide whether Plaid is the
  headline path or the secondary one before designing the screen around it.

**Done when** a person can add a second statement to an existing account without
losing the first, is told what will change before confirming, and never sees the
word "upload" unless they choose that path.

**Where** — [src/pages/portfolio/UploadView.jsx](src/pages/portfolio/UploadView.jsx),
[api/plaid.js](api/plaid.js),
[src/utils/accountPortfolio.js](src/utils/accountPortfolio.js),
[src/utils/portfolioStorage.js](src/utils/portfolioStorage.js)

---

<a id="7"></a>
## 7. Light / dark theme switch

**P2 · Large**

A toggle in the top bar. The toggle is an hour; the reason this is Large is that
the app has no light theme to switch to.

Colours are currently hard-coded dark throughout — `wall-bg`, `wall-surface`,
`wall-elevated` are fixed hex values in `tailwind.config.js`, and components
express contrast as `text-white/40`, `bg-white/[0.06]` and so on. Every one of
those is invisible on a light ground.

### Order of work

1. Move the palette to CSS custom properties, themed on `:root` and
   `[data-theme="light"]`.
2. Replace `white/NN` opacity utilities with semantic tokens — `text-secondary`,
   `border-subtle`, `surface-raised`. This is the bulk of the work and touches
   nearly every component.
3. Add the toggle, persist the choice, and default to the system preference via
   `prefers-color-scheme`.

**Done when** both themes are legible on every page — portfolio, research,
holdings — with no hard-coded `white/NN` left in components, and the choice
survives a reload.

**Where** — [tailwind.config.js](tailwind.config.js),
[src/index.css](src/index.css),
[src/components/Navbar.jsx](src/components/Navbar.jsx), and broadly across
`src/pages/`

---

<a id="8"></a>
## 8. Revamp the top bar

**P2 · Medium**

The current bar is a plain 64px row of text links with a filled-pill active
state. It works but reads as unfinished, and it is the first thing on every
page.

Worth deciding as part of this: it will host the theme toggle from [#7](#7), and
the account menu already lives there, so do these together rather than touching
the same file twice.

**Done when** the bar reads as deliberate at 1440 and 390px, active state is
unmistakable without shouting, and the mobile bottom tab bar stays consistent
with it.

**Where** — [src/components/Navbar.jsx](src/components/Navbar.jsx)

---

<a id="9"></a>
## 9. Research page still reads like a quant wrote it

**P1 · Medium**

**Partly done.** A pass landed on 2026-08-31 rewriting the market conditions
panel: "Rate stress — 10y 4.76% at 100th pctile, +1.6% in 20d" became "Interest
rates — at a one-year high and still rising, this pulls money out of stocks",
with the raw figure kept quiet underneath and the precise form still going to
the model prompt.

What remains is the rest of the page, which has the same problem:

- **"4 picks from 562 signals across X, screeners, media and news"** — "signals"
  is internal vocabulary.
- **Thesis and bear case** are dense analyst prose: *"squeeze/breakout screener
  hits on extended names are classic setups for sell-the-news reversals"*. These
  come from the model, so fixing them means changing the prompt, not the
  component.
- **"Squeeze"**, **"Catalyst search"**, **"Screener"** as bare chips assume the
  reader knows what those are.
- **"3 independent sources · 3 signals · ai · earnings · macro · squeeze · price
  verified live"** — a string of internal fields shown as a sentence.
- **"Show 2 more below the 6/10 threshold"** — explains our filter, not their
  situation.
- **"What fed this run: 130 Curated accounts / 200 X search / 60 News"** — the
  labels are pipeline stage names.

**Done when** every visible string on the page can be read by someone who does
not trade professionally, without losing precision. The model-authored fields
need prompt changes with a length and reading-level instruction, not
post-processing.

**Where** — [src/pages/Research.jsx](src/pages/Research.jsx),
[src/pages/research/PickCard.jsx](src/pages/research/PickCard.jsx),
[src/pages/research/RegimeGauge.jsx](src/pages/research/RegimeGauge.jsx),
and `TICKER_SYSTEM_PROMPT` in
[src/server/researchEngine.js](src/server/researchEngine.js) for the thesis and
bear-case wording

---

<a id="10"></a>
## 10. Every stock reports SELL

**P2 · Medium** — *added from a report made while the signal work was in
progress; not on the original list.*

Reported: *"All the stocks are having a sell technical read."* The example was
AVGO — **SELL, confidence 51**, while the stock was **up 0.18% on the day**,
with RSI 43.1 described as "neutral" yet listed under "arguing the other way".

Two things look wrong on that screenshot alone:

1. **A "neutral" reading should not appear as a conflict.** RSI 43.1 maps to
   +0.35, which clears the 0.15 conflict threshold, so a reading the panel calls
   neutral gets listed as dissent. The threshold and the wording disagree.
2. **A possible structural bearish tilt.** Trend carries 0.35 weight and is the
   component most likely to be negative in any market that has pulled back, so
   a broad tape drift may be showing up as a SELL on nearly everything.

**Investigate before changing anything** — run `computeSignal` across all 14 held
positions plus a spread of large caps and count the verdict distribution. If
SELL is genuinely near-universal, the neutral band, the trend weight, or the
saturation constant `TREND_FULL` is miscalibrated. If it is 60/40, the engine is
fine and the presentation is overstating it.

**Note:** [#5](#5) deletes this feature entirely. Settle #5 first — if the desk
goes, this ticket goes with it.

**Where** — [src/server/tradeSignal.js](src/server/tradeSignal.js),
[src/pages/portfolio/SignalPanel.jsx](src/pages/portfolio/SignalPanel.jsx)
