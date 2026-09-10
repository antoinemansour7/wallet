# Research ranking audit

The research engine is a short-horizon stock discovery and evidence-ranking system. It is not a fitted return predictor. Its scores express evidence strength; neither conviction nor the final score is a probability of profit. The existing target remains 3–5 trading sessions.

## Changes

| Problem | Resulting behavior |
| --- | --- |
| The page sorted again by model conviction, discarding final ranking. | Delivery preserves the server order, including its final and premarket adjustments. |
| Final ranking discarded learned adjustments and changed the earlier score formula. | Final ranking starts from the composite score, then adds event-verification and risk adjustments once. |
| Multiple searches could count the same story repeatedly; query labels looked like independent sources. | Canonical URLs are deduplicated per ticker. Distinct publishers/authors provide corroboration; each contributes at most two posts per ticker. Counts are bounded, including in the model context. Different publishers can still syndicate the same underlying story, so this is an approximation of independence. |
| Fallbacks could restore broken, unverified or context-only candidates. | Those exclusions remain effective even when the result is empty. The page explains a scan with no qualifying ideas. |
| Invalid/null prices and null risk scores could become zeros through numeric coercion. | Only positive usable quotes qualify. Stale cache fallbacks are rejected. Missing risk receives no low-risk bonus. Model output cannot overwrite computed scoring fields. |
| Fixed sector, nominal-price and mega-cap preferences altered the ranking. | No fixed tech quota, no nominal-price reward, and no blacklist of large companies. The existing sub-$5 risk treatment remains. |
| Recent picks were removed before comparison. | An eligible recent pick can remain ahead of weaker new alternatives. |
| Catalyst verification accepted model labels without traceable evidence. | Verification requires an event date and a citation URL present in that ticker's retrieved results. The near-term bonus requires a date between two days ago and seven days ahead, a calendar approximation of the short holding window. This validates provenance, not the factual entailment of every model statement. |
| Technical indicators could use incomplete daily bars or lose legitimate zero values. | Indicators use completed regular sessions; flat prices have RSI 50, continuous losses can have RSI 0, and a price at its high keeps a 0% distance. |
| Discovery stopped before the screener and media search when X/RSS failed. | All discovery channels get an opportunity to contribute before a no-content response. |

## Performance measurement

`researchPerformance.js` defines versioned evaluation rules:

- Enter at the first regular-session open after the actual recommendation timestamp. Premarket recommendations can use that day's open; intraday recommendations use the next session.
- Observe historical closes after exactly 1, 3, 5 and 10 trading sessions. Weekend and holiday dates do not advance the counter. A delayed tracking job backfills each checkpoint's own historical price.
- Exclude incomplete daily sessions. The completion check conservatively waits 6.5 hours after the daily candle timestamp, including on shortened sessions.
- Subtract an explicit assumed 20 basis points of round-trip costs. These are hypothetical fills: actual spreads, slippage, fees and market impact can differ.
- Compare USD stock price returns with SPY over the same entry and exit dates. Non-USD or missing-benchmark results do not enter the learning cohort. These are price-return comparisons, not a dividend-inclusive total-return backtest.
- Learn only from completed five-session results produced by the same model and evaluation version. Legacy mixed-horizon records and shadow candidates remain excluded from ranking feedback.
- Require at least 20 observations across 10 research dates per setup/source. Estimate uncertainty using daily groups, shrink average excess returns toward zero, and bound adjustments. Positive feedback requires both positive net returns and an excess-return uncertainty band above zero. These thresholds are conservative heuristics, not proof of statistical significance or optimal parameters.
- Keep source adjustments smaller than setup adjustments. Final ranking retains both.

The read-only history audit on September 5, 2026 found 321 stored outcome records across 25 dates: 50 delivered-pick records plus shadow candidates. Zero records qualified under the new evaluation version. The existing history therefore cannot validate this model's performance. No production research run, trade, or alert was triggered during this work.

## What is still unproven

The ranking remains a bounded heuristic combining retrieved evidence, model judgment, technical indicators and verified event context. It has not demonstrated out-of-sample excess returns. The bounded discovery universe is influenced by media coverage and screener availability, not an exhaustive comparison of all stocks. Source checks do not eliminate misinformation or syndicated reporting. External provider failures can reduce coverage. The liquidity and execution assumptions are not a calibrated market-impact model.

Before claiming better investment performance, collect forward outcomes under this version and compare a frozen baseline on the same recommendation dates. Evaluate net returns, benchmark excess returns, losses, turnover and portfolio drawdown across multiple market conditions. Do not tune weights on the same observations used to claim success. The current five-session evaluation is a fixed-horizon mark-to-market measurement; it does not simulate execution of the displayed ATR stop/target or a funded portfolio.

The SEC distinguishes actual performance from hypothetical backtested results and explains why performance claims require scrutiny: [Investor Bulletin: Performance Claims](https://www.investor.gov/introduction-investing/general-resources/news-alerts/alerts-bulletins/investor-bulletins-47). This distinction applies to the evaluation described here.

## Validation

Regression coverage includes ranking preservation, duplicate/spam evidence, invalid model output, quote failures, risk-gate abstention, traceable event citations, completed-session timing, weekend/holiday handling, overnight gaps, historical checkpoint backfills, cost/benchmark calculations, small-sample feedback suppression, and idempotent versioned storage. These tests establish software behavior, not future investment returns.

## Review-budget investigation (September 10, 2026)

The production run starting at `2026-09-10T23:04:21.316Z` reported `boardSize: 15`, `accepted: 4`, and `budgetExhausted: 67`. A read-only reconstruction from admission `556faf03c8abd41bec5658b7d02c94651311c4ad678f344ce7b0bf8b053173e1` established:

- The admission pool contained 97 unique eligible securities, all from the attention strategy. None of the 67 excluded securities was admitted from fundamentals, filing changes, or insider evidence in that run.
- Attention filled its 12 reserved slots. Because the other three strategies had no eligible candidates, their 18 unused slots were reallocated to attention. This admitted 30 securities in total and left 67 eligible securities below the cutoff.
- All 67 stable security IDs still resolved through the decision-time security master. The first five excluded identities, in the order retained by the old admission audit, were RGTI (Rigetti Computing), CRWV (CoreWeave), QBTS (D-Wave Quantum), IONQ (IonQ), and LOVE (The Lovesac Company).
- `review_budget_exhausted` described exhaustion of the fixed 30-candidate admission quota, not exhaustion of the Vercel runtime budget.
- The old `boardSize: 15` metric measured a `slice(0, 15)` retained for shadow logging. It proved only that at least 15 attention candidates reached that point; it did not prove that Claude received exactly 15. The prompt itself accepted up to 30.

The old audit retained excluded security IDs in rank order but discarded their ticker, company, exact decision-time priority, evidence IDs, source breakdown, and cutoff gap. Those missing values cannot be reconstructed exactly after the fact because attention evidence from repeated signals is immutable and may carry an earlier archive timestamp. From this change forward, the run log stores those decision-time values directly, separately records the full Claude input and the unchanged top-15 shadow cohort, and presents the ten candidates immediately below every stream cutoff. No budget, rank, horizon, frozen baseline, or shadow-sampling policy changed as part of this investigation.
