# Options reference foundation

Story #203 introduces reference primitives only. It does not fetch live chains, rank contracts, schedule scans, expose an API route, or place orders.

## Identity

`src/server/options/watchlist.js` contains the dated 25-symbol Cboe snapshot and internal issuer/security IDs. The IDs bind a ticker observation to the intended issuer and share class; later refreshes create a new immutable snapshot rather than rewriting the old mapping. `createOptionsIdentityRegistry` resolves from the latest snapshot that was available at the requested time, so a later ticker reuse cannot leak into an earlier replay.

The `AVGOVST` and `AMZ` corrections require `allowContextualCorrections: true`. Generic callers reject them. SPCX has an explicit SpaceX validity boundary and must never join to an older instrument that used the symbol.

`createOptionsIdentitySnapshot` is the provider-neutral refresh boundary for new listings, renames, splits and other corporate-action metadata. The later market-data adapter should create dated source evidence and archive the resulting snapshot. It must not edit the seed snapshot.

## Sessions and eligibility

`src/server/options/calendar.js` stores the 2026 Cboe equity-options calendar in `America/New_York`, including full holidays and 13:00 ET early closes. UTC conversion is derived from the time zone so both daylight-saving transitions work without fixed offsets.

Class eligibility, calendar openness and individual-series state are independent:

- the retrieved Cboe directory marks all 25 classes as GTH/curb ineligible;
- nine symbols are recorded separately as announced candidates;
- reaching the planned date sets `refreshRequired`; it never changes a class to eligible automatically;
- the 09:25–09:30 ET GTH/RTH transition is always non-executable;
- a regular session can be open while a particular series is `not_open` or `halted`.

The calendar fails closed outside 2026. Add a newly sourced snapshot before using another year.

## Contracts

`src/server/options/contracts.js` parses OSI symbols and requires a resolved issuer/security identity. V1 accepts active, tradable, standard American contracts with a 100-share deliverable. Adjusted contracts, inconsistent roots/expirations/strikes and identity mismatches are retained as structured rejections.

Last trading time comes from the versioned calendar, including early closes. A contract enumeration defaults to incomplete. Only a pagination-complete enumeration can satisfy `listedContract`; option-class existence or one provider page is insufficient.

## Replay

`src/server/options/reference.js` bundles watchlist, eligibility, calendar and contract enumerations into a content-addressed reference snapshot. `archiveOptionsReference` uses the existing append-only research archive and `replayOptionsReference` selects the latest bundle available at the requested historical timestamp.
