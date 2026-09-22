# Options Premarket Shortlist Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the premarket stub in `api/options-scan.js` with a real worker that scores call/put setups for all 25 watchlist names using live data where a collector exists, and produces a frozen, auditable, deterministic shortlist (≤10 names) by the 09:20 ET deadline.

**Architecture:** Four new/modified files, each with one job: `shortlist.js` (pure scoring/selection), `secCatalystEvidence.js` (lightweight SEC EDGAR reuse), `premarketEvidence.js` (orchestrates Alpaca + regime + SEC into `#206`'s feature snapshot, then into a shortlist, then into audit records — this is also the `execute()` entry point the scheduler calls), and `api/options-scan.js` (wires the worker and a real `publish` into `#207`'s scheduler).

**Tech Stack:** Node ESM, Vitest, existing Alpaca/SEC/Redis/R2 infra — no new dependencies.

**Spec:** [docs/superpowers/specs/2026-09-22-options-premarket-shortlist-design.md](../specs/2026-09-22-options-premarket-shortlist-design.md)

## Corrections to the spec, found while pinning down exact signatures

1. **No new Alpaca code needed.** `alpaca.js` already exports `stockBars(securities, { start, end, deadline })` from `createAlpacaOptionsAdapter()` (built alongside `#206`, already tested at `src/server/options/alpaca.test.js:196-215`) — it returns `observations[]` shaped **exactly** like what `features.js`'s `priorSessionBars()` expects (`securityId, issuerId, ticker, date, close, availableAt, source`), using `ALPACA_FEATURE_SOURCE` which already matches `#206`'s allowed `bars` provider/license. The spec's "recentDailyBars() addition" section is dropped entirely — this plan just calls the existing function.
2. **SEC reuse is lighter than the spec described.** `ingestIssuer()` (what the spec named) downloads full filing documents, runs XBRL fundamentals extraction, and writes into the shared research evidence store — that's the general stock-research product's deep pipeline, not a lightweight "check for new filings" call, and dragging it into a 5-minute options window would be exactly the kind of scope creep this story was told to avoid. Instead, this plan reuses the two lightweight, already-exported primitives it's built from: `createSecClient()` (rate-limited, User-Agent-validated HTTP fetcher) and `filingRows()` (pure submissions.json parser) from `secDisclosures.js`. One request per issuer to `https://data.sec.gov/submissions/CIK{cik}.json`, parsed, done — no document downloads, no fundamentals, no writes into the general research store.
3. **Alpaca credentials are not configured in production yet** (confirmed via `vercel env ls production` — no `ALPACA_API_KEY_ID`/`ALPACA_API_SECRET_KEY` listed, while `SEC_USER_AGENT` and both `UPSTASH_REDIS_REST_*` are present). The worker must degrade gracefully (mark underlying/bars unavailable) rather than throw when Alpaca construction fails — this was already implied by the spec's honesty requirement, but it is now a near-certainty for the first live run, not a hypothetical.

## Global Constraints

- No new npm dependencies.
- No semicolons, single quotes, 2-space indent, compact function style — match the existing `src/server/options/*.js` files exactly.
- Every audit record payload's `null` values must have a matching `missing` entry (`createOptionsAuditRecord`'s `validateMissing` throws otherwise) — use the `findNulls`-style auto-derivation pattern already used in `scheduler.js` and `features.js`, never hand-maintain a `missing` list.
- `mode: 'live'` feature snapshots must never contain a `"provider":"fixture"` string anywhere in the payload (`features.js` throws if they do) — unavailable feeds are empty arrays, never fixture placeholders.
- Every one of the 25 watchlist securities must appear in exactly one of `shortlist.candidates` or `shortlist.rejected` — never silently dropped.
- `shortlistId` must be identical given identical `snapshot` + `watchlist` + `policyVersion` inputs (pure function, no `Date.now()`/`Math.random()` inside `shortlist.js`).
- `earnings` and `analyst` coverage stay `unknown` in live mode — `#206`'s `OPTIONS_FEATURE_SOURCE_POLICY` only allows `fixture` for those feeds; do not pass any live data for them and do not change that policy.

## Review Focus

