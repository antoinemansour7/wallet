# Transaction ledger — data model

Design for [#19](https://github.com/antoinemansour7/wallet/issues/19), the foundation of [#16](https://github.com/antoinemansour7/wallet/issues/16).

The issue asks for the opening-position design to be settled before any code, "because retrofitting it is far worse than planning for it". This is that decision, plus the six others that fall out of it once you look at how data actually persists here today.

---

## 1. Transactions do not live in `portfolio/current`

Everything the app stores today lands in a single Firestore document:

```
users/{uid}/portfolio/current   ← rows[] + accounts{} + timestamps
```

Transactions cannot go there. Three reasons, in order of how quickly they bite:

- **The 1 MiB document ceiling.** 24 months of trades and dividends across several accounts is thousands of records. A single document holding them will eventually refuse to save, and it will do so for the heaviest user first — the one with the most accounts, who is exactly the user this epic is for.
- **Every write rewrites everything.** `savePortfolio` writes the whole document. Appending one dividend would resend the entire holdings map.
- **[#13](https://github.com/antoinemansour7/wallet/issues/13) happened in that document.** A map inside a merged write silently kept deleted keys. Adding an unbounded, append-heavy structure to the same document invites the same class of bug.

**Decision.** One document per transaction in a subcollection:

```
users/{uid}/transactions/{transactionId}
```

Appends are single-document writes. Reads paginate. Nothing rewrites the holdings map.

## 2. The transaction id is deterministic, so de-duplication is free

"Imported, paginated, and de-duplicated across refreshes" is a requirement. De-duplication by diffing imported batches against stored ones is the expensive, fragile way to get it.

**Decision.** The document id *is* the identity, derived from the source:

| Source | id |
|---|---|
| Plaid | `plaid:{investment_transaction_id}` — Plaid's id is stable across pulls |
| Statement / manual | `manual:{hash}` over account + date + securityKey + action + quantity + amount |

Re-importing an overlapping window then writes the same ids with the same content. Idempotent by construction: no diffing, no "have I seen this" bookkeeping, and a re-run after a partial failure is safe.

## 3. Money is integer minor units, never floats

`0.1 + 0.2` is the oldest bug in finance software. It does not matter in a portfolio total that is already an estimate; it matters in an adjusted cost base, because ACB is carried forward across years and the drift compounds into a number that goes on a tax return.

**Decision.** Every monetary field is an integer count of minor units plus its currency (`amountMinor: 143299, currency: 'CAD'`). Quantities stay decimal — fractional shares are real — but are held to a fixed scale and never used as a divisor without guarding zero.

## 4. Security identity is its own key, resolved in priority order

Pooling is "identical securities across *every* non-registered account at any institution". Symbol alone cannot carry that:

- Plaid's `security_id` is internal to a Plaid item, so the same ETF at two brokerages arrives with two different ids.
- Bare symbols collide across exchanges and differ by listing.
- A **CDR is not its own underlying.** `NVDA` on the TSX in CAD and `NVDA` on the Nasdaq in USD are different securities with different cost bases, and [#28](https://github.com/antoinemansour7/wallet/issues/28) already established that CDRs cannot be identified by a description string.

**Decision.** Resolve a `securityKey` in this order, recording which rung was used:

1. `isin:{ISIN}` — Plaid returns it on the security object where available
2. `cusip:{CUSIP}`
3. `sym:{SYMBOL}:{exchange}:{currency}` — the fallback, and the only rung available for statement imports

Pooling joins on `securityKey`. Where the fallback rung is in play the join is a guess, and the provenance rules in §5 apply to it too.

## 5. We do not chase history older than Plaid gives us

**Revised 2026-09-04.** The original plan asked the user to type in a cost base for anything bought before the 24-month window. That is now out of scope.

The reason it is affordable to drop: four of the five features in #16 only need recent activity. Dividends received (#17), the FX rate actually paid (#18), fees (#21) and what was sold lately (#20) all sit comfortably inside two years. Only cost base on a long-held position needs history reaching back to purchase, and asking someone to reconstruct a 2019 purchase from memory produces a number that is confidently wrong — which, on a tax figure, is worse than no number.

**Decision.** Record where each account's history begins, and refuse to compute what it cannot support.

```
users/{uid}/accounts/{accountId}
  { historyStartsAt: '2024-09-04', ... }
```

A position whose holdings predate `historyStartsAt` is **incomplete**, and every figure derived from it says so instead of showing a number:

```
provenance: 'derived'    — every input was a real transaction
          | 'incomplete' — the security was already held when history began
```

So a stock bought last year gets a real cost base and a real gain. One bought in 2019 gets "we can't calculate this — your history starts September 2024", which is true, checkable, and cannot mislead anyone into filing it.

This removes the opening-position entry UI, the data-entry burden, and a whole class of wrong-number bug. If a user later wants the figure for an old holding badly enough to enter it by hand, that is a small additive feature on top of this shape — the record below already accommodates it — and not something to build before anyone has asked.

<details>
<summary>Deferred: the stated-opening record, if it is ever wanted</summary>

Opening positions would be their own record type, never a synthesised `BUY` — the moment a stated number is shaped like a trade, nothing downstream can tell it apart from a real one:</details>

```
users/{uid}/openingPositions/{accountId}:{securityKey}
  { quantity, costBasisMinor, currency, asOf, basis: 'stated', statedAt }
```

with `provenance: 'stated'` and `'mixed'` joining the two above. Not built.

Either way the principle holds: the labelling requirement is mechanical rather than remembered, because a screen cannot render a cost base without also receiving how it was arrived at — the two travel in the same object.

## 6. The FX rate is stored on the transaction, not looked up later

"Each trade converts at the rate on *its* trade date." Looking that rate up at display time makes the number unreproducible: historical rate sources revise, and a tax figure that changes between two viewings of the same screen is worse than one that is merely approximate.

**Decision.** `fxRate`, `fxRateSource` and `fxAsOf` are written onto the transaction at import and never recomputed. A rate that could not be resolved is stored as `null` and the figure downstream is `provenance: 'stated'`-adjacent — surfaced, not silently defaulted to 1.

## 7. Registered accounts are in the ledger, out of the calculation, in the check

Two different rules, easy to conflate:

- ACB pooling **excludes** registered accounts. There is no capital gain in a TFSA.
- The superficial-loss window **includes** them. Buying back in your RRSP denies the loss in your cash account.

**Decision.** Store transactions for every account regardless of registration. `accountType` (already derived in `api/plaid.js`: TFSA/RRSP/FHSA/RESP/LIRA/RRIF) rides on the transaction so neither pass has to join back to the account map to know which rule applies.

## 8. Superficial losses are detected and surfaced, never applied

The requirement is "surfaced for review rather than silently applied", and it is the right call: the 61-day window reaches into accounts WallAI cannot see — a spouse's, or a broker that was never connected — so the app is never in a position to know it has the whole picture.

**Decision.** Detection is a pure read over the ledger producing *candidates*, each with the triggering disposition, the repurchase that caused it, and the denied amount. It never writes to the stored ACB. Applying one is a user action, recorded as its own adjustment record, so the ACB stays reconstructible from ledger + adjustments.

---

## The record

```js
// users/{uid}/transactions/{id}
{
  id,                    // 'plaid:abc123' | 'manual:9f8e...'
  accountId,             // matches the accounts map key
  accountType,           // 'TFSA' | 'RRSP' | 'NON_REGISTERED' | ...
  securityKey,           // 'isin:US9229087690'
  securityKeyBasis,      // 'isin' | 'cusip' | 'symbol'  — how confident the pooling join is
  symbol,                // display only, never the join key
  action,                // 'BUY' | 'SELL' | 'DIVIDEND' | 'ROC' | 'REINVEST' | 'FEE' | 'SPLIT'
  tradeDate,             // 'YYYY-MM-DD', the date the rules key off
  quantity,              // decimal, signed by action
  priceMinor,            // per unit, integer minor units
  amountMinor,           // total, integer minor units
  feesMinor,
  currency,
  fxRate, fxRateSource, fxAsOf,   // null when unresolved, never defaulted to 1
  source,                // 'plaid' | 'statement' | 'manual'
  importedAt,
}
```

## Out of scope, per the issue

Options, corporate actions beyond splits, and spousal accounts. Each deserves its own issue; none of them changes the shape above, which is the test of whether this design was worth settling first.

## Build order

The pure core has no dependency on the in-flight account refactor and lands in new files:

1. `src/utils/securityKey.js` — §4 resolution, with the CDR case tested
2. `src/utils/transactionLedger.js` — the record, ids, validation, normalisation
3. `src/utils/costBase.js` — pooled ACB with provenance, the multi-brokerage multi-currency scenario from the issue's "done when", hand-verified
4. `src/utils/superficialLoss.js` — the 61-day detection pass

Then, once `api/plaid.js` and `accountMerge.js` are settled:

5. `/investments/transactions/get` import, paginated and idempotent
6. `historyStartsAt` per account, and the incomplete-history labelling on screen
