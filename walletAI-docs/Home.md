# WallAI

A portfolio tracker for Canadian retail investors, with a nightly research engine
attached. Two halves that share a codebase and very little else.

Updated 2026-09-02.

## What lives where

This vault drifted for three months because nothing said what belonged in it.
The rule now:

| | Holds |
|---|---|
| **Code comments** | Why a particular line is the way it is. Closest to the thing it explains, and moves when the code moves. |
| **GitHub Issues** | Work not yet done. The only backlog — see [[Ideas not scheduled]] for why. |
| **This vault** | Decisions and context that outlive both: how a subsystem is meant to work, what was tried and rejected, and why. |

If a note here starts describing *what the code currently does* line by line, it
is in the wrong place and will be wrong within a month.

## The portfolio side

The centre of the app, and where the work has gone since August.

| Note | |
|---|---|
| [[Architecture/Accounts and Imports]] | What an account is, and why a merge is not an overwrite |
| [[Architecture/Currency]] | The two currency fields, and the bug that came from conflating them |
| [[Features/Portfolio]] | The screens and the decisions behind them |
| [[Features/History and Performance]] | Tracking value over time |
| [[Operations/Local Development]] | Preview mode, the Node floor, and why `api/plaid.js` does not run locally |

## The research side

Older, and being kept deliberately separate. It produces daily stock ideas from
X, news and screeners.

```
X Signals (72h)  ──┐
Yahoo RSS News   ──┼──▶  Signal Board  ──▶  Ranking  ──▶  Top Picks
Finviz Screener  ──┘         │                  │
                             │                  ▼
                     Sector ETF Trends     Generated Reports
                     (penalty if down)          │
                                                ▼
                                         Redis ──▶ Research Page + History
```

| Note | |
|---|---|
| [[Architecture/Pipeline Overview]] | End-to-end data flow |
| [[Architecture/Claude Prompt Design]] | How the model is asked to think about picks |
| [[Architecture/Screener Logic]] | Finviz filters and why |
| [[Architecture/Scoring Algorithm]] | Archetype score breakdown |
| [[Features/Research Page]] | UI decisions |
| [[Operations/Nightly Pipeline]] | What runs and when |
| [[Operations/API Credits]] | Quotas |

## Where the product is going

[[Strategy/Where the money is]] — the case for building the Canadian tax and
currency features rather than more stock picking, and the registration
constraint that limits who the research engine can be shown to.

The short version: the measured behaviour gap for ordinary investors is about
**8.5%** a year, against fund fees of 0.05–0.25%. Picking winners is the hardest
way to make someone money and the only part of this app that needs a securities
licence.

## On the research engine's record

The old version of this page reported a 59% win rate over 17 picks as
**Current Performance**, which invited reading it as an established edge. It is
not one: at n=17 the standard error on a coin flip is about 12 points, so 59%
sits inside noise. Separating a real 55% edge from chance takes roughly 600
resolved picks.

Worth continuing to record. Not worth quoting as a result yet, which is why the
figure has been moved into [[Features/History and Performance]] and framed as an
in-progress measurement rather than a headline.

## Design principles that still hold

1. **Signal volume is a clue, not a conclusion.** Chatter is not movement.
2. **Catalyst specificity matters.** "Bullish vibes" is noise; "earnings May 8,
   whisper 20% above" is signal.
3. **Don't fight sector headwinds.**
4. **Prefer early entries.**
5. **Graceful degradation.** If a provider dries up, picks still show.

And one learned since, from the portfolio side:

6. **Never state a number you cannot stand behind.** A stale price shown as
   current, an inferred cash balance, a total mixing two currencies — each of
   these was shipped, and each was worse than showing nothing.