- **A ticker Alpaca has no snapshot for** (real gap — thinly-traded names, provider hiccups): must land in `rejected` with `status: 'unavailable'`, never crash the batch or silently vanish. (Task 1, Task 3)
- **Alpaca credentials missing or the adapter throwing on construction**: the whole stage must still complete with underlying/bars marked unavailable, not throw out of `execute()` and produce a bare `incomplete`/`late` with no shortlist at all. (Task 3)
- **A security with a very recent 8-K filing**: must be excluded (`nonEventHorizon.state === 'excluded'`), not scored and shortlisted, since that's exactly the near-term-event risk the non-event-mode policy exists to avoid. (Task 2, Task 3)
- **Two securities tied on score**: selection must be deterministic (ticker ascending), not insertion-order-dependent or subject to `Array.prototype.sort`'s stability assumptions being violated by a careless comparator. (Task 1)
- **The SEC security master not yet populated** (a real possibility — it's refreshed by an unrelated nightly job): `planCurrentDaySecRefresh` already returns every ticker as `unresolved` in that case; the worker must turn that into an honest `unavailable` SEC coverage state for all 25, not throw and fail the whole stage. (Task 2, Task 3)

---

## Task 1: `shortlist.js` — deterministic scoring and selection

**Files:**
- Create: `src/server/options/shortlist.js`
- Test: `src/server/options/shortlist.test.js`

**Interfaces:**
- Consumes: nothing from other new tasks — pure function over a feature-snapshot-shaped object and a watchlist-snapshot-shaped object (both fixture-constructed in this task's own tests).
- Produces (used by Task 3): `OPTIONS_SHORTLIST_POLICY_VERSION` (string constant), `OPTIONS_SHORTLIST_MAX_CANDIDATES` (number constant, `10`), `buildOptionsShortlist({ snapshot, watchlist, maxCandidates = OPTIONS_SHORTLIST_MAX_CANDIDATES, policyVersion = OPTIONS_SHORTLIST_POLICY_VERSION }) => { shortlistId, policyVersion, tradingDate, freezeAt, featureSnapshotId, maxCandidates, candidates: [...], rejected: [...], scores: [...] }`.

- [ ] **Step 1: Write the failing test for full watchlist accounting**

```js
// src/server/options/shortlist.test.js
import { describe, expect, it } from 'vitest'
import { OPTIONS_SHORTLIST_POLICY_VERSION, buildOptionsShortlist } from './shortlist.js'

function watchlist(tickers) {
  return { securities: tickers.map((ticker) => ({ securityId: `wallai:security:${ticker.toLowerCase()}`, issuerId: `wallai:issuer:${ticker.toLowerCase()}`, ticker })) }
}

function record({ ticker, premarketPrice = 100, relativeStrength = 5, sma20Distance = 2, return5d = 3, regimeScore = 7, nonEventState = 'unknown' }) {
  return {
    schemaVersion: 'options-security-features-v1',
    featureVersion: 'options-point-in-time-features-v1',
    recordId: `feature-record:${ticker}`,
    security: { securityId: `wallai:security:${ticker.toLowerCase()}`, issuerId: `wallai:issuer:${ticker.toLowerCase()}`, ticker },
    underlying: { premarketPrice },
    technicals: { distanceFromSma20Pct: sma20Distance },
    regime: regimeScore == null ? null : { score: regimeScore, label: 'mixed' },
    directional: {
      call: { relativeStrength20dPct: relativeStrength, return5dPct: return5d },
      put: { relativeStrength20dPct: -relativeStrength, return5dPct: -return5d },
    },
    nonEventHorizon: { state: nonEventState, reasons: nonEventState === 'excluded' ? [{ type: 'earnings', eventId: 'e1', date: '2026-09-23' }] : [] },
  }
}

function snapshot(records) {
  const base = { schemaVersion: 'options-feature-snapshot-v1', tradingDate: '2026-09-22', freezeAt: '2026-09-22T13:20:00.000Z', securities: records }
  return { ...base, snapshotId: 'snapshot-hash' }
}

describe('buildOptionsShortlist', () => {
  it('accounts for every watchlist security exactly once', () => {
    const list = watchlist(['AAA', 'BBB', 'CCC'])
    const snap = snapshot([record({ ticker: 'AAA' }), record({ ticker: 'BBB', premarketPrice: null })])
    const result = buildOptionsShortlist({ snapshot: snap, watchlist: list })
    const accounted = [...result.candidates.map((c) => c.ticker), ...result.rejected.map((r) => r.ticker)]
    expect(new Set(accounted)).toEqual(new Set(['AAA', 'BBB', 'CCC']))
    expect(result.rejected.find((r) => r.ticker === 'BBB')).toMatchObject({ status: 'unavailable', reason: 'no_premarket_price' })
    expect(result.rejected.find((r) => r.ticker === 'CCC')).toMatchObject({ status: 'missing', reason: 'not_in_feature_snapshot' })
    expect(result.candidates.find((c) => c.ticker === 'AAA')).toBeTruthy()
    expect(result.policyVersion).toBe(OPTIONS_SHORTLIST_POLICY_VERSION)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/server/options/shortlist.test.js`
Expected: FAIL — `shortlist.js` does not exist yet.

- [ ] **Step 3: Write the implementation**

```js
// src/server/options/shortlist.js
import { digest } from '../research/archive.js'

export const OPTIONS_SHORTLIST_POLICY_VERSION = 'options-premarket-shortlist-v1'
export const OPTIONS_SHORTLIST_MAX_CANDIDATES = 10
const HOLDING_DAYS = 3 // fixed primary horizon (epic #201 section 10)

function round(value, digits = 3) {
  return value == null ? null : Number(value.toFixed(digits))
}

// Clipped linear ramp: 0 points at or below `zero`, `max` points at or above
// `full`, linear between. Matches the epic's "clipped linear ramps" v0 policy.
function ramp(value, { zero, full, max }) {
  if (value == null) return 0
  if (value <= zero) return 0
  if (value >= full) return max
  return round(((value - zero) / (full - zero)) * max)
}

function underlyingSetupScore(record, direction) {
  const signed = record.directional[direction]
  const relStrengthPoints = ramp(signed.relativeStrength20dPct, { zero: 0, full: 10, max: 10 })
  const regimeScore = record.regime?.score ?? null
  // A constructive tape (score high) supports calls; a defensive/stand-down
  // tape (score low) supports puts. Symmetric, versioned v0 policy.
  const regimeAgreement = regimeScore == null ? 0
    : direction === 'call' ? ramp(regimeScore, { zero: 4, full: 8, max: 5 })
    : ramp(10 - regimeScore, { zero: 4, full: 8, max: 5 })
  return {
    component: 'underlyingSetup', max: 15, points: round(relStrengthPoints + regimeAgreement),
    evidence: [
      { feature: 'relativeStrength20dPct', raw: signed.relativeStrength20dPct, points: relStrengthPoints },
      { feature: 'regimeScore', raw: regimeScore, points: regimeAgreement },
    ],
  }
}

function technicalConfirmationScore(record, direction) {
  const signed = record.directional[direction]
  const trendPoints = ramp(signed.return5dPct, { zero: 0, full: 5, max: 5 })
  const distance = record.technicals.distanceFromSma20Pct
  const signedDistance = distance == null ? null : direction === 'call' ? distance : -distance
  const breakoutPoints = ramp(signedDistance, { zero: 0, full: 5, max: 5 })
  return {
    component: 'technicalConfirmation', max: 10, points: round(trendPoints + breakoutPoints),
    evidence: [
      { feature: 'return5dPct', raw: signed.return5dPct, points: trendPoints },
      { feature: 'distanceFromSma20Pct', raw: signedDistance, points: breakoutPoints },
    ],
  }
}

// #206's evaluateNonEventHorizon only ever confirms "no event" (eligible) or
// "unknown coverage" (unknown) in the current live setup — neither earns
// points under the epic's own "no event = 0" rule. A known event excludes
// the security entirely, one level up in buildOptionsShortlist.
function catalystQualityScore(record) {
  const state = record.nonEventHorizon.state
  return { component: 'catalystQuality', max: 10, points: 0, coverage: state, evidence: [{ feature: 'nonEventHorizon.state', raw: state, points: 0 }] }
}

export function scoreOptionsDirection(record, direction) {
  if (!['call', 'put'].includes(direction)) throw new Error('direction must be call or put')
  const components = [underlyingSetupScore(record, direction), technicalConfirmationScore(record, direction), catalystQualityScore(record)]
  return { securityId: record.security.securityId, ticker: record.security.ticker, direction, max: 35,
    total: round(components.reduce((sum, c) => sum + c.points, 0)), components }
}

export function buildOptionsShortlist({ snapshot, watchlist, maxCandidates = OPTIONS_SHORTLIST_MAX_CANDIDATES, policyVersion = OPTIONS_SHORTLIST_POLICY_VERSION } = {}) {
  if (snapshot?.schemaVersion !== 'options-feature-snapshot-v1' || !snapshot.snapshotId) throw new Error('Shortlist requires a completed feature snapshot')
  if (!Array.isArray(watchlist?.securities) || !watchlist.securities.length) throw new Error('Shortlist requires a watchlist snapshot')
  if (!Number.isInteger(maxCandidates) || maxCandidates < 1) throw new Error('maxCandidates must be a positive integer')

  const bySecurityId = new Map(snapshot.securities.map((record) => [record.security.securityId, record]))
  const scored = []
  const rejected = []

  for (const security of watchlist.securities) {
    const record = bySecurityId.get(security.securityId)
    if (!record) { rejected.push({ securityId: security.securityId, ticker: security.ticker, status: 'missing', reason: 'not_in_feature_snapshot' }); continue }
    if (record.underlying.premarketPrice == null) { rejected.push({ securityId: security.securityId, ticker: security.ticker, status: 'unavailable', reason: 'no_premarket_price' }); continue }
    if (record.nonEventHorizon.state === 'excluded') {
      rejected.push({ securityId: security.securityId, ticker: security.ticker, status: 'rejected', reason: 'known_event_in_holding_window', events: record.nonEventHorizon.reasons })
      continue
    }
    const call = scoreOptionsDirection(record, 'call')
    const put = scoreOptionsDirection(record, 'put')
    const [best, other] = call.total >= put.total ? [call, put] : [put, call]
    scored.push({ security, record, best, other })
  }

  scored.sort((a, b) => b.best.total - a.best.total || a.security.ticker.localeCompare(b.security.ticker))
  const shortlisted = scored.slice(0, maxCandidates)
  for (const entry of scored.slice(maxCandidates)) {
    rejected.push({ securityId: entry.security.securityId, ticker: entry.security.ticker, status: 'rejected', reason: 'not_top_n', direction: entry.best.direction, score: entry.best.total })
  }

  const candidates = shortlisted.map(({ security, record, best }) => ({
    securityId: security.securityId, ticker: security.ticker, direction: best.direction,
    score: best.total, maxScore: best.max, catalystCoverage: record.nonEventHorizon.state,
    holdingHorizonSessions: HOLDING_DAYS, featureVersion: record.featureVersion, featureRecordId: record.recordId,
  }))
  const scores = scored.map(({ security, best, other }) => ({ securityId: security.securityId, ticker: security.ticker, scores: [best, other] }))

  const base = { schemaVersion: 'options-shortlist-v1', policyVersion, tradingDate: snapshot.tradingDate, freezeAt: snapshot.freezeAt,
    featureSnapshotId: snapshot.snapshotId, maxCandidates, candidates, rejected, scores }
  return { ...base, shortlistId: digest(base) }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/server/options/shortlist.test.js`
Expected: PASS

- [ ] **Step 5: Add the remaining coverage tests (tie-break, exclusion, cap, determinism)**

```js
// append inside describe('buildOptionsShortlist', ...) in shortlist.test.js
  it('excludes a security with a known event in the holding window instead of scoring it', () => {
    const list = watchlist(['AAA'])
    const snap = snapshot([record({ ticker: 'AAA', nonEventState: 'excluded' })])
    const result = buildOptionsShortlist({ snapshot: snap, watchlist: list })
    expect(result.candidates).toHaveLength(0)
    expect(result.rejected[0]).toMatchObject({ status: 'rejected', reason: 'known_event_in_holding_window' })
  })

  it('caps the shortlist and breaks ties by ticker ascending', () => {
    const tickers = ['ZZZ', 'AAA', 'MMM']
    const list = watchlist(tickers)
    const snap = snapshot(tickers.map((ticker) => record({ ticker, relativeStrength: 5, sma20Distance: 2, return5d: 3 })))
    const result = buildOptionsShortlist({ snapshot: snap, watchlist: list, maxCandidates: 2 })
    expect(result.candidates.map((c) => c.ticker)).toEqual(['AAA', 'MMM'])
    expect(result.rejected.find((r) => r.ticker === 'ZZZ')).toMatchObject({ status: 'rejected', reason: 'not_top_n' })
  })

  it('is deterministic given identical inputs', () => {
    const list = watchlist(['AAA', 'BBB'])
    const snap = snapshot([record({ ticker: 'AAA' }), record({ ticker: 'BBB', relativeStrength: 8 })])
    const first = buildOptionsShortlist({ snapshot: snap, watchlist: list })
    const second = buildOptionsShortlist({ snapshot: snap, watchlist: list })
    expect(first.shortlistId).toBe(second.shortlistId)
  })

  it('scores catalyst quality as zero for both unknown and eligible coverage, never negative or positive', () => {
    const list = watchlist(['AAA', 'BBB'])
    const snap = snapshot([record({ ticker: 'AAA', nonEventState: 'unknown' }), record({ ticker: 'BBB', nonEventState: 'eligible' })])
    const result = buildOptionsShortlist({ snapshot: snap, watchlist: list })
    for (const entry of result.scores) for (const score of entry.scores) {
      expect(score.components.find((c) => c.component === 'catalystQuality').points).toBe(0)
    }
  })
```

- [ ] **Step 6: Run the full test file**

Run: `npm test -- src/server/options/shortlist.test.js`
Expected: PASS, all 5 tests

- [ ] **Step 7: Commit**

```bash
git add src/server/options/shortlist.js src/server/options/shortlist.test.js
git commit -m "$(cat <<'EOF'
Add deterministic options premarket shortlist scoring (#208)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: `secCatalystEvidence.js` — lightweight SEC EDGAR reuse

**Files:**
- Create: `src/server/options/secCatalystEvidence.js`
- Test: `src/server/options/secCatalystEvidence.test.js`

**Interfaces:**
- Consumes: `filingRows` from `../research/secDisclosures.js` (existing), `planCurrentDaySecRefresh` from `./features.js` (existing, `#206`), `runBounded` from `./scheduler.js` (existing, `#207`).
- Produces (used by Task 3): `gatherOptionsSecEvidence({ securityMaster, securities, freezeAt, completed = [], client, deadline, maxConcurrency = 4, sinceDays = 3, fetch, now }) => Promise<{ secItems: [...], catalystItems: [...], completed: [...] }>`. `client` is anything with an async `request(url)` method (matches `createSecClient()`'s return shape) — injected so tests never hit the network.

- [ ] **Step 1: Write the failing test**

```js
// src/server/options/secCatalystEvidence.test.js
import { describe, expect, it, vi } from 'vitest'
import { gatherOptionsSecEvidence } from './secCatalystEvidence.js'

function master(resolutions) {
  return { resolve: ({ ticker }) => resolutions[ticker] || [] }
}

const security = { securityId: 'wallai:security:example', issuerId: 'wallai:issuer:example', ticker: 'EX' }

describe('gatherOptionsSecEvidence', () => {
  it('maps a recent 8-K into both the sec feed and the catalysts feed, and an old 10-Q into sec only', async () => {
    const secMaster = master({ EX: [{ issuerId: 'cik:0000320193' }] })
    const client = { request: vi.fn(async () => ({
      filings: { recent: {
        accessionNumber: ['0000320193-26-000010', '0000320193-25-000090'],
        form: ['8-K', '10-Q'],
        acceptanceDateTime: ['2026-09-22T11:00:00.000Z', '2026-01-15T11:00:00.000Z'],
        filingDate: ['2026-09-22', '2026-01-15'],
        reportDate: ['2026-09-22', '2025-12-31'],
        primaryDocument: ['ex1.htm', 'ex2.htm'],
        items: ['', ''],
      } },
    })) }
    const result = await gatherOptionsSecEvidence({ securityMaster: secMaster, securities: [security], freezeAt: '2026-09-22T13:20:00.000Z', client, deadline: Date.now() + 60000 })
    expect(result.secItems).toHaveLength(1)
    expect(result.secItems[0]).toMatchObject({ form: '8-K', issuerId: security.issuerId, ticker: 'EX' })
    expect(result.catalystItems).toHaveLength(1)
    expect(result.catalystItems[0]).toMatchObject({ kind: 'sec_8k', eventDate: '2026-09-22' })
    expect(result.completed).toEqual(['cik:0000320193'])
  })

  it('marks a ticker unresolved in the security master as unavailable without throwing', async () => {
    const secMaster = master({})
    const client = { request: vi.fn() }
    const result = await gatherOptionsSecEvidence({ securityMaster: secMaster, securities: [security], freezeAt: '2026-09-22T13:20:00.000Z', client, deadline: Date.now() + 60000 })
    expect(result.secItems).toHaveLength(0)
    expect(client.request).not.toHaveBeenCalled()
  })

  it('skips an issuer already completed by a prior checkpointed attempt', async () => {
    const secMaster = master({ EX: [{ issuerId: 'cik:0000320193' }] })
    const client = { request: vi.fn() }
    const result = await gatherOptionsSecEvidence({ securityMaster: secMaster, securities: [security], freezeAt: '2026-09-22T13:20:00.000Z', completed: ['cik:0000320193'], client, deadline: Date.now() + 60000 })
    expect(client.request).not.toHaveBeenCalled()
    expect(result.completed).toEqual(['cik:0000320193'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/server/options/secCatalystEvidence.test.js`
Expected: FAIL — module does not exist yet.

- [ ] **Step 3: Write the implementation**

```js
// src/server/options/secCatalystEvidence.js
import { filingRows } from '../research/secDisclosures.js'
import { planCurrentDaySecRefresh } from './features.js'
import { runBounded } from './scheduler.js'

export const OPTIONS_SEC_EVIDENCE_SOURCE = Object.freeze({ provider: 'sec', licenseId: 'sec-edgar-public' })
const CATALYST_FORMS = new Set(['8-K', '8-K/A'])
const DAY = 86400000

function paddedCik(secIssuerId) {
  return secIssuerId.slice(4)
}

function submissionsUrl(secIssuerId) {
  return `https://data.sec.gov/submissions/CIK${paddedCik(secIssuerId)}.json`
}

async function defaultFetch(client, secIssuerId) {
  const submissions = await client.request(submissionsUrl(secIssuerId))
  return filingRows(submissions)
}

function mapRow(row, request, fetchedAt) {
  const publicAt = new Date(row.publicAt).toISOString()
  const documentId = `sec:${request.secIssuerId}:${row.accession}`
  const source = { ...OPTIONS_SEC_EVIDENCE_SOURCE, url: submissionsUrl(request.secIssuerId) }
  const secItem = { documentId, issuerId: request.issuerId, ticker: request.ticker, accession: row.accession, form: row.form, publicAt, availableAt: fetchedAt, source }
  const catalystItem = CATALYST_FORMS.has(row.form)
    ? { eventId: documentId, issuerId: request.issuerId, ticker: request.ticker, eventDate: publicAt.slice(0, 10), kind: 'sec_8k', label: `${row.form} filing ${row.accession}`, publicAt, availableAt: fetchedAt, source }
    : null
  return { secItem, catalystItem }
}

export async function gatherOptionsSecEvidence({
  securityMaster, securities, freezeAt, completed = [], client, deadline, maxConcurrency = 4, sinceDays = 3,
  fetch = defaultFetch, now = () => new Date().toISOString(),
} = {}) {
  if (!securityMaster || !client) throw new Error('SEC evidence gathering requires a securityMaster and client')
  const plan = planCurrentDaySecRefresh({ securities, freezeAt, completed, securityMaster })
  const since = new Date(Date.parse(freezeAt) - sinceDays * DAY).toISOString()
  const secItems = []
  const catalystItems = []
  const newlyCompleted = []

  await runBounded(plan.requests, Math.max(1, maxConcurrency), async (request) => {
    if (deadline != null && Date.now() + 5000 >= deadline) return
    try {
      const rows = await fetch(client, request.secIssuerId)
      const fetchedAt = now()
      for (const row of rows) {
        if (Date.parse(row.publicAt) < Date.parse(since)) continue
        const { secItem, catalystItem } = mapRow(row, request, fetchedAt)
        secItems.push(secItem)
        if (catalystItem) catalystItems.push(catalystItem)
      }
      newlyCompleted.push(request.secIssuerId)
    } catch { /* this issuer's coverage stays unavailable; others are unaffected */ }
  })

  return { secItems, catalystItems, completed: [...new Set([...completed, ...newlyCompleted])] }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/server/options/secCatalystEvidence.test.js`
Expected: PASS, all 3 tests

- [ ] **Step 5: Commit**

```bash
git add src/server/options/secCatalystEvidence.js src/server/options/secCatalystEvidence.test.js
git commit -m "$(cat <<'EOF'
Reuse existing SEC EDGAR primitives for options catalyst evidence (#208)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: `premarketEvidence.js` — orchestration and the scheduler entry point

**Files:**
- Create: `src/server/options/premarketEvidence.js`
- Test: `src/server/options/premarketEvidence.test.js`

**Interfaces:**
- Consumes: `createOptionsFeatureSnapshot`, `createOptionsFeatureAuditRecord` from `./features.js`; `createOptionsAuditRecord` from `./audit.js`; `OPTIONS_WATCHLIST_SNAPSHOT` from `./watchlist.js`; `createAlpacaOptionsAdapter` from `./alpaca.js`; `createSecClient` from `../research/secDisclosures.js`; `loadSecurityMaster` from `../research/securityMaster.js`; `getMarketRegime` from `../marketRegime.js`; `buildOptionsShortlist` from `./shortlist.js` (Task 1); `gatherOptionsSecEvidence` from `./secCatalystEvidence.js` (Task 2).
- Produces (used by Task 4): `runOptionsPremarketStage({ window, deadlineAt, checkpoint, saveCheckpoint, archive, ...overrides }) => Promise<{ status: 'complete', records: [...], metrics: {...} }>` — matches the `execute()` contract `runOptionsScheduledStage` (in `scheduler.js`, already built by `#207`) calls.

- [ ] **Step 1: Write the failing test for the full happy path**

```js
// src/server/options/premarketEvidence.test.js
import { describe, expect, it, vi } from 'vitest'
import { runOptionsPremarketStage } from './premarketEvidence.js'
import { OPTIONS_WATCHLIST_SNAPSHOT } from './watchlist.js'

const window = { stage: 'premarket', tradingDate: '2026-09-22', deadlineAt: '2026-09-22T13:20:00.000Z', policyVersion: 'options-morning-schedule-v1' }

function alpacaSnapshotFor(securities) {
  return {
    observations: securities.map((s) => ({
      securityId: s.securityId, fetchedAt: '2026-09-22T13:16:00.000Z', pricingReady: true,
      quote: { bid: 99.9, ask: 100.1, marketAt: '2026-09-22T13:15:59.000Z' },
    })),
  }
}

function alpacaBarsFor(securities) {
  const dates = ['2026-08-24', '2026-08-25']
  return {
    observations: securities.flatMap((s) => dates.map((date) => ({
      securityId: s.securityId, issuerId: s.issuerId, ticker: s.ticker, date, close: 100 + dates.indexOf(date),
      availableAt: '2026-09-21T20:00:00.000Z', source: { provider: 'alpaca', licenseId: 'alpaca-basic-indicative', url: 'https://data.alpaca.markets/v2/stocks/bars' },
    }))),
  }
}

function stubAlpaca() {
  return () => ({
    underlyingSnapshots: vi.fn(async (securities) => alpacaSnapshotFor(securities)),
    stockBars: vi.fn(async (securities) => alpacaBarsFor(securities)),
  })
}

describe('runOptionsPremarketStage', () => {
  it('produces a complete, frozen shortlist from live-shaped inputs', async () => {
    const archive = { put: vi.fn(async (kind, id, record) => record) }
    const saveCheckpoint = vi.fn()
    const result = await runOptionsPremarketStage({
      window, deadlineAt: window.deadlineAt, checkpoint: null, saveCheckpoint, archive,
      createAlpaca: stubAlpaca(),
      fetchRegime: async () => ({ asOf: '2026-09-22', score: 7, label: 'constructive' }),
      loadMaster: async () => ({ resolve: () => [] }), // no SEC master populated: sec/catalysts stay empty, honestly
      createSec: () => ({ request: vi.fn() }),
    })
    expect(result.status).toBe('complete')
    expect(result.records).toHaveLength(3)
    expect(result.records.map((r) => r.recordType).sort()).toEqual(['decision', 'evidence', 'score'])
    expect(result.metrics.candidateCount).toBeGreaterThan(0)
    expect(result.metrics.candidateCount).toBeLessThanOrEqual(10)
    expect(result.metrics.alpacaAvailable).toBe(true)
    expect(result.metrics.regimeAvailable).toBe(true)
    const decision = result.records.find((r) => r.recordType === 'decision')
    const accounted = [...decision.payload.candidates.map((c) => c.ticker), ...decision.payload.rejected.map((r) => r.ticker)]
    expect(new Set(accounted)).toEqual(new Set(OPTIONS_WATCHLIST_SNAPSHOT.securities.map((s) => s.ticker)))
  })

  it('degrades gracefully when Alpaca construction throws (missing credentials)', async () => {
    const archive = { put: vi.fn(async (kind, id, record) => record) }
    const result = await runOptionsPremarketStage({
      window, deadlineAt: window.deadlineAt, checkpoint: null, saveCheckpoint: vi.fn(), archive,
      createAlpaca: () => { throw new Error('Alpaca data credentials are required') },
      fetchRegime: async () => null,
      loadMaster: async () => ({ resolve: () => [] }),
      createSec: () => ({ request: vi.fn() }),
    })
    expect(result.status).toBe('complete')
    expect(result.metrics.alpacaAvailable).toBe(false)
    const decision = result.records.find((r) => r.recordType === 'decision')
    expect(decision.payload.candidates).toHaveLength(0)
    expect(decision.payload.rejected.every((r) => r.status === 'unavailable' && r.reason === 'no_premarket_price')).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/server/options/premarketEvidence.test.js`
Expected: FAIL — module does not exist yet.

- [ ] **Step 3: Write the implementation**

```js
// src/server/options/premarketEvidence.js
import { createOptionsFeatureSnapshot, createOptionsFeatureAuditRecord } from './features.js'
import { createOptionsAuditRecord } from './audit.js'
import { OPTIONS_WATCHLIST_SNAPSHOT } from './watchlist.js'
import { createAlpacaOptionsAdapter } from './alpaca.js'
import { createSecClient } from '../research/secDisclosures.js'
import { loadSecurityMaster } from '../research/securityMaster.js'
import { getMarketRegime } from '../marketRegime.js'
import { buildOptionsShortlist } from './shortlist.js'
import { gatherOptionsSecEvidence } from './secCatalystEvidence.js'

const BENCHMARK_SECURITY = Object.freeze({ securityId: 'benchmark:SPY', issuerId: 'benchmark:SPY', ticker: 'SPY' })
const ALPACA_UNDERLYING_URL = 'https://data.alpaca.markets/v2/stocks/snapshots'
const BAR_LOOKBACK_DAYS = 45
const DAY = 86400000

function mapUnderlyingInput(observation) {
  return {
    securityId: observation.securityId,
    price: null,
    quote: observation.quote ? { bid: observation.quote.bid, ask: observation.quote.ask } : null,
    trade: observation.trade ? { price: observation.trade.price } : null,
    marketAt: observation.quote?.marketAt || observation.trade?.marketAt || null,
    availableAt: observation.fetchedAt,
    source: { provider: 'alpaca', licenseId: 'alpaca-basic-indicative', url: ALPACA_UNDERLYING_URL },
    pricingReady: observation.pricingReady === true,
  }
}

function mapRegimeInput(regime) {
  if (!regime) return []
  return [{ eventId: `market-regime:${regime.asOf}`, score: regime.score, label: regime.label, availableAt: new Date().toISOString(),
    source: { provider: 'wallai', licenseId: 'derived-licensed-inputs', url: 'internal://wallai/market-regime' } }]
}

// Same pattern as scheduler.js's own findNulls: createOptionsAuditRecord
// requires every null in the payload to have a matching missing-path entry.
function findNulls(value, path = 'payload', found = []) {
  if (value === null) { found.push({ path, reason: 'not_observed_at_freeze' }); return found }
  if (!value || typeof value !== 'object') return found
  for (const [key, child] of Object.entries(value)) findNulls(child, Array.isArray(value) ? `${path}[${key}]` : `${path}.${key}`, found)
  return found
}

async function gatherAlpaca(createAlpaca, securities, tradingDate, deadlineAt) {
  const alpaca = createAlpaca()
  const underlyingResult = await alpaca.underlyingSnapshots(securities, { deadline: deadlineAt })
  const start = new Date(Date.parse(`${tradingDate}T00:00:00Z`) - BAR_LOOKBACK_DAYS * DAY).toISOString().slice(0, 10)
  const barsResult = await alpaca.stockBars([...securities, BENCHMARK_SECURITY], { start, end: tradingDate, deadline: deadlineAt })
  return { underlyings: underlyingResult.observations.map(mapUnderlyingInput), bars: barsResult.observations }
}

export async function runOptionsPremarketStage({
  window, deadlineAt, checkpoint, saveCheckpoint, archive,
  watchlist = OPTIONS_WATCHLIST_SNAPSHOT,
  createAlpaca = createAlpacaOptionsAdapter,
  fetchRegime = getMarketRegime,
  createSec = createSecClient,
  loadMaster = loadSecurityMaster,
  buildShortlist = buildOptionsShortlist,
  gatherSec = gatherOptionsSecEvidence,
} = {}) {
  const freezeAt = window.deadlineAt
  const tradingDate = window.tradingDate
  const securities = watchlist.securities

  let underlyings = [], bars = [], alpacaAvailable = true
  try {
    const gathered = await gatherAlpaca(createAlpaca, securities, tradingDate, deadlineAt)
    underlyings = gathered.underlyings
    bars = gathered.bars
  } catch { alpacaAvailable = false }

  let regime = null
  try { regime = await fetchRegime() } catch { /* stays unavailable */ }

  let secItems = [], catalystItems = [], secCompleted = checkpoint?.secCompleted || []
  try {
    const master = await loadMaster(archive)
    const client = createSec({ deadline: Date.parse(deadlineAt) })
    const secResult = await gatherSec({ securityMaster: master, securities, freezeAt, completed: secCompleted, client, deadline: Date.parse(deadlineAt) })
    secItems = secResult.secItems
    catalystItems = secResult.catalystItems
    secCompleted = secResult.completed
    await saveCheckpoint({ secCompleted })
  } catch { /* sec/catalysts stay empty; features.js will mark that coverage unavailable */ }

  const inputs = { underlyings, bars, regime: mapRegimeInput(regime), sec: secItems, catalysts: catalystItems, news: [], analyst: [], earnings: [], dividends: [], rates: [] }
  const snapshot = createOptionsFeatureSnapshot({ securities, freezeAt, tradingDate, inputs, benchmarkSecurityId: BENCHMARK_SECURITY.securityId, mode: 'live' })
  const scanId = `${tradingDate}:premarket:${window.policyVersion}`
  const evidenceRecord = createOptionsFeatureAuditRecord({ snapshot, scanId })
  const shortlist = buildShortlist({ snapshot, watchlist })

  const decisionPayload = { candidates: shortlist.candidates, rejected: shortlist.rejected }
  const decisionRecord = createOptionsAuditRecord({
    type: 'decision', scanId, availableAt: freezeAt,
    source: { provider: 'wallai', feed: 'premarket-shortlist', session: 'premarket', entitlement: 'internal' },
    versions: { code: 'options-shortlist-v1', model: 'deterministic-no-model', policy: shortlist.policyVersion },
    inputHashes: [snapshot.snapshotId], payload: decisionPayload, missing: findNulls(decisionPayload),
  })
  const scorePayload = { scores: shortlist.scores }
  const scoreRecord = createOptionsAuditRecord({
    type: 'score', scanId, availableAt: freezeAt,
    source: { provider: 'wallai', feed: 'premarket-shortlist', session: 'premarket', entitlement: 'internal' },
    versions: { code: 'options-shortlist-v1', model: 'deterministic-no-model', policy: shortlist.policyVersion },
    inputHashes: [snapshot.snapshotId], payload: scorePayload, missing: findNulls(scorePayload),
  })

  return {
    status: 'complete',
    records: [evidenceRecord, decisionRecord, scoreRecord],
    metrics: {
      shortlistId: shortlist.shortlistId, candidateCount: shortlist.candidates.length, rejectedCount: shortlist.rejected.length,
      alpacaAvailable, regimeAvailable: regime != null, secCompletedCount: secCompleted.length,
      decisionRecordId: decisionRecord.recordId, scoreRecordId: scoreRecord.recordId, evidenceRecordId: evidenceRecord.recordId,
    },
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/server/options/premarketEvidence.test.js`
Expected: PASS, both tests. If `createOptionsAuditRecord` throws on a null-without-missing-entry, the error message names the exact payload path — fix `findNulls` usage at that path, don't add a manual `missing` entry.

- [ ] **Step 5: Add a checkpoint-resume test**

```js
// append inside describe('runOptionsPremarketStage', ...) in premarketEvidence.test.js
  it('passes prior checkpoint completion into the SEC gatherer and threads the result back out', async () => {
    const archive = { put: vi.fn(async (kind, id, record) => record) }
    const gatherSec = vi.fn(async ({ completed }) => {
      expect(completed).toEqual(['cik:0000320193'])
      return { secItems: [], catalystItems: [], completed: ['cik:0000320193', 'cik:0000789019'] }
    })
    const result = await runOptionsPremarketStage({
      window, deadlineAt: window.deadlineAt, checkpoint: { secCompleted: ['cik:0000320193'] }, saveCheckpoint: vi.fn(), archive,
      createAlpaca: stubAlpaca(), fetchRegime: async () => null, loadMaster: async () => ({ resolve: () => [] }),
      createSec: () => ({ request: vi.fn() }), gatherSec,
    })
    expect(result.metrics.secCompletedCount).toBe(2)
  })
```

- [ ] **Step 6: Run the full test file**

Run: `npm test -- src/server/options/premarketEvidence.test.js`
Expected: PASS, all 3 tests

- [ ] **Step 7: Commit**

```bash
git add src/server/options/premarketEvidence.js src/server/options/premarketEvidence.test.js
git commit -m "$(cat <<'EOF'
Orchestrate live inputs into the options premarket shortlist (#208)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Wire the real worker into `api/options-scan.js`

**Files:**
- Modify: `api/options-scan.js`
- Modify: `api/options-scan.test.js`

**Interfaces:**
- Consumes: `runOptionsPremarketStage` from `../src/server/options/premarketEvidence.js` (Task 3); `archiveOptionsAuditRecord` from `../src/server/options/auditStore.js` (existing, `#204`).
- Produces: nothing further downstream in this story — `#209` will read the archived decision record directly (documented in the spec's "Freeze & storage" section: completion pointer → scan audit record → `payload.metrics.decisionRecordId` → decision record).

- [ ] **Step 1: Read the current file and its existing test to confirm the exact touch points**

The existing default `executeStage` is `pendingStage` for *both* stages (`api/options-scan.js:18-38`). The existing test `'dispatches through one route...'` (`api/options-scan.test.js:29-42`) asserts the *default* `executeStage` returns `{status:'incomplete', reason:'premarket_worker_not_installed'}` for `stage: 'premarket'` — that assertion is about to become false and must be updated as part of this task, not left broken.

- [ ] **Step 2: Write the failing test for the new dispatch behavior**

Replace the existing `'dispatches through one route and does not expose the provider message ID'` test in `api/options-scan.test.js` with two tests — one confirming `opening` still uses the stub, one confirming `premarket` now delegates to the real worker:

```js
// api/options-scan.test.js — replace the single 'dispatches through one route...' test with:
  it('still uses the truthful placeholder for the opening stage', async () => {
    const runStage = vi.fn(async ({ stage, execute }) => {
      expect(await execute({ checkpoint: null })).toMatchObject({ status: 'incomplete', reason: 'opening_worker_not_installed' })
      return { status: 'incomplete', stage, tradingDate: '2026-09-22', attempt: 1, auditRecordId: 'audit-reference' }
    })
    const handler = createOptionsScanHandler({ getRedis: () => ({ redis: true }), makeArchive: () => ({ archive: true }), runStage, enabled: () => true })
    const res = response()
    await handler(request({ query: { mode: 'opening' } }), res)
    expect(res.statusCode).toBe(503)
  })

  it('dispatches premarket into the real worker and does not expose the provider message ID', async () => {
    const runPremarketStage = vi.fn(async () => ({ status: 'complete', records: [], metrics: { candidateCount: 3 } }))
    const runStage = vi.fn(async ({ stage, requestId, execute }) => {
      expect(stage).toBe('premarket')
      expect(requestId).toBe('message-secret-id')
      const outcome = await execute({ checkpoint: null })
      expect(outcome).toMatchObject({ status: 'complete', metrics: { candidateCount: 3 } })
      return { status: 'complete', stage, tradingDate: '2026-09-22', attempt: 1, auditRecordId: 'audit-reference' }
    })
    const handler = createOptionsScanHandler({ getRedis: () => ({ redis: true }), makeArchive: () => ({ archive: true }), runStage, enabled: () => true, runPremarketStage })
    const res = response()
    await handler(request(), res)
    expect(res.statusCode).toBe(200)
    expect(runPremarketStage).toHaveBeenCalledOnce()
    expect(JSON.stringify(res.body)).not.toContain('message-secret-id')
  })
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- api/options-scan.test.js`
Expected: FAIL — `createOptionsScanHandler` doesn't accept `runPremarketStage` yet, and the default dispatcher doesn't route by stage.

- [ ] **Step 4: Update the implementation**

```js
// api/options-scan.js — full new contents
import { Redis } from '@upstash/redis'
import { createArchive, digest } from '../src/server/research/archive.js'
import { OptionsSchedulerUnavailableError, runOptionsScheduledStage } from '../src/server/options/scheduler.js'
import { runOptionsPremarketStage as defaultRunPremarketStage } from '../src/server/options/premarketEvidence.js'
import { archiveOptionsAuditRecord } from '../src/server/options/auditStore.js'

function authorized(req) {
  return Boolean(process.env.CRON_SECRET) && req.headers.authorization === `Bearer ${process.env.CRON_SECRET}`
}

function redisFromEnv() {
  return process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN ? Redis.fromEnv() : null
}

function requestId(req) {
  return req.headers['upstash-message-id'] || req.headers['x-qstash-message-id'] || req.headers['x-vercel-id'] || req.headers['x-request-id'] || 'unidentified-dispatch'
}

// Story #209 replaces this truthful checkpoint with the opening worker.
// Keeping the dispatcher deployable now validates the schedule, lease,
// retry and audit path without pretending a chain scan ran.
async function pendingOpeningStage({ checkpoint }) {
  return { status: 'incomplete', reason: 'opening_worker_not_installed', checkpoint: checkpoint || { cursor: 'not_started' }, metrics: { workerInstalled: false } }
}

export function createOptionsScanHandler({
  getRedis = redisFromEnv,
  makeArchive = createArchive,
  runStage = runOptionsScheduledStage,
  runPremarketStage = defaultRunPremarketStage,
  enabled = () => process.env.OPTIONS_SCANNER_ENABLED === 'true',
} = {}) {
  return async function optionsScanHandler(req, res) {
    if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ error: 'Method not allowed' })
    if (!authorized(req)) return res.status(401).json({ error: 'Unauthorized' })
    const stage = req.query?.mode
    if (!['premarket', 'opening'].includes(stage)) return res.status(400).json({ error: 'Invalid options scan mode' })
    const redis = getRedis()
    const archive = redis ? makeArchive(redis) : null
    const reference = digest([stage, requestId(req), Date.now()]).slice(0, 16)
    try {
      const result = await runStage({
        redis, archive, stage, requestId: requestId(req), enabled: enabled(),
        execute: (context) => stage === 'premarket' ? runPremarketStage({ ...context, archive }) : pendingOpeningStage(context),
        publish: async (result) => { for (const record of result.records || []) await archiveOptionsAuditRecord(archive, record) },
      })
      const statusCode = result.status === 'incomplete' ? 503 : result.status === 'in_progress' ? 202 : 200
      return res.status(statusCode).json({
        status: result.status, stage: result.stage || stage, tradingDate: result.tradingDate,
        attempt: result.attempt, reference: result.auditRecordId || reference,
      })
    } catch (error) {
      const category = error instanceof OptionsSchedulerUnavailableError ? 'schedule_storage_unavailable' : 'schedule_dispatch_failed'
      console.error(JSON.stringify({ service: 'options-scheduler', stage, category, reference }))
      return res.status(503).json({ error: 'Options scan scheduling is unavailable.', category, reference })
    }
  }
}

export default createOptionsScanHandler()
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- api/options-scan.test.js`
Expected: PASS, all 4 tests (the two untouched tests plus the two from Step 2)

- [ ] **Step 6: Run the full existing suite for regressions**

Run: `npm test`
Expected: PASS — no other file imports the old `executeStage`/`pendingStage` names from `api/options-scan.js`, so this is a contained change. If anything else does, update that call site to match the new `runPremarketStage` constructor parameter name.

- [ ] **Step 7: Run lint and build**

Run: `npm run lint && npm run build`
Expected: both PASS

- [ ] **Step 8: Commit**

```bash
git add api/options-scan.js api/options-scan.test.js
git commit -m "$(cat <<'EOF'
Wire the real premarket worker into the options scan dispatcher (#208)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review

**1. Spec coverage:**
- "Every watchlist member accounted for" → Task 1, Step 1 test (`accounts for every watchlist security exactly once`).
- "Determinism / reproducible hash" → Task 1, Step 5 test (`is deterministic given identical inputs`).
- "Freeze semantics via existing scanId fencing, no new pointer" → Task 3's `scanId` construction + Task 4's `publish` (archives only, doesn't touch the shared latest pointer or `commitOptionsScan`).
- "Catalyst-quality always 0/flagged in the current live setup" → Task 1, Step 5 test (`scores catalyst quality as zero for both unknown and eligible coverage`).
- "Known event excludes rather than scores" → Task 1, Step 5 test (`excludes a security with a known event...`) and Task 2's mapping of 8-K filings into the catalysts feed with `eventDate` inside the horizon.
- "Reuse Alpaca as-is, no new adapter code" → Task 3 calls `alpaca.underlyingSnapshots`/`alpaca.stockBars` directly, no changes to `alpaca.js`.
- "Reuse lightweight SEC primitives, not the heavy pipeline" → Task 2 imports only `filingRows`/`createSecClient`, never `ingestIssuer`.
- "Graceful degradation on missing Alpaca credentials" → Task 3, Step 1's second test (`degrades gracefully when Alpaca construction throws`).
- "SEC master not yet populated → honest unavailable, not a crash" → Task 2, Step 1's second test (`marks a ticker unresolved... without throwing`) and Task 3's `loadMaster: async () => ({ resolve: () => [] })` stub in every test.
- "Checkpointing across the SEC phase" → Task 2's `completed` param + Task 3's `await saveCheckpoint({ secCompleted })` + Task 3 Step 5's resume test.
- "`opening` stage stays a stub" → Task 4, Step 2's first new test.
- "`publish` archives records without touching the shared latest pointer" → Task 4's `publish` implementation.

**2. Placeholder scan:** No TBD/TODO in any task. Every step has complete, specific code — no "similar to Task N," no bare prose describing what a step does without showing it.

**3. Type consistency:** `buildOptionsShortlist`'s return shape (`shortlistId, policyVersion, tradingDate, freezeAt, featureSnapshotId, maxCandidates, candidates, rejected, scores`) is used identically in Task 3's `shortlist.policyVersion`/`shortlist.candidates`/`shortlist.rejected`/`shortlist.scores`/`shortlist.shortlistId`. `gatherOptionsSecEvidence`'s return shape (`secItems, catalystItems, completed`) is used identically in Task 3's destructuring. `runOptionsPremarketStage`'s return shape (`status, records, metrics`) matches what Task 4's test expects from the injected `runPremarketStage`, and matches the `execute()` contract `scheduler.js` (`#207`, unmodified) already expects.

**4. Review Focus:** all five items above have an owning task and an actual test, listed in each item's parenthetical.
