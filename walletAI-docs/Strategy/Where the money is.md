# Where the money is

Written 2026-09-02. The case for what to build next, and the constraint on who
the research engine can be shown to.

Full write-up, with sources:
https://claude.ai/code/artifact/bb320339-72ce-4f0f-8ff2-e819746ec3c6

Tracked as GitHub epic **#16**.

## The argument

Picking stocks is the hardest way to make a user money, the hardest to prove,
and the only part of this app that needs a securities licence.

Two numbers set the direction:

- **8.5%** — how far the average investor trailed *their own funds* in 2024
  (DALBAR 2026), by selling when frightened. A typical index fund charges
  0.05–0.25% a year, so bad timing costs roughly thirty times what fees do.
- **59% of 17 picks** — the research engine's record. That is a coin flip landing
  heads 10 times out of 17. Roughly 600 resolved picks would be needed before the
  number means anything.

## The gap in the Canadian market

There is a sentence none of the incumbents can say:

> *"This holding is in the wrong account, and it is costing you $X a year."*

**Wealthica** aggregates every institution but has no tax engine — it shows you
the holding, never that the holding is misplaced. **Passiv** rebalances, which is
about *how much* of each thing you own, never which account it sits in.
**Wealthsimple** holds the money but only sees its own accounts. Four standalone
**ACB tools** launched in 2026, and every one asks you to type your portfolio in
by hand.

WallAI has both halves: multi-institution positions with registration type
attached, and currency handled correctly.

## What qualifies as work worth doing here

Three properties, shared by everything in epic #16:

1. **The answer comes from a published rule, not a prediction.** It can be
   unit-tested. A wrong answer is a bug, not bad luck.
2. **The output is a dollar figure the user can check against their statement.**
3. **It is computable from data already stored**, or from one number typed once.

## The features, in order

| | | Worth |
|---|---|---|
| Wrong-account detector (#17) | US-listed funds lose 15% of dividends in a TFSA, 0% in an RRSP | ~$4,000 over 20 years on $50k |
| Currency router (#18) | Norbert's Gambit against a 1.5–2.5% broker spread | ~$675 per $50k conversion |
| Cost base ledger (#19) | Pooled across brokerages — the hard part, already solved here | Filing-grade |
| Behaviour ledger (#20) | Show what selling cost them | Up to 8.5% |
| Fee summary (#21) | Table stakes; Wealthica already does it | — |
| Contribution room (#22) | 1%/month penalty avoided | Trust |

## The constraint

Advising on securities in Canada requires registration. The exemption covers
**general** commentary, not advice aimed at one person's situation. The
position-sizing agent sizes recommendations to *this user's* portfolio, which is
precisely what the exemption does not cover.

Irrelevant while there is one user. It starts mattering the day a second person
signs in. The CSA and CIRO published joint guidance in January 2026, after
reviewing 87 finance influencers, naming this exact drift.

Two clean options: keep the picks private to a single login, or remove the
verdicts, targets and sizes so the page shows evidence and never tells anyone
what to do.

## Caveats

Every dollar figure is a worked example under stated assumptions, not a
prediction. Anything that touches a real tax return needs an accountant before it
ships.
