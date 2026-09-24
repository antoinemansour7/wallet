# Options scanner operations runbook

Story #215. Read this after `docs/research/options-scheduler.md` (scheduling
mechanics) and `docs/research/options-audit-storage.md` (what gets archived
and why); this doc is about diagnosing a scanner that is not behaving,
not about how it is built.

There is no assumed Slack or other push transport. Nothing here alerts
anyone. The operator pulls diagnostics on demand from the owner-only API
below; nothing polls, and nothing pages. If you want an alert channel, that
is a separate, explicitly scoped story (#218 covers optional alerts, and
only after data rights, quality and holdout gates in the epic are met).

## Where to look

`GET /api/options-audit?view=operations`, owner-authenticated (same Firebase
check as every other options audit read; see `verifyOwner` in
`src/server/research/evaluationApi.js`). It recomputes a report at read time
from records the scanner already archived -- nothing is written by reading
it, and reading it issues no provider request. A broken read degrades to
`{ status: 'unavailable', reason }`; it never throws, and it never crashes an
ordinary page, because nothing outside Options operations calls it.

The response (`src/server/options/operations.js`, `buildOptionsOperationsReport`)
carries:

- `killSwitchEngaged` -- is `research:options:kill:v1` set right now.
- `scheduleHealth` -- from `optionsScheduleHealth` (#207): stages whose
  grace-expired deadline for the last market day has no on-time completion.
- `stageTimings` -- every archived scan-attempt record for the lookback
  window, each with `scheduledAt`/`startedAt`/`endedAt`, `status`, `attempt`,
  and that attempt's own redacted `metrics` (provider request/429/5xx counts,
  pagination, Redis command count, R2 bytes, and the stage-specific counts
  each worker already reports -- `acceptedCount`, `revalidationFailedCount`,
  and so on).
- `chainQuality` -- quote age/skew percentiles and a rejection-reason
  histogram from the latest published scan's chain records.
- `pricingResiduals` -- calibration residual percentiles plus calibration
  and convergence failure counts from the latest scenario records.
- `watchlistCoverage` / `missingEvidence` -- all-25 coverage and per-reason
  missing-data counts from the premarket evidence for that trading date.
- `r2UncompressedBytes` -- the latest manifest's own recorded storage size.

Every value here is a count, a percentile, or one of the scanner's own reason
strings (`stale_contract_quote`, `zero_bid`, and so on, defined in
`chainGates.js`). None of it is a raw provider message, a stack trace, or a
credential -- see `sanitizeOperationsReport`, which also strips anything
secret-shaped as a second line of defense.

## Entitlement loss (401/403 from Alpaca)

**Symptom:** a stage's `stageTimings[].metrics.alpacaAvailable` is `false`,
or `chainQuality.rejectionReasons` is dominated by `alpaca_unavailable` /
`chain_fetch_unavailable`. `providerRequestCount` for that attempt will be
near zero -- the adapter failed at construction or on the first call, not
partway through a chain fetch.

**Where it comes from:** `createAlpacaOptionsAdapter` throwing (missing or
revoked `APCA-API-KEY-ID`/`APCA-API-SECRET-KEY`), or the adapter itself
returning `authentication` (401) / `missing_entitlement` (403) from
`alpaca.js`'s `requestJson`.

**Remediation:** verify the Alpaca credentials in the deployment environment
are current and still entitled to the data plan the scanner assumes
(`alpaca-basic-indicative`, `docs/research/options-alpaca-adapter.md`). A
credential rotation on Alpaca's side without updating the deployment is the
common cause. Confirm with `npm run options:alpaca:acceptance` against the
live credentials before assuming the scanner code regressed.

## Archive failure (R2 / Redis unavailable, lock lost)

**Symptom:** `stageTimings[].status` is `incomplete` or `late` with an
`errorCode`, or the stage never appears in `stageTimings` at all and
`scheduleHealth.missing` names it. A `503` from `POST /api/options-scan`
itself, logged with `category: 'schedule_storage_unavailable'`
(`api/options-scan.js`), is the same failure at the dispatch layer.

**Where it comes from:** `OptionsSchedulerUnavailableError` from
`scheduler.js` -- Redis quota exhaustion, a lost lease, or a checkpoint/
completion write racing another worker. `commitOptionsScan` in
`auditStore.js` additionally refuses to publish if the R2 write, the
manifest write, or the publish record's own consistency checks fail: a
half-written scan is never a published one.

**Remediation:** this already fails closed by design -- no duplicate
publication, no retry storm (`runBounded`'s concurrency cap, and the
scheduler's single lease token, prevent that structurally). Check Upstash
Redis's own dashboard for quota/command-budget exhaustion (the epic's
target is under 500 incremental commands/day; `stageTimings[].metrics.
redisCommandCount` shows what an actual attempt used against that). If R2 is
the failure, check the object store credentials/bucket the deployment
points at (`createObjectStore`, `src/server/research/objectStore.js`). Once
the underlying store recovers, the next scheduled trigger resumes from
`readOptionsStageCheckpoint` -- no manual replay is required.

