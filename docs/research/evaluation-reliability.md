# Evaluation operations

The evaluation reviews use the existing `OPENAI_API_KEY` and
`OPENAI_RESEARCH_MODEL` configuration. Baseline ranking, risk review, catalyst
verification and neutral review all use OpenAI. This does not require Anthropic
credits. Responses use the existing [Structured Outputs integration](https://developers.openai.com/api/docs/guides/structured-outputs).

`frozen/` remains checksum-locked. `evaluationBaseline.js` copies its prompt and
input formatting and calls the frozen selection/scoring functions. New decisions
append `openai-v2-<model>` to their arm version. Historical Anthropic and new
OpenAI outcomes are displayed in separate cohorts; a provider switch is not
treated as the same baseline. The study periods and execution rules stay fixed.

A failed required review fails the job before observations are published. The
existing queue retries up to three attempts. Persisted per-job run indexes let a
retry finish delivery/status recording without running another model review.
Recovery decisions use the actual new review time; prior delivered observations
are not duplicated or given a new entry time.

The owner API reads `research:evaluation:summary:v2`, refreshed by evaluation
and performance tracking. It overlays the current job status from small metadata
records. It returns aggregate results only. Older summaries are kept during an
outage and labeled stale after 36 hours; a verified owner can retry a failed load.

After deploying this change, run:

```sh
node --env-file=.env scripts/repair-research-evaluation.mjs
```

This adds an accepted-outcome index to the historical records and warms the
summary. It preserves all underlying decisions and outcomes. The completion
marker is written only after the historical scan succeeds; older installations
fall back to reading the original outcome index until then. New tracking writes
maintain both indexes. Add `--retry-latest` to explicitly requeue the latest failed
job, including an older job that was marked completed despite review failures.
Then invoke the authenticated `/api/research-evaluation` cron or let its schedule
process the job. The script is safe to repeat.

Missing market data is not a successful allocation: volume, price, identity
and sector gates remain in force. The constrained portfolio (`constrained-v2`)
checks the buy/sell spread only when one is known: the review runs overnight,
and on the free data plans (Yahoo quotes, free Polygon) no source has a
two-sided quote then. Sectors come from free Polygon company details (SIC code
mapped by `sectors.js`, `sic-division-v1`), looked up only for the candidates
the shared review accepted and archived per security so each is fetched once. A rejected stock or a pending
20-session outcome is not itself a pipeline failure. Quote requests are batched
at the adapter's 100-symbol limit, and supplied volume/bid/ask fields are retained.
