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

## 5. A stated opening position is a distinct record, not a synthetic buy

The 24-month ceiling means a position bought in 2019 has an opening cost base no API will supply. The user states it once. The question is where that stated number lives.

The tempting shortcut is to synthesise an opening `BUY` and let it flow through the same pipeline. **Rejected.** The moment a stated number is shaped like a trade, nothing downstream can tell it apart from a real one — and the issue requires exactly that distinction to survive all the way to the screen: "be explicit in the UI about which figures rest on a stated opening balance and which are fully derived."

**Decision.** Opening positions are their own record type:

```
users/{uid}/openingPositions/{accountId}:{securityKey}
  { quantity, costBasisMinor, currency, asOf, basis: 'stated', statedAt }
```

and every figure computed from the ledger carries provenance that propagates:

```
provenance: 'derived'  — every input was a real transaction
          | 'stated'   — rests on a stated opening position
          | 'mixed'    — a stated opening carried forward by real transactions
```

`mixed` is the common case and the one worth naming: it is not fully trustworthy and not merely a guess, and collapsing it into either neighbour would be a lie in one direction or the other.

This makes the labelling requirement mechanical rather than remembered. A screen cannot render an ACB without also receiving how it was arrived at, because the two travel in the same object.

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
6. Opening-position capture UI, and the provenance labelling on screen
