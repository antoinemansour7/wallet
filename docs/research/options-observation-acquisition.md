# Options historical observations and forward capture

Story #213 adds the evidence-acquisition boundary for later options evaluation. It does not claim that the score is predictive, purchase a data plan, synthesize missing history, or place orders.

## Coverage and replay rules

`src/server/options/observations.js` creates one immutable coverage record per trading date and issuer-bound ticker identity. Every required field is exactly one of `observed`, `reconstructed`, or `missing`. Observations retain the requested date, market time, publication time, acquisition time and source checksum. A value from the wrong date or published after the historical freeze is retained but has `replayEligible=false`; this prevents current IV/Greeks/OI and revised event dates from silently entering an earlier scan.

`replayCoverageDecision` produces one of three explicit modes:

- `point_in_time_replay` only when all required fields were observed and eligible at the freeze;
- `restricted_replay` when a declared reconstruction is required;
- `forward_only` when evidence is missing or only retrospectively available.

No mode other than `point_in_time_replay` permits a full historical-coverage claim.

Historical contract versions bind provider and normalized IDs to security and issuer IDs over a validity interval. Expired, delisted, halted and adjusted contracts remain representable. Adjusted deliverables retain their actual components and corporate-action IDs instead of rebasing an old strike against a split-adjusted stock chart. A contract is eligible only if exactly one version covers the historical scan time.

## Acquisition and retention

Observation batches are content-addressed `options-observation-v1` audit records. They retain sanitized request provenance, parameters checksum, exact provider-body checksum, normalized checksum, record byte count and original observation timestamps. The archive remains append-only and R2-backed through the existing options audit store.

The Phase 0 `alpaca-basic-indicative` policy permits normalized owner-only research retention but not raw provider payload retention. A raw payload is rejected before archival. The `test-fixture` license exists only for reproducible automated validation. Before enabling another provider or audience, add an explicit reviewed license policy; unknown licenses fail closed.

Historical and forward work use separate daily request/byte/concurrency limits. The acquisition runner rejects the `opening` pool, checkpoints after each immutable batch, deduplicates stable job IDs, and resumes without refetching completed jobs. Historical work therefore cannot consume the opening scanner's reserved budget.

Historical jobs also reject endpoints identified as `latest` or `snapshot`; those endpoints may support forward capture but cannot establish a past chain.

## Outcome schedule

Each selected morning contract now receives an archived forward-capture plan. It includes same-day close and +1/+3/+5/+10 open-session endpoints, expiry close, and five-minute regular-session path samples through the earlier of expiry or +10 sessions. Holidays and early closes come from the versioned options calendar. Endpoints after expiry are explicit unavailable rows rather than dropped rows.

`outcomeAcquisitionJobs` converts a plan into deduplicated option/underlying observation jobs. Sampling resolution and the limitation that unsampled maxima or ITM crossings remain unknown are stored with every plan. This story captures evidence; return/cost/holdout evaluation belongs to #214.

## Reproducible validation

`observations.test.js` covers:

- a normal week and exchange holiday;
- an earnings-tagged cohort;
- an expired contract and expiry follow-through;
- an adjusted deliverable/corporate action;
- issuer-safe historical availability;
- late current OI rejected for historical replay;
- an interrupted run resumed with exact request, byte and record counts;
- duplicate jobs and opening-budget isolation;
- retention denial for unlicensed raw payloads.

Run:

```sh
npm test -- --run src/server/options/observations.test.js
```
