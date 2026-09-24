# Scheduled jobs (Upstash QStash)

Every scheduled WallAI job is triggered by an Upstash QStash schedule. QStash only decides *when* a job runs. The existing Vercel API routes still do all of the work under the same `CRON_SECRET` check, with the same 300-second `maxDuration`.

Vercel Hobby cron is no longer used. Its daily jobs fire anywhere inside the declared hour, and `vercel.json` has no `crons` entry, so nothing can be triggered twice.

## Schedules

The catalog lives in `src/server/qstashSchedules.js`. Research times come from `RESEARCH_SCHEDULES` in `src/server/research/scheduleHealth.js`, which is also what the `/research/logs` schedule-health check reads. Options times come from the options scheduler and forward-capture policies.

| Schedule id | Cron | Request | Retries |
|---|---|---|---|
| `wallai-options-premarket-v1` | `CRON_TZ=America/New_York 15 9 * * 1-5` | POST `/api/options-scan?mode=premarket` | 2, 30s apart |
| `wallai-options-opening-v1` | `CRON_TZ=America/New_York 31 9 * * 1-5` | POST `/api/options-scan?mode=opening` | 2, 30s apart |
| `wallai-options-observe-v1` | `CRON_TZ=America/New_York * 9-15 * * 1-5` | POST `/api/options-scan?mode=observe` | 0 |
| `wallai-research-foundation-v1` | `CRON_TZ=UTC 0 1,4,10,13,16,19,22 * * *` | GET `/api/research-foundation` | 0 |
| `wallai-nightly-research-v1` | `CRON_TZ=UTC 0 7 * * *` | GET `/api/nightly-research` | 0 |
| `wallai-research-reports-v1` | `CRON_TZ=UTC 0,15,30,45 9 * * *` | GET `/api/nightly-research?mode=reports` | 0 |
| `wallai-track-performance-v1` | `CRON_TZ=UTC 0 9 * * *` | GET `/api/track-performance` | 0 |
| `wallai-research-evaluation-v1` | `CRON_TZ=UTC 0 11 * * *` | GET `/api/research-evaluation` | 0 |

**Time zones.** The research jobs keep the exact UTC times they had as Vercel crons, so in New York they move by an hour when daylight saving starts or ends, just as before. The options jobs are defined in `America/New_York`, and QStash applies DST to them. Every cron names its zone explicitly, and a test enforces this.

**Why the research jobs look the way they do:**

- **GET with no body, and no retries.** That is exactly how Vercel cron called them. A retried nightly run would publish a second board. The other jobs already pick up whatever a failed run left behind on their next slot.
- **One foundation schedule for seven hours.** QStash Free allows 10 active schedules. The catalog uses 8.
- **Reports as `?mode=reports`.** Vercel identified the 09:00 run by its `x-vercel-cron-schedule` header, which QStash does not send.
- **Reports four times an hour.** Reports are written one at a time, because three concurrent web-search reports exceeded OpenAI's 200k tokens-per-minute limit, and eight don't fit one 300s run. Each of the 09:00, 09:15, 09:30 and 09:45 runs resumes whatever is still pending, including earlier failures; once none are pending, a run exits straight away.

**Delivery settings:**

- **Timeout.** Every schedule has `Upstash-Timeout: 300s`, the same as the functions' `maxDuration`. QStash waits that long; it does not let a function run longer.
- **Authentication.** QStash forwards `Authorization: Bearer $CRON_SECRET` (via `Upstash-Forward-Authorization`). It is redacted with `Upstash-Redact-Fields: header[Authorization]`, so the QStash console and API show `REDACTED:<sha256>` rather than the secret. Deliveries still carry the real value.

**Message budget.** About 436 of QStash Free's 1,000 daily messages on a weekday (420 of them are observe ticks) and 14 at weekends. Every delivery attempt, including retries, counts as a message.

## Environment

Set these in the operator shell only. Never commit them or write them to a file in the repository.

| Variable | Needed for | Value |
|---|---|---|
| `QSTASH_TOKEN` | all commands | The QStash token from the Upstash console |
| `CRON_SECRET` | `apply`; optional for `check` | The same value as Vercel production's `CRON_SECRET` |
| `SCHEDULE_BASE_URL` | all commands | The production origin, e.g. `https://example.com`, with no path. `OPTIONS_SCAN_BASE_URL` and `VERCEL_PROJECT_PRODUCTION_URL` are read as fallbacks |
| `QSTASH_URL` | optional | The regional QStash API origin, if the token belongs to one. Defaults to `https://qstash.upstash.io` |

To keep the secrets out of shell history:

```sh
read -rs QSTASH_TOKEN && export QSTASH_TOKEN
read -rs CRON_SECRET && export CRON_SECRET
export SCHEDULE_BASE_URL=https://<production-domain>
```

## Commands

```sh
npm run schedule -- check                  # read-only; exits 1 if anything is missing or different
npm run schedule -- apply --dry-run        # print the exact requests, CRON_SECRET masked; sends nothing
npm run schedule -- apply                  # create or update every schedule in place
npm run schedule -- remove                 # list what would be deleted
npm run schedule -- remove --yes           # delete them
```

Add `--only options`, `--only research`, a job name (`--only nightly-research`) or a schedule id to act on a subset. `npm run options:schedule -- <command>` is the same as `--only options`.

**What makes each command safe:**

- **`apply` is an upsert.** Each request carries `Upstash-Schedule-Id`, so re-running it updates the existing schedule instead of creating a second one.
- **`apply` checks the schedule limit before writing.** It first lists the account and changes nothing if the result would exceed 10 active schedules. Pass `--schedule-limit <n>` on a larger plan.
- **A failed schedule doesn't stop the rest.** `apply` reports the failure and carries on with the others, and exits 1. Re-running is safe.
- **`remove` deletes only catalog ids, and only with `--yes`.** A schedule that is already gone is reported, not treated as an error.
- **`check` verifies every setting it can read back.** That covers cron, destination, method, retries, retry delay, paused state, and whether the forwarded Authorization matches `CRON_SECRET`. It compares the redacted hash, so the secret is never displayed. It also prints each schedule's next run in UTC and New York, and lists any other `wallai-*` schedules without touching them. QStash does not report the timeout back, so `check` cannot verify it.
- **Errors show the cause without the secrets.** A QStash error prints the HTTP status and QStash's own message, with anything resembling the token or `CRON_SECRET` replaced by `[redacted]`.

After rotating `CRON_SECRET` in Vercel, run `apply` again with the new value. Until then, every scheduled call gets a 401.

## Cutover from Vercel cron

Deploying this change removes the Vercel crons, and `apply` installs their replacements. Do both within a few minutes of each other, **outside 07:00–08:00 UTC**:

- An overlap there could run `nightly-research` twice, and a second completed run republishes picks.
- An overlap at any other time only doubles a job that tolerates it: foundation ingestion has a lease, reports and evaluation skip work that is already done, and performance tracking is idempotent.
- A gap only loses the runs that fall inside it.

1. Merge and let Vercel deploy. Confirm in the Vercel dashboard (Settings → Cron Jobs) that no cron jobs remain.
2. `npm run schedule -- check`, `npm run schedule -- apply`, then `npm run schedule -- check` again. It should report `8/8 expected schedules installed and matching`.
3. After the next slot, confirm the run appears in `/research/logs` and in the QStash console's logs as a 2xx.

**Rolling back:** restore the `crons` block in `vercel.json`, the reports header check in `api/nightly-research.js`, and the tests from this change. Deploy, then run `npm run schedule -- remove --only research --yes`.
