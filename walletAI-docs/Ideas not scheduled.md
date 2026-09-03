# Ideas not scheduled

**This is not the backlog.** [GitHub Issues](https://github.com/antoinemansour7/wallet/issues)
is the backlog, and the [project board](https://github.com/users/antoinemansour7/projects/3)
orders it.

This note holds ideas that have been considered and deliberately *not* scheduled.
Keeping them here stops them being re-proposed every few months, and records why
they are waiting.

Renamed from "Ideas & Backlog" on 2026-09-02. It was one of three competing
backlogs — this note, a `BACKLOG.md` at the repo root, and GitHub Issues — all
disagreeing, with no rule for which won. `BACKLOG.md` is gone; its live tickets
were moved to Issues.

---

## Engine

- **Backtest framework** — replay historical signals through the scoring
  algorithm to tune weights. The most valuable item here and the reason the
  others are waiting: without it, every weight change is a guess.
- **Conviction correlation** — do 8+ picks actually beat 6–7 picks? Needs the
  ~600 resolved picks the record does not yet have.
- **Screener vs non-screener comparison** — same blocker.
- **Sentiment scoring on tweets** before the ranking model sees them.
- **Earnings calendar integration** — auto-flag tickers reporting this week.
- **Intraday timing** — run the screener at open and close.
- **More X accounts**, chosen for signal-to-noise.

## Research quality

- **Sector rotation model** — which sectors are entering or leaving favour.
- **Macro overlay** — VIX, DXY and rates as context for the ranking.
- **Extend history retention** — seven days is short for measuring anything.

## Deliberately not doing

- **Position sizing from conviction.** Built, and it is the single thing that
  puts the app over the line into regulated advice. See
  [[Strategy/Where the money is]]. Not a scheduling decision — a legal one.
- **Push notifications on high-conviction picks.** Same reason, more so: an
  unsolicited alert to buy a named security is the clearest possible form of
  the thing that needs a licence.
- **Stop-loss levels.** Same.

## Housekeeping that outgrew this note

These became Issues and should not be tracked here any more: migrating the
deprecated model id, mobile wrapping, and the watchlist.

**Already done, and this note was wrong about it.** "Add alerting — if nightly
run fails, send notification" sat here as an open idea long after it shipped.
`src/server/runLog.js` records every cron run to Redis with its duration and
outcome, keeps the last 90, and posts to Slack on failure — built because Hobby
retains runtime logs for about an hour, so 3 AM output is gone by morning.

That stale line cost real time: it was cited as evidence in issue #33, which
argued the nightly pipeline was failing silently. It was not. This is exactly
the drift the "what lives where" rule in [[Home]] exists to prevent — a note
describing the state of the code, left to rot.
