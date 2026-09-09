# Research foundation: low-cost experiment

This deployment uses Vercel Hobby, Massive **Stocks Basic (free)**, Upstash Redis for indexes and structured records, and a private Cloudflare R2 **Standard** bucket for original SEC document bytes. No paid Massive plan is required. Existing research-model, social-provider and quote-provider usage is unchanged; this is not a claim that the entire application is free.

## Schedule and runtime

`vercel.json` schedules foundation ingestion at **04:00 UTC daily**, research at **07:00 UTC daily**, and performance tracking at 09:00 UTC. All three are daily Hobby-compatible expressions. The three-hour lead leaves room for Hobby's within-the-hour cron jitter and a five-minute function. Enable Fluid Compute on the Vercel project for the configured 300-second Hobby function limit. UTC times are fixed through daylight-saving changes.

Ingestion has a 240-second work budget, reserving the rest for unwinding requests and logging. A Redis lease prevents overlapping ingestion runs from racing over reference cursors. SEC requests use an identifying User-Agent, bounded timeouts and a 250ms minimum interval. Daily index progress is checkpointed, duplicate issuers are collapsed, and completed indexes are not downloaded again. Pending issuer jobs and filing cursors survive the next invocation.

**This is a bounded pilot, not a complete daily SEC crawl.** Each run attempts up to five issuer jobs, with up to three filings per job, including historical filings needed for comparability. Initial reference setup can span multiple daily runs. Monitor `pending`, `completed`, `errors`, `masterAsOf`, and `masterRefresh` in the ingestion response. A growing backlog means disclosure coverage is falling behind; the existing 14-day candidate eligibility window can exclude late-ingested filings. Do not interpret pilot results as full-market coverage. Ingestion admission comes from the SEC index, independent of social attention.

## Massive Basic reference cache

Set `MASSIVE_API_KEY` (preferred) or the existing `POLYGON_API_KEY`. The only reference endpoint is `/v3/reference/tickers`, filtered to active US common stocks, with 1,000 rows per page. It is included in Stocks Basic. Page requests are separated by at least 13 seconds, including retries. HTTP 429 respects numeric or HTTP-date `Retry-After`; without a usable header it backs off for a minute. Long waits defer to a later invocation rather than exhausting the function.

Reference builds have a 120-second budget. A Redis checkpoint keeps the original query date, normalized rows, sanitized next URL and cooldown. A later run resumes the same dated universe; only a complete fetch publishes a snapshot. No API key is persisted in pagination URLs. Foreign-host pagination and redirects are rejected.

Published masters have **no TTL**. Ingestion attempts a refresh after 30 days; nightly research only reads the newest available complete snapshot using an indexed lookup. A failed refresh retains the previous master and reports `masterRefresh.status = stale`; unfinished pagination reports `pending`. Without any complete master, ingestion/research returns 503 with an explicit bootstrap message; research does not silently fall back to attention-only discovery.

The monthly policy deliberately trades prompt IPO, delisting and symbol-change coverage for fewer requests. Historical snapshots stay intact. To request an earlier refresh, send an authenticated `POST /api/research-foundation` with JSON `{"refreshMaster":true}`. This still obeys Basic limits and resumes any unfinished build. Abandoned builds restart after seven days.

## Private document storage

Create a private R2 Standard bucket, leave public access off, and create an S3 API credential scoped to that bucket with Object Read & Write. No Worker or public domain is needed. Configure these server-side variables in Vercel:

- `RESEARCH_R2_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com`
- `RESEARCH_R2_BUCKET=<bucket-name>`
- `RESEARCH_R2_ACCESS_KEY_ID=<access-key-id>`
- `RESEARCH_R2_SECRET_ACCESS_KEY=<secret-access-key>`
- `SEC_USER_AGENT=<application-name> <monitored-contact-address>`
- `MASSIVE_API_KEY`, the existing Upstash URL/token, and `CRON_SECRET`.

The adapter uses `aws4fetch` for S3 signing with R2's `auto` region. It targets R2, not every S3-compatible service. No credential enters client code. Test initialization by invoking the authenticated ingestion route after deployment and inspecting its response; repository tests do not contact live services.

All document bodies (primary filings, complete submissions, exhibits, Company Facts snapshots and attention-source documents) are gzip objects under `research/documents/v1/<sha256>.gz`, keyed by the **original bytes'** SHA-256. Conditional PUT prevents overwrites. Redis retains only the blob pointer/size/hash, immutable document records, identity snapshots, extracted evidence and sorted indexes. New ingestion never writes document chunks to Redis. Repeated content reuses the existing pointer. Reads decompress and verify the original-byte checksum.

No document TTL or bucket expiry lifecycle is configured: the archive must exceed the 60-session horizon and support replay. Amendments keep distinct document IDs; first observation and public/extraction times remain separate. Configure bucket retention/backups if protection from operator deletion is needed. R2's Standard free allowance can help with the pilot, but storage growth is unbounded by design and excess usage is billed; watch bucket usage instead of assuming it stays free.

## Migrating an existing Redis archive

Existing chunked documents remain readable until migrated. From a trusted local shell with server credentials in an env file:

```sh
node --env-file=.env.local scripts/migrate-research-blobs.js --offset=0 --limit=100
```

Each document is uploaded, read back from R2, decompressed and checksum-verified **before** its Redis pointer is changed. Document IDs, metadata, indexes and timestamps remain unchanged. The default keeps legacy chunks. Inspect the summary and use `nextOffset` for the next batch until `complete` is true. Re-running a failed batch with the same offset is safe. Run against a quiet ingestion window so sorted-index offsets stay stable; rescan from zero afterward if ingestion overlapped.

To reclaim Redis storage after verifying the destination, rerun batches with:

```sh
node --env-file=.env.local scripts/migrate-research-blobs.js --offset=0 --limit=100 --delete-redis-chunks
```

This verifies the R2 object again before deleting the legacy chunks. Failed reads/checksums leave the source intact. Missing object-store configuration or write failures stop new document publication; there is no large-blob fallback to Redis. The migration is provided here, not run against production by this PR.

## Acceptance and sources

`src/server/research/foundation.test.js` still proves #113 end-to-end: SEC filing → archived original → reserved non-attention slot → quote for `QUIET` → detailed reviewer sees zero attention → published 20/60-session picks with zero social mentions. Additional tests cover Basic pacing/cooldown, cross-run pagination, stale cache, conditional object writes and verified legacy migration.

Provider references (checked September 2026): [Vercel cron limits](https://vercel.com/docs/cron-jobs/usage-and-pricing), [Vercel function duration](https://vercel.com/docs/functions/configuring-functions/duration), [Massive All Tickers plan access and pagination](https://massive.com/docs/rest/stocks/tickers/all-tickers), [Massive API rate limits](https://massive.com/knowledge-base/article/what-is-the-request-limit-for-massives-restful-apis), [R2 pricing](https://developers.cloudflare.com/r2/pricing/), [R2 S3 conditional operations](https://developers.cloudflare.com/r2/api/s3/api/), [Cloudflare aws4fetch example](https://developers.cloudflare.com/r2/examples/aws/aws4fetch/).
