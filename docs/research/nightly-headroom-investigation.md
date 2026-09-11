# Nightly headroom investigation (issue #172, Part B)

## Method

Ran `scripts/nightly-runtime-percentiles.mjs` against the `research:runs:v1`
history (`src/server/research/observability.js`), which records every
`nightly-research` invocation's total duration and per-stage durations.

The script ran successfully against real production Redis data (real
`UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN` credentials in this
repo's `.env`; no credential values are reproduced in this document or were
printed beyond the script's own JSON statistics output).

## Findings

- Sample size: **1** nightly-research run recorded in `research:runs:v1`.
  This is far below the ~10-run threshold this investigation set as the
  minimum for a meaningful sample. The numbers below are the actual output
  of the script, but with a sample of one they are not real percentiles —
  they are just that single run's measurements, and cannot be used to infer
  a distribution, tail behavior, or provider-latency variance.
- Total runtime: p50 = 242.4s, p90 = 242.4s, p95 = 242.4s, max = 242.4s (all
  identical because there is only one data point: 242,399ms).
- Runs exceeding 250s / 260s / 270s: 0 / 0 / 0 out of 1.
- Degraded (non-`success` status) runs: **1 out of 1** — the only run on
  record did not finish with `success` status.
- Slowest stages by p90 (again, single-run values, not true percentiles):
  `claude_review` 102.5s, `report_generation` 58.9s,
  `catalyst_verification` 40.5s, `x_discovery` 35.3s, `contrarian_review`
  23.9s, `exa_discovery` 4.2s, `news_discovery` 0.16s, `slack_alerts` 0.14s.

## Recommendation

The available data is insufficient to justify spending any freed headroom on
new work. With only one recorded `nightly-research` run — and that one run
degraded (non-`success`) rather than a clean success — there is no basis for
estimating p95 total runtime, tail risk, or provider-latency variance across
nights. Per this investigation's own decision rule, an insufficient sample
defaults to the conservative recommendation:

> Do not add work yet; there is not enough recorded run history to establish
> a reliable p95 nightly runtime (only one run, itself degraded, is on
> record). The headroom freed by moving evaluation out should be left as
> safety margin for slow provider nights and persistence/finalization, not
> spent on new research-quality work, until enough successful nightly runs
> have accumulated in `research:runs:v1` to support a real percentile
> analysis.

## Guardrails honored

- No change was made to the 30-candidate review budget (`policy.js`
  `STRATEGIES`) — that remains issue #171's scope.
- No change was made to the six-arm experiment definitions, frozen baseline,
  horizons, or delivered-vs-shadow semantics (`evaluation.js`,
  `evaluationPolicy.js`, `frozen/*`).
- This document is a recommendation only; issue #166 (richer X context) is
  implemented, if at all, as its own separately reviewed change.
