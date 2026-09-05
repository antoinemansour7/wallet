# Charts decision — issue #78

## What the product audit suggests

- [Wealthsimple](https://help.wealthsimple.com/hc/en-ca/articles/37274145854875-Understanding-returns-and-performance-metrics-in-self-directed-accounts) distinguishes simple, realized, and unrealized returns, including currency effects: make the calculation clear.
- [Robinhood Strategies](https://robinhood.com/us/en/support/articles/strategies-charts/) pairs period controls with a benchmark and asset-category drill-down: comparison earns the main panel.
- [Fidelity](https://www.fidelity.com/planning/investment/content/portanalyze.shtml) adds sector, geography, and style exposure: useful only when reliable classifications exist.
- [Schwab](https://www.schwab.com/content/how-to-use-performance-reporting) supports account/portfolio performance and market comparisons: provide a clear scope and benchmark.
- [Sharesight](https://www.sharesight.com/blog/explore-your-portfolio-performance-with-the-contribution-analysis-report/) explains returns through holding-level capital gains, income, and currency: show the dollar drivers we can actually calculate.
- [Empower](https://www.empower.com/tools) emphasizes portfolio mix, performance, and risk across connected accounts: make account placement and cash visible.
- [Delta](https://delta.app/en/features/track/portfolio-insights) separates benchmark, cash-flow, fee, and concentration insights: each panel should answer a distinct question.
- [Ghostfolio](https://github.com/ghostfolio/ghostfolio) combines period performance, multi-account management, and static risk analysis: keep analytics focused and usable on mobile.

## Chosen chart set

1. **Holdings vs. market** — the primary historical percentage comparison, with 1M/3M/6M/1Y controls and S&P 500 or S&P/TSX benchmarks. Adds market context to Overview's balance line. Both series start on the same date and use the selected currency. Explicitly a reconstruction of today's quantities, not the investor's realized return; show missing-price coverage and never substitute an invented series when data fails.
2. **Gains by holding** — diverging dollar bars with open-gains and daily-change views, combining the same security across accounts. Explains the size of each holding's contribution to the reported gain/loss instead of counting winners and losers. Open gains exclude sold holdings, income, and fees; daily values depend on available quotes.
3. **Across your accounts** — repurpose `AccountAllocationChart` as invested-versus-cash balance bars by account. Answers where the balance and cash sit without repeating Overview's holding weights. Keep currencies separate, including an unspecified-currency scope when needed.

## Remove and defer

Remove `AllocationDonut`, `ValueVsBookChart`, `PnlBreakdownChart`, and unused `TopPositionsChart`. Intentionally repurpose `AccountAllocationChart`. Fix shared `ChartPanel` to use theme-aware foreground/border tokens.

Defer sector/geographic/asset-class heatmaps until authoritative classification and fund look-through are available. Defer dividend timelines/forecasts, historical cost basis, and actual time-weighted returns until transaction and income history exists. Avoid another top-holdings/concentration panel duplicating Overview #77.

Use one primary chart above two supporting panels, warm neutral surfaces, semantic gain/loss colors, shared labels and spacing, visible keyboard focus, reduced-motion support, and responsive layouts in both themes.
