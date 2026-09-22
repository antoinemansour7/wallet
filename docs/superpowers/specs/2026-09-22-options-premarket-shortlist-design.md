# Options Premarket Shortlist — Design

Implements issue [#208](https://github.com/antoinemansour7/wallet/issues/208) ("[Options 07/17] Produce the frozen premarket underlying shortlist"), Stage 1 of the Options Opportunity Scanner epic ([#201](https://github.com/antoinemansour7/wallet/issues/201)).

## Summary

`#207` built the scheduler that wakes at 09:15 ET and calls a per-stage `execute()` function; the premarket branch is currently a stub (`pendingStage` in `api/options-scan.js`) that always reports `incomplete`. This story replaces that stub with a real worker that, for all 25 watchlist names, produces a deterministic, frozen, auditable shortlist (≤10 names, call or put) by the 09:20 ET deadline, using live data where a collector already exists and honestly marking a feed unavailable where none does.

Stage 2 (`#209`) will read this frozen shortlist and fetch option chains only for the shortlisted names — this story does not touch option contracts at all.

## Goals

- A genuinely runnable morning scan: given valid credentials and `OPTIONS_SCANNER_ENABLED=true`, the 09:15 ET trigger produces a real, frozen, immutable decision — not another placeholder.
- Every one of the 25 watchlist names is accounted for as `shortlisted` / `rejected` / `missing` / `unavailable`, with a reason.
- Reuse existing live collectors (Alpaca, SEC, market regime) rather than building a second data-integration layer.
- Where no live collector exists (news, analyst, earnings, dividends, rates, catalysts), say so explicitly — never substitute fixture data in a live run.
- Same inputs reproduce the identical shortlist and hash.

## Non-goals

- Fetching or scoring option contracts (`#209`, `#210`, `#211`).
- Building new live collectors for news, analyst, earnings, dividends, rates, or catalysts.
- Changing `#206`'s feature-snapshot function (`features.js`) or its source policy.
- UI (`#216`).

## Architecture

```
OPTIONS_WATCHLIST_SNAPSHOT (25 names, existing)
        │
        ▼
premarketEvidence.js (NEW) — gathers live inputs, honest about gaps
    ├─ Alpaca underlyingSnapshots()        [existing, alpaca.js]
    ├─ Alpaca recentDailyBars()            [NEW, alpaca.js]
    ├─ getMarketRegime()                   [existing, marketRegime.js]
    ├─ planCurrentDaySecRefresh() + ingestIssuer() [existing, features.js + secDisclosures.js]
    └─ news / analyst / earnings / dividends / rates / catalysts → explicitly marked unavailable
        │
        ▼
createOptionsFeatureSnapshot()  [existing, features.js — unchanged]
        │
        ▼
shortlist.js (NEW) — score call/put setups, select top ≤10, account for all 25
        │
        ▼
audit.js 'decision' + 'score' records  [existing types, first real use]
        │
        ▼
api/options-scan.js premarket executeStage + publish  [wires into #207's scheduler]
```

## Module: `src/server/options/premarketEvidence.js` (new)

Orchestrates gathering, given the scheduler's `execute()` context (`{ window, deadlineAt, attempt, checkpoint, saveCheckpoint, maxConcurrency }`).

1. **Underlying + technicals (Alpaca, batched, not concurrency-bound):**
   - One `underlyingSnapshots()` call for all 25 watchlist tickers (existing function, already supports up to 100 symbols per request).
   - One new `recentDailyBars()` call (see below) for all 25 tickers + the `SPY` benchmark.
   - Failures for individual tickers (per the adapter's existing `missing` reporting) become `unavailable` for that security, not a whole-stage failure.

2. **Market regime (existing, cached, fast):**
   - `getMarketRegime()` from `marketRegime.js`. One macro signal applies to all 25 securities. Wrapped into the shape `features.js`'s `regime` feed expects: `{ eventId: 'market-regime:' + asOf, score, label, availableAt, source: { provider: 'wallai', licenseId: 'derived-licensed-inputs', url: 'internal://wallai/market-regime' } }`. `licenseId` matches what `OPTIONS_FEATURE_SOURCE_POLICY.feeds.regime` already allows.

3. **SEC same-day refresh (existing pipeline, bounded, checkpointed):**
   - `loadSecurityMaster(archive)` (existing) to resolve the 25 tickers to CIKs.
   - `planCurrentDaySecRefresh({ securities, freezeAt, completed, securityMaster })` (existing, `#206`) to compute which issuers still need a same-day check, given what a prior (checkpointed) attempt already completed.
   - `runBounded(requests, maxConcurrency, ...)` (existing, `scheduler.js`) drives `ingestIssuer(archive, master, cik, { since, deadline, ... })` (existing, `secDisclosures.js`) per issuer, respecting the stage's `maxConcurrency` (4) and passing a deadline with headroom before `deadlineAt` — `ingestIssuer` already self-truncates near its deadline.
   - After each issuer completes, `saveCheckpoint({ secCompleted: [...] })` so a QStash retry resumes only the remaining issuers instead of restarting. If time runs out with issuers still pending, proceed with what's completed — SEC coverage is reported as `partial`, not a stage failure. `unresolved` tickers (no CIK match) are reported `unavailable`.

4. **No live collector — explicit gaps:** `news`, `analyst`, `earnings`, `dividends`, `rates`, `catalysts` are passed to `createOptionsFeatureSnapshot()` as empty arrays. `features.js`'s existing coverage logic already marks these `unknown`/`unavailable` with a reason automatically — no new code needed for this part.

5. Calls `createOptionsFeatureSnapshot({ securities, freezeAt, tradingDate, inputs, mode: 'live' })` (existing, unchanged) to produce the frozen, hashed feature snapshot.

## Module: `src/server/options/shortlist.js` (new)

Pure, deterministic — no I/O. Same design pattern as `features.js`.

**Scoring** — only the pre-chain-fetch subset of the epic's 9-component model (§10 of `#201`), computed per direction (call/put) from a feature record:

| Component | Max | Source |
|---|---:|---|
| Underlying setup | 15 | 5d/20d relative strength vs. SPY (10) + regime agreement (5) |
| Technical confirmation | 10 | Trend alignment (5) + distance from SMA20 as a breakout/support proxy (5) |
| Catalyst quality | 10 | `nonEventHorizon` state (`#206`, unchanged): `excluded` → security excluded entirely (a known earnings/catalyst event falls inside the 3-session holding horizon — this is a candidacy gate, not a score); `eligible` (coverage complete, confirmed no event) → 0, per the epic's own "no event = 0"; `unknown` (coverage incomplete) → 0, flagged |

Direction subtotal ≤ 35. `directional.call`/`directional.put` from `features.js` already sign-flip the momentum inputs; this module adds the point mapping and evidence trail (component, raw value, transform, points — auditable, matching `#204`'s `score` record shape).

**Note on catalyst quality in practice:** `#206`'s coverage logic only reports a feed `complete` when it's told to (via a supplied coverage override); since `#208` has no live source for earnings/catalysts, it cannot honestly claim `complete` coverage, so `nonEventHorizon` will realistically always resolve to `unknown` today, not `eligible`. Catalyst quality is therefore effectively **always 0-and-flagged in the current live setup** — not a bug, an honest reflection of not having a live catalyst feed yet. Positive catalyst scoring (rewarding a confirmed, non-earnings, favorable event) isn't reachable with `#206`'s current exclude-or-nothing function regardless of live data — that would need a future enrichment to `evaluateNonEventHorizon` itself, out of this story's scope.

**Policy call (flagged in Open Questions below for your sign-off):** `nonEventHorizon.state === 'unknown'` (the realistic default today, since no live earnings/analyst source exists) scores catalyst quality as `0` with an explicit `catalystCoverage: 'unknown'` flag on the candidate — it does **not** exclude the security. Only a *known* event inside the window excludes. Rationale: excluding on `unknown` would empty the shortlist every single day given current live coverage, which satisfies "honest no-candidate state" but defeats the scan's purpose; flagging keeps it honest without being useless.

**Selection**, for every one of the 25 watchlist securities:
- `unavailable` — no usable premarket price (hard gate; can't form a direction hypothesis at all).
- `missing` — absent from the feature snapshot entirely (adapter returned nothing for this ticker).
- `rejected` — scored, but a known event excludes it, or it didn't make the top-N cut. Reason always recorded.
- `shortlisted` — top ≤10 by score, call and put scored independently, higher direction wins per security. Deterministic tie-break: score desc → ticker asc (no spread/contract data exists yet at this stage, unlike `#209`'s tie-break).

Each shortlisted candidate carries: direction, score breakdown, feature/policy versions, `nonEventHorizon`/coverage status (so no gap is hidden), and the frozen `freezeAt`/`tradingDate`. `shortlistId = digest(shortlist)` — deterministic given the same feature snapshot and policy version.

## Freeze & storage — no new pointer scheme

Every `execute()` run produces new, immutable `evidence` (`#206`'s existing `createOptionsFeatureAuditRecord`), `decision`, and `score` audit records (`audit.js`'s existing, currently-unused `decision`/`score` types) — archived via `archiveOptionsAuditRecord` (existing, `auditStore.js`), never overwritten.

Freeze is enforced by `#207`'s existing machinery, not new code: one lease/fence per `scanId = {tradingDate}:premarket:{policyVersion}`, one completion per scanId. `execute()`'s `result.metrics` (already a generic string/number/boolean bag threaded into the scan-type audit record and, via the Redis completion pointer, readable without re-deriving anything) carries `decisionRecordId`/`scoreRecordId`/`evidenceRecordId` so `#209` can look up today's frozen premarket decision deterministically: completion pointer → scan audit record → `payload.metrics.decisionRecordId` → decision record. No new Redis key, no change to the shared "latest" pointer (that stays reserved for `#209`'s final published scan, matching the epic's UI concept).

## `alpaca.js` addition: `recentDailyBars()`

The only new network integration in this story. Reuses the adapter's existing auth headers, `requestJson`/retry machinery, and `normalizeBar()` helper (already present, currently only used for `optionChain`'s per-contract bars). Adds one endpoint to the existing allowlist (`/v2/stocks/bars`), one batched multi-symbol request (25 tickers + `SPY`, mirroring `underlyingSnapshots`' comma-joined-symbols pattern), ~20-25 session lookback. Tested the same way as the rest of `alpaca.js` — mocked HTTP responses, no live network in tests.

## `api/options-scan.js` changes

- `executeStage` for `stage === 'premarket'` becomes the new worker (`premarketEvidence.js` + `shortlist.js` + audit-record building), replacing `pendingStage` for that branch only. `opening` keeps using `pendingStage` — that's `#209`'s job.
- `createOptionsScanHandler` gets a real `publish` implementation: archives the evidence/decision/score records for the scanId (via `archiveOptionsAuditRecord`, not `commitOptionsScan` — that function's shared "latest" pointer is reserved for the final published scan in `#209`/`#212`).

## Testing

- `shortlist.js`: fixture-driven deterministic unit tests (same pattern as `features.test.js`) — every watchlist-accounting state, the tie-break, the `unknown`-vs-`excluded` catalyst policy, hash reproducibility.
- `alpaca.js`'s `recentDailyBars()`: mocked-response tests (same pattern as the rest of `alpaca.test.js`) — multi-symbol batching, partial-failure handling, corrupt payload rejection.
- `premarketEvidence.js`: fixture/mocked-collector tests covering full coverage, partial SEC coverage (checkpoint-and-resume), a ticker missing from Alpaca's response, and all-feeds-unavailable (still produces an honest empty/partial shortlist, never throws).
- `api/options-scan.js`: extend existing route tests for the premarket branch producing `complete`/`incomplete` correctly and `publish` archiving the right record set.

## Open questions for sign-off

1. **Catalyst-unknown policy** (above): flag-and-include rather than exclude. Confirm, or prefer strict exclusion (shortlist will very likely be empty most mornings until a live earnings/analyst source exists).
2. **SEC refresh time budget**: best-effort within the stage deadline, checkpointed across QStash's bounded retries, proceeding with partial SEC coverage if EDGAR is slow rather than blocking the freeze. Confirm this trade-off (freshness vs. timeliness) is right.

## What does NOT change

- `features.js` (`#206`) — used as-is.
- `scheduler.js` (`#207`) — used as-is; no changes to leasing, fencing, or the `execute`/`publish` contract.
- `audit.js` / `auditStore.js` (`#204`) — used as-is; `decision`/`score` types already existed, unused until now.
- `watchlist.js` (`#203`) — used as-is.
- The `opening` stage / `#209`'s scope — still a stub after this story.
