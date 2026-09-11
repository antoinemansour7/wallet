# Evaluation cron scheduling — implementation notes

## Vercel Hobby constraints (confirmed, as of this change)

- Up to 100 cron jobs per project.
- Each Hobby cron schedule runs **at most once per day**.
- Hobby cron timing has **hour-level precision**, not guaranteed minute
  precision — a job scheduled for `0 11 * * *` may fire anywhere within the
  11:00–11:59 UTC window, not necessarily at :00.
- Vercel Functions on Hobby have a **300-second maximum duration**.
- Standalone Vercel Functions on Hobby are limited to **12 functions per
  deployment**. This project remains at 12 by mounting research history on the
  existing `/api/get-research` function; `/api/get-research-history` is kept as
  a compatibility rewrite and does not create another function.
- None of the above requires a Vercel Pro upgrade; this project stays on
  Hobby.

## Current cron table (UTC)

| Hour | Path | Purpose |
|------|------|---------|
| 1, 4, 10, 13, 16, 19, 22 | `/api/research-foundation` | SEC ingestion / durable evidence |
| 7 | `/api/nightly-research` | Discovery, admission, review, publication, evaluation-input freeze |
| 9 | `/api/track-performance` | 5/20-session outcome tracking |
| 11 | `/api/research-evaluation` | Six-arm evaluation review of frozen packets (new) |

## Why hour 11

`nightly-research` starts somewhere in the 7:00–7:59 window and can run up to
300s, so in the worst case it is still finishing around 8:04. `research-evaluation`
is scheduled four hours later, at 11:00–11:59, so even full-hour drift on both
jobs cannot bring them close to overlapping. Hour 8 (immediately after
nightly-research) was considered and rejected for having a materially tighter
margin against documented drift.

Exact timing is not safety-critical to correctness, only to promptness: the
evaluation job queue (`evaluation-job-input` + `evaluation-job-status` in
`src/server/research/evaluationJob.js`) is durable and idempotent, so if
`research-evaluation` ever ran before a given night's packet was frozen, or
missed a day entirely, the packet simply stays `pending` and is picked up the
next time the cron runs — no data is lost, and no duplicate observations are
created. Hour 11 is chosen for comfortable safety margin, not because a
tighter schedule would be unsafe.

`track-performance` (hour 9) can run before that night's `research-evaluation`
(hour 11) has produced an `evaluation-run` record yet. This is fine:
`trackEvaluation` (`src/server/research/evaluationPerformance.js`) processes
whatever `evaluation-run` records already exist and is idempotent per
observation/horizon — it simply picks up a newly created run's observations
on its next invocation.
