# Options morning scheduler

Story #207 uses the existing Vercel function deployment for execution and Upstash QStash for the two precise triggers. Vercel Hobby cron is deliberately not used: its daily jobs may arrive at any point in the configured hour, outside the scanner's four-minute opening window.

The free validation schedule uses two of QStash Free's ten active schedules and two of its 1,000 daily messages:

- `CRON_TZ=America/New_York 15 9 * * 1-5` dispatches the premarket freeze. The handler accepts premarket work from 08:00 through 09:20 ET and labels anything later as missed.
- `CRON_TZ=America/New_York 31 9 * * 1-5` dispatches the opening scan. The handler accepts opening work from 09:31 through 09:35 ET.

The versioned Cboe calendar still rejects holidays and handles early-close dates. The timezone schedule handles DST directly; server-side ET guards remain authoritative.

## Deployment

Set `QSTASH_TOKEN`, `CRON_SECRET`, and `OPTIONS_SCAN_BASE_URL` in the operator shell. `OPTIONS_SCAN_BASE_URL` is the production origin, such as `https://example.com`. Then run:

```sh
npm run options:schedule -- apply
npm run options:schedule -- check
```

Set `OPTIONS_SCANNER_ENABLED=true` only when the stage worker for that story is installed. The default is disabled. The Redis key `research:options:kill:v1` is the runtime kill switch; any value disables new work without deleting checkpoints or audit history.

`remove` deletes the two QStash schedules. It does not delete Redis state or R2 audit records:

```sh
npm run options:schedule -- remove
```

## Runtime guarantees

The logical key is trading date, stage, and policy version. Each finite lease receives a monotonically increasing fence. Checkpoint and completion writes compare the active lease token atomically, so a worker whose lease expired cannot overwrite a replacement worker. Completed logical stages deduplicate later deliveries.

Incomplete attempts preserve a cursor and release the lease for a retry. Work receives a deadline and bounded concurrency. A start after the scanner deadline is archived as missed; completion after it is archived as late and is never published as the on-time result. Redis failure prevents work from starting.

The dispatcher stores a hash reference for the external request ID. It does not archive cron credentials, provider tokens, or raw error messages.

## Function inventory

The repository had eleven production functions before this story. It adds one mode-dispatch function, `api/options-scan.js`, for both stages, reaching the existing twelve-function Hobby limit. It does not add one handler per stage and does not introduce a Redis polling loop.

Sources checked for the Phase 0 decision: [QStash schedules and timezone support](https://upstash.com/docs/qstash/features/schedules), [QStash pricing](https://upstash.com/pricing/qstash), and [Vercel cron limits](https://vercel.com/docs/cron-jobs/usage-and-pricing).
