# Options Step 1: earnings coverage and shadow experiments

Step 1 is the 9:15 premarket shortlist. A replay of its score on 828 mornings (June 2023 to September 2026, the 25-stock watchlist) found a rank correlation with the next three sessions of about zero. Changing it therefore needs live evidence, not another hand-tuned score. This change does two things:

- It gives both steps real earnings coverage.
- It records a set of alternative shortlists every morning, without changing what is published.

## Earnings and news coverage (live)

`src/server/options/eventEvidence.js` runs inside the premarket stage.

**Scheduled earnings** come from Nasdaq's public earnings calendar.
- The stage checks every session from the trading date through the day after the three-session exit.
- These dates are labelled `estimated`: Nasdaq publishes projected dates as well as confirmed ones.
- If a date cannot be fetched, coverage is `partial` or `unavailable`, never an empty "no reports" day.

**Reported earnings** come from Benzinga result headlines, delivered through Alpaca news. A headline counts only if:
- it is tagged with that one company, and
- it starts with the issuer's own name, followed by `Qn … EPS <figure>`.

This rejects:
- a peer's results tagged to a watchlist name (Rivian tagged to AMZN, L3Harris tagged to PLTR)
- guidance ("Sees Q1 EPS")
- previews and preliminary updates

On three years of watchlist headlines, it recognised 282 of 283 result releases, with no false matches among 5,289 single-company analyst headlines.

**News:** the last 21 days of headlines, fetched in five parallel ticker groups. As a single query this is 30 to 46 pages, more than one request budget allows. Only single-company items are kept in the frozen snapshot; they are what the signals use.

**How events are dated:**
- Events carry their New York date and session timing. SEC 8-Ks now do too: one accepted at 8 p.m. ET belongs to that evening, not to the next UTC day.
- An event already public before the entry (a before-open release, or any release visible at the 9:20 freeze) is behind the hold, not inside it.
- An event later today or during the hold still excludes the stock.
- A known event after the exit but before expiry is named on the contract's penalty instead of the generic "coverage unknown" one. The flat penalty stays for contracts that expire beyond the calendar's coverage.

## Live list size

The published shortlist grows from 10 to 15 stocks (`options-premarket-shortlist-v3`). In the replay, ranks 11–15 and 16–25 had the same modeled results, so the extra five lose no demonstrated quality. They give Step 2 more contracts to choose from.

## Shadow experiments (not published)

A separate stage, `mode=shadow`, starts at 9:36 ET, after the live 9:31 scan's deadline.
- It builds every arm below from the same frozen premarket snapshot.
- It scans each stock and direction the arms need once, with the unchanged Step 2 gates and scorer.
- It keeps the best eligible contract per stock and direction.
- The observe job then captures each contract's bid at the close after 0, 1, 3 and 5 sessions. The primary result is ask entry to bid exit at the third close, after fees and slippage.

| Arm | Question it answers | Compared with |
|---|---|---|
| Current score · 10 | Today's rule, re-entered at the shadow time | — |
| Current score · 15 | Does widening to 15 help or hurt? | 10 |
| Current ranks 11–15 | Are the added five worse? | 10 |
| No regime in Step 1 · 15 | Does the market-regime tilt help Step 1? | Current 15 |
| No regime in either step · 15 | …and in Step 2's contract score too? | Current 15 |
| All eligible · calls / puts / both | Controls: what any stock would have done | — |
| Verified earnings + gap up · calls | Post-earnings drift (backtest: promising, not proven) | All calls |
| Verified earnings + gap down · puts | The mirror case (backtest: did not work) | All puts |
| Unusual gap / volume surge / news surge · both | Do bigger-than-usual moves pay for their option premium? | All both |
| Gap + volume + news · both | Equal-weight percentile of the three | All both |
| Gap + volume + news · 60-day trend | Does the one weak trend signal pick the direction? | Movement · both |

The signals are defined against each stock's own history:
- **Gap:** the premarket move divided by the stock's typical overnight gap over the last 20 sessions.
- **Volume:** yesterday's volume against its 20-session average.
- **News:** today's unique company-specific headlines against the daily average of the previous 20 days.

None of the weights was fitted.

**Running time.** On live data the shadow scan priced about 3,200 contracts. That took around 2 minutes of CPU on a laptop, against 10 seconds of provider time. If one function run is not enough, it saves the chains it finished and returns 503, and QStash's retries (two, 30 s apart) continue from that checkpoint until 9:50. A scan still unfinished on its last attempt is frozen as `partial`, and its missing rows count as unavailable, never as losses.

## Reading the Testing tab

- **Unknown and pending are separate from returns.** A missing quote is not a loss.
- **Mean and median are shown together**, with the mean excluding the top five. Rare large winners made the backtest's earnings result look much better than its median.
- **Paired changes use only sessions** where both the arm and its control were fully observed.
- **The +25% rate is at the scheduled exit.** Close-only capture cannot see intraday target hits.
- **Quotes are Alpaca's indicative feed.** It is modified, so returns are research observations, not fills.
- **These comparisons are not independent.** The arms share stocks and overlapping holds, and there are many of them. Nothing is promoted automatically. A change to the live rule should wait for enough sessions and a paired difference that holds up in both halves of the sample.
