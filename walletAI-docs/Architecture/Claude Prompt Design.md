# Claude Prompt Design

How the research engine instructs Claude to think about stock picks.

---

## Philosophy

> Signal volume is a CLUE, not a CONCLUSION.

The old prompt was simple: "pick the most-mentioned stocks." This led to false positives — stocks trending because they're crashing, or one loud account tweeting 5x.

The new prompt forces Claude to evaluate **why** there's volume before acting on it.

## Five Evaluation Dimensions

### 1. Catalyst Quality
Is there a **specific, time-bound event**?

| Good | Bad |
|------|-----|
| "Reports Q2 earnings May 8, whisper numbers 20% above" | "Looks bullish" |
| "FDA PDUFA date June 15" | "Could go up" |
| "NASA contract announcement confirmed for May 12" | "Space sector is hot" |

### 2. Technical Setup
Is the chart **constructive** or extended?

- Tight consolidation + volume building = good
- Already up 50%+ from base = late entry, skip unless exceptional catalyst
- Broken below support, freefall = avoid

### 3. Sector Conditions
Uses live sector ETF data to detect headwinds.

| ETF | Sector |
|-----|--------|
| IGV | Software |
| SMH | Semiconductors |
| XLK | Tech (broad) |
| XBI | Biotech |
| XLE | Energy |
| XLF | Financials |
| BITO | Crypto |
| ITA | Aerospace/Defense |

**Penalty scale:**
- ETF <= -3% → stock gets -3.0 penalty (unless idiosyncratic catalyst)
- ETF <= -1.5% → -1.5
- ETF <= -0.5% → -0.5

### 4. Risk/Reward Asymmetry
Stock at $5 support with $8 target = 60% up / 20% down. That's asymmetry.
Stock already up 40% with no floor = risk, not opportunity.

### 5. Source Independence
- 3 independent traders flagging the same stock = real signal
- 1 account tweeting 5 times = noise
- Checks `sourceCount` vs raw `signalCount`

## Key Rules

- Max 5 picks, sorted by conviction (1-10)
- Reason must be ≤15 words and name the SPECIFIC catalyst
- Only quote-verified, tradable tickers
- ~62.5% tech allocation target
- Extended stocks (50%+ monthly) rejected unless exceptional catalyst
- Broad ETFs (SPY, QQQ) always excluded

## What Changed

| Before | After |
|--------|-------|
| 70/30 weighting (X signals vs news) | 5-dimension framework |
| Signal count = conviction | Signal count is just a starting clue |
| No sector awareness | Live ETF trend penalties |
| No extension filter | 50%+ monthly = reject unless exceptional |
| Generic reasons allowed | Must name specific catalyst |
