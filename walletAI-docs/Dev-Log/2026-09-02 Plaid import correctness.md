# 2026-09-02 — Plaid import correctness

A real brokerage connection surfaced three defects at once, and chasing them
turned up several more. Everything below shipped.

## What was reported

Holdings appeared twice. A US position bought at a loss reported a profit. An
account lost every position while gaining cash that was never deposited.

## What was actually wrong

**Phantom cash.** `buildAccountPortfolio` diffed incoming rows against the
previous snapshot and booked the difference as trades. Its only remaining caller
is the live price refresh, where a missing row means a fetch came back short —
not a sale. Reproduced at $1,370.25 of cash never deposited and a fabricated
−$1,380.75 realised loss. Trade inference is gone; see
[[Architecture/Accounts and Imports]].

**Duplication, two causes.** The holdings route returned every stored Plaid
document rather than the one being imported, so a retried link reported each
holding twice. And `previewMerge` collapsed same-symbol rows while `applyMerge`
wrote them all — the sheet promised one holding, the ledger showed two.

**A loss as a profit.** The FX gate required `ACCOUNT CURRENCY === 'CAD'` and the
route only emitted `CURRENCY`. Then a fix made it worse by assuming unknown meant
Canadian, converting market value while cost basis stayed in USD. Verified
against live data: RKLB at $62.54 USD with USD/CAD at 1.3896 reported +$101.63 on
a position down −$312.32. See [[Architecture/Currency]].

**Cash always zero.** A statement calls the figure `amount`; the route called it
`value`, and only `amount` was ever read.

**Disconnect never worked.** The institution slug was sent as Plaid's item id, so
the lookup 404'd into a `catch` and reported success while the connection kept
syncing.

**Accounts collapsed.** Selecting a TFSA and an RRSP put both into one account.
The issue blamed a four-character key collision; the real cause was the import
staging every selected account as one statement and rewriting every row to a
single chosen destination. Correct for a file, wrong for a connection.

**Deleted accounts came back.** The portfolio document was written with
Firestore's merge option, which deep-merges maps — so a key absent from the
payload was preserved. A merging write cannot express a deletion.

## Also found while in there

A stale price rendered identically to a live one. CDRs were identified by
searching the description for the word "CDR", which a connected brokerage need
not include — a miss prices a receipt against its US underlying, several times
too high, and then applies the exchange rate on top. Two light-mode CSS bugs from
the `!important` override block. And a character-class range bug of my own,
`[+-−]`, which swallowed digits and rendered 13.25% as 3.25%.

## What this cost, and the lesson

Three of these were only visible with real data, and two of my own fixes were
wrong first — both caught by looking at the screen, not by the tests, which
passed throughout.

The pattern worth remembering: **every one of these failed silently and in the
flattering direction.** Cash appeared, returns turned positive, totals looked
plausible. Nothing threw. A number that is confidently wrong is worse than a
number that is visibly missing, which is why stale prices now say so and a quote
wildly out of line with its row is rejected rather than written.

## Environment note

`api/plaid.js` has no dev-server route, so local frontend changes were being
tested against the deployed function. That split produced the profit-instead-of-
loss bug and could not have been caught locally. See
[[Operations/Local Development]].
