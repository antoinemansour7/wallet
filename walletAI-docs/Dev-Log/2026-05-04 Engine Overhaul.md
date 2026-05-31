# May 4, 2026 — Engine Overhaul

Major rewrite of the research engine's decision-making logic.

---

## Problem

The engine was:
1. **Blinded by signal volume** — stocks mentioned many times got picked regardless of quality
2. **Picking extended stocks** — AAOI (up 100%+ monthly) passed the screener and got picked
3. **Ignoring sector headwinds** — TEAM was picked despite SaaS sector being down 26% YTD
4. **Not thinking critically** — Claude just followed mentions without evaluating whether the thesis made sense

## Changes Made

### Claude Prompt Rewrite
Replaced simple "pick most-mentioned" prompt with 5-dimension evaluation framework:
1. Catalyst Quality (specific, time-bound)
2. Technical Setup (constructive vs extended)
3. Sector Conditions (ETF trend context)
4. Risk/Reward (asymmetry assessment)
5. Source Independence (multi-source vs spam)

### Sector ETF Downtrend Penalty
- Added `SECTOR_ETF_MAP` mapping themes → ETFs
- Fetches ETF quotes alongside ticker quotes
- Applies -0.5 to -3.0 penalty based on ETF decline

### Signal Volume Cap
- >4 signals from <=1 source → -2.0 (spam detection)
- >3 signals with no catalyst/squeeze/breakout → -1.5 (noise)

### Screener Tightening
- Added RSI < 70 filter (not overbought)
- Added monthly performance < 50% (not already extended)
- Previously had no cap → AAOI at +100% monthly still passed

### OpenAI Graceful Fallback
- If `OPENAI_API_KEY` missing → returns picks without reports
- If API returns 402/429 → stops calling, returns remaining picks without reports

### Anthropic SDK Fix
- SDK v0.90.0 changed `.create()` to return raw stream by default
- Fixed by using `stream: false` + parsing response as JSON if string

## Results

First run with new logic (May 4, 2026):
- AMD (7/10) — Earnings next week, screener breakout confirmed
- NVO (6/10) — Ozempic pill US launch, core-upside band
- HOOD (5/10) — Strong Q1, pullback into buying zone
- PLTR (5/10) — Earnings Monday, Oppenheimer $200 PT
- AAOI (4/10) — Only 4/10 because extended, filtered out by >=6 on Research page

## Lessons

- Signal volume **should** still be a factor — just not the only one
- 30% monthly cap was too aggressive → changed to 50%
- Claude needs explicit permission to pick extended stocks IF catalyst is exceptional
