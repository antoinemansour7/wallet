# Accounts and Imports

The model everything on the portfolio side rests on. Worth reading before
changing anything in `src/utils/accountMerge.js` or `accountPortfolio.js`.

## An account is a set of imports

Not a file. An account is one or more **imports** stacked on top of each other —
a connected brokerage, a CSV, a PDF statement — and every position carries
`__sourceId` naming the import it came from.

That field is what makes the rest possible. Removing an import removes only its
positions; removing the last one removes the account. Opening an account shows
what it is actually made of.

Before it existed, every upload was treated as a complete snapshot of the entire
portfolio. Uploading a second brokerage's statement destroyed the first and
credited the account with imaginary proceeds for the "sold" positions.

## Adding: a new source adds, a repeat replaces

The sum-versus-replace question answers itself once sources exist:

- A statement from a **new** source is **added** alongside — two brokerages, both
  TFSAs.
- A statement from a **known** source **replaces** what that source loaded last
  time — this month's statement from the same brokerage.

Which is what a person means by "add this to my TFSA" versus "here's this
month's statement".

## Where an import lands

**A file is asked.** Account numbers are not stable across institutions and
guessing wrong silently merges two unrelated accounts. So the destination is a
question, and the merge states its effects before running.

**A connection is not asked.** Plaid reports holdings per account and says which.
Funnelling them into one chosen destination pooled a TFSA and an RRSP into a
single account — holdings mixed, cash summed, total plausible. Connected imports
now go through `applyMergeByAccount`, which keeps each row where it was reported.

This distinction is the whole reason both code paths exist. Collapsing them back
into one would reintroduce the bug.

## Preview and apply must agree

`previewMerge` and `applyMerge` both run rows through `aggregateRowsBySymbol`.
They did not always: preview collapsed same-symbol rows through a `Map` while
apply wrote them all, so the sheet promised one holding and the ledger showed
two. Anything that changes what one of them sees has to change the other.

Rows are aggregated once at staging, so the staged set is the set that gets
previewed, counted and stored.

## A price refresh is not a statement

`buildAccountPortfolio` does **not** infer trades. It used to: it diffed incoming
rows against the previous snapshot and booked the difference as buys and sells.

Its only remaining caller is the live price refresh, where quantities never
change and a missing row means a fetch came back short. Reading that as a
liquidation emptied a real account and credited it with the proceeds, marked
"inferred". Rows that say nothing about an account are a gap, not a sale.

Importing has not gone through that path since positions learned which feed they
came from. `applyMerge` owns it, and deliberately infers nothing — realised P&L
is a property of trading history, not of importing a file.

## Naming

A connected account is named type-first — `TFSA 8830` rather than `8830`. A bare
four-digit mask is not unique across account types at one institution, and the
accounts map is keyed by exactly this string. Plaid's own `account_id` travels on
the row as the identity behind the label.

## Storage

The portfolio document is written **whole**, never merged. Firestore's merge
option deep-merges nested maps, so keys absent from the payload are kept — and
removing an account is expressed by its key no longer being there. A merging
write could not express a deletion, so deleted accounts came back on reload.

`clearPortfolio` exists because `savePortfolio` refuses to write an empty
payload, which is the guard that stops a failed parse wiping a good portfolio.
Removing the last account is the one case where empty is intended.
