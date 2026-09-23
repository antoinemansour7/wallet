# Options research workspace (#216)

The account menu exposes **Options** only to the confirmed research owner. `/options`
and `/options/operations` load independently of Research and Portfolio. Both pages
verify ownership before rendering their titles; every API read and detail refresh
also goes through the existing server-side `verifyOwner` gate and private/no-store
headers. No orders, subscriptions, alerts, or scanner dispatch controls are added.

## Frozen morning and read paths

`GET /api/get-research?optionsAudit=1&view=research` projects the latest immutable
manifest into compact candidate rows. The first successful read pins its manifest
in `/options?morning=<manifest digest>`. Reloading this URL reads that same morning,
including after another scan is published. **Latest morning** explicitly resolves
the current pointer. Prior-session records are labeled archived and are never
presented as today's candidates.

Appending `manifestId` and `contractId` to the research API returns the archived
scenario matrix, score trace, contract, chain comparison, and lineage. These are
loaded when a disclosure first opens. The contract quote comes from the selected
publication's `revalidation.chainRecordId`, not the initial prevalidation chain.
Missing final evidence remains unavailable; it never falls back to an older quote
or an initial ranking scenario. The published full scenario matrix is required.

Opening detail also requests a separate observation with `POST` to the same API,
using `{ manifestId, contractId }`. This pins the existing immutable refresh API
to the reviewed morning instead of the latest pointer. A later observation has its
own archive record, market timestamp, retrieval timestamp and gate status; it
never replaces the morning quote, score or scenarios. Failed reloads and refreshes
retain the displayed morning, with a concise error. Raw response error strings
are not rendered. `/options/operations` reads `view=operations` for the sanitized
administrative report.

## Numerical display conventions

- The initial scenario is always the archived **+5% call / −5% put move, three
  trading sessions, unchanged IV**. It is a fixed display policy, not selection
  of the best-return cell or an expected outcome.
- Headline returns use the archived ask-entry/modeled-bid-exit result, including
  the archived fees. The worst conservative return across the entire archived
  matrix and total premium/costs at risk appear alongside it.
- Observed quotes and modeled values have separate labels and visual treatments.
  Prices are USD per share; risk is per contract. Quote time is distinct from
  publication and fetch time, displayed with date, seconds and ET zone.
- Details show idealized midpoint returns separately, exact calendar elapsed time,
  remaining time, starting/ending IV, time-only repricing, relative IV-down cases,
  and premium targets. Premium-target inversion is midpoint-relative, as stored
  by the engine; it is not labeled an ask-to-bid target.
- A gain-while-OTM label requires a positive **conservative** return and call spot
  below strike / put spot above strike. A positive midpoint return alone does
  not qualify.
- Freshness expires on a local timer without polling or rewriting evidence.
  Market close uses the server's versioned session close, including early closes.
  Theoretical, delayed, live-at-scan, stale, partial, closed, valid-empty and
  unavailable labels remain distinct; coverage and original observation mode
  remain visible even when freshness expires.

## Validation

`npm run options:ui:review` starts a temporary fixture-only Vite server, intercepts
all API requests, and runs Chromium against the production page components and
styles. It writes screenshots to the printed temporary directory and checks
320/390/768/1440px widths, light/dark themes, independently keyboard-operated
native disclosures, IV filtering, all eight availability states, reload failures,
and denied direct links. No real provider, Redis, R2, or auth requests are made.

The shared synthetic fixture is built with the production scenario/scoring engines
and wrapped in immutable audit records. Regression tests compare the displayed
numbers against those records, including calls/puts, costs, loss cases, final
quote revisions, missing evidence, ownership changes and refresh pinning. This
validates rendering and evidence fidelity, not live feed entitlements or pricing
model profitability.