## Stale feeds

**Symptom:** `chainQuality.quoteAgeMs`/`quoteSkewMs` percentiles trending up
toward the gate thresholds (30s contract age, 10s underlying age, 10s skew --
`OPTIONS_CHAIN_LIQUIDITY_POLICY` in `chainGates.js`), or
`rejectionReasons.stale_contract_quote` / `stale_underlying_quote` /
`quote_skew_exceeded` climbing as a share of the chain.

**Where it comes from:** provider-side data lag, or the stage running close
enough to its deadline that retries for a `series_not_yet_open` contract
never get a fresh quote before `deadlineAt`.

**Remediation:** if it is isolated to specific names, check whether that
security's chain genuinely just opened late that morning (normal, self-
resolving; the scanner's own retry-with-deadline handles it structurally).
If it is broad across the watchlist, suspect the provider feed itself is
lagging -- corroborate against `stageTimings[].metrics.provider429Count` /
`providerServerErrorCount` for the same attempt (see below) before treating
it as a feed-quality issue rather than a rate-limit issue wearing the same
symptom.

## Provider throttling (429s)

**Symptom:** `stageTimings[].metrics.provider429Count > 0`, especially
alongside `retriedCount` or `revalidationFailedCount` rising, or
`chainQuality.rejectionReasons.series_not_yet_open` (still pending when the
stage deadline arrived).

**Where it comes from:** Alpaca's own rate limit on the current plan tier;
`alpaca.js` already retries 429/5xx with backoff inside its own request
budget and deadline, so a nonzero count here is expected under load, not
automatically a fault -- it becomes actionable when it correlates with
`incomplete`/`late` stage outcomes.

**Remediation:** if this is a sustained pattern rather than an occasional
spike, the plan tier's request budget (`maxRequests`, `maxPages` in
`createAlpacaOptionsAdapter`) may be undersized for the current watchlist.
Confirm against Alpaca's published limits for the entitled plan before
raising the budget -- raising it without headroom on the provider side only
converts a 429 into a slower failure at the same ceiling.

## Quote-quality collapse (most or all contracts rejected)

**Symptom:** `chainQuality.contractsObserved` far below what
`watchlistCoverage.candidateCount` would suggest, or a scan publication with
`result: 'empty'` where prior days were not. Empty is a valid outcome on its
own (the epic is explicit about this); the runbook concern is a *change* in
the rejection mix, not the mere presence of rejections.

**Where it comes from:** check the shape of `chainQuality.rejectionReasons`
first -- a spike concentrated in one reason (`insufficient_open_interest`,
`spread_above_maximum`, `delta_outside_window`) points at genuine market
conditions (thin morning liquidity, a name gapping outside the .15-.60 delta
band) rather than a scanner defect. A spike spread evenly across freshness-
related reasons instead points back at Stale feeds or Provider throttling
above.

**Remediation:** do not loosen a gate to make the list non-empty -- the epic
is explicit that no rule is relaxed simply because output is empty. If the
rejection mix genuinely reflects the morning's liquidity, an empty or thin
result is the correct, honestly labeled output.

## Schedule drift

**Symptom:** `scheduleHealth.missing` names a stage/tradingDate, or
`stageTimings[].startedLatencyMs` (actual start minus `scheduledAt`) is
growing across recent attempts.

**Where it comes from:** QStash schedule drift, a Vercel deployment delay,
or the stage's own work routinely running close enough to `deadlineAt` that
`runOptionsScheduledStage`'s deadline race cuts it off before completion.

**Remediation:** `npm run options:schedule -- check` verifies the three options
QStash schedules are still configured as expected
(`docs/research/options-scheduler.md`). If schedules are correct but
`startedLatencyMs` is still elevated, the stage's own work is the bottleneck,
not dispatch -- check `stageTimings[].attempt` for repeated retries of the
same trading date, which is the signal that the deadline, not the trigger,
is the constraint.

## Kill-switch recovery

**Engaging it:** `SET research:options:kill:v1 <any value>` in Redis. Any
value disables new work; it does not delete checkpoints, leases, or audit
history (`docs/research/options-scheduler.md`).

**Symptom while engaged:** `killSwitchEngaged: true` in the operations
report, and dispatch attempts return `{ status: 'disabled' }` without
touching a lease or the archive.

**Recovery:** `DEL research:options:kill:v1`. The next scheduled trigger
resumes normally -- there is no separate "re-arm" step, and no queued work
to replay, because the switch prevented anything from starting in the first
place rather than pausing something mid-flight.
