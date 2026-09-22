# Options audit storage

Story #204 adds the durable evidence boundary for the options scanner. It does not fetch a live chain, rank or publish opportunities, add user-facing screens, or place orders.

## Audit envelopes

`src/server/options/audit.js` defines separate, versioned records for scan state, source evidence, option chains, decisions, scores, scenarios, outcomes, policies and diagnostics. Every record includes:

- a content-derived record ID and byte count;
- the scan ID and record-specific schema version;
- provider, feed, market session and entitlement lineage;
- code, model and policy versions;
- hashes of upstream inputs;
- per-field market, public, available and fetch times when the source supplies them;
- explicit reasons for every retained null value;
- the applicable license and retention lifecycle.

Provider nanosecond values remain decimal strings so JavaScript cannot round them. Chain records preserve both provider and normalized contract IDs, normalized issuer/security identity, the prefilter manifest, accepted contracts and structured rejections. A non-null open-interest value requires its provider as-of date.

Raw provider responses are excluded by the default Alpaca free-data retention policy. Adapters must normalize data before creating an envelope. The policy expires Redis indexes before the normalized object reaches its review date; it records the lifecycle obligation for a later cleanup worker without silently deleting audit evidence during a scan.

## Publication and storage

`src/server/options/auditStore.js` writes one immutable archive object per record type and scan batch. Large normalized records are gzip-compressed in private R2, while Redis keeps small pointers, indexes, a compact manifest and one latest pointer. Redis command count therefore grows with record batches, not the number of option contracts.

Publication follows this order:

1. Verify ownership of the scan lock.
2. Validate and archive every immutable record batch.
3. Archive the scan manifest.
4. Atomically verify the lock again and update the latest pointer.

An R2 write, Redis pointer/index write, or lost lock stops publication. A retry with the same record ID and bytes is idempotent. Reusing an immutable ID for different bytes raises `ARCHIVE_CONFLICT`. Failures can leave unreachable immutable objects, but they cannot make a partial scan current.

## Private reads

The existing `/api/get-research` function dispatches `?optionsAudit=1` to `src/server/options/auditApi.js`. It verifies the configured owner before creating a Redis or archive client. Responses set `Cache-Control: private, no-store` and `Vary: Authorization`.

With no record arguments, the endpoint returns the current manifest. Supplying an allowlisted `recordType` and a SHA-256-shaped `recordId` returns that immutable batch. Storage failures return a generated reference ID to the client and keep provider, quota and infrastructure details in server logs.
