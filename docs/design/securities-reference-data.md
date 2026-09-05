# Securities reference data — sources and integration

Design for [#88](https://github.com/antoinemansour7/wallet/issues/88), which asks to replace two stopgaps in `withholdingTax.js` (#17): a curated ~35-ticker fund list, and an assumed 1.3% yield for every holding.

There is no single documented, free API that answers "what does this fund hold" or "what is this ticker's ISIN." Before designing anything, three live sources were tested directly rather than assumed from memory or training data:

## What's actually available

**Yield — from real dividend history, not a new endpoint.** The chart endpoint this app already calls unauthenticated (`v8/finance/chart`, used today for prices in `yahooQuotes.js`) accepts `events=div` and returns real historical dividend payments with dates and amounts. Confirmed live against `KO`. Summing the trailing 12 months and dividing by current price gives a measured trailing yield — no new dependency, no auth.

The alternative, `summaryDetail.dividendYield` via `quoteSummary`, was tested first and rejected: it requires an undocumented crumb/cookie handshake Yahoo added to block unauthenticated access, and came back **empty** for both `XEQT.TO` and `VTI` even though the same field populated correctly for `KO`. An endpoint that silently returns nothing for some securities and needs a workaround for all of them is worse than one this codebase already trusts.

**Exchange and country — also from the existing endpoint.** The same chart call's `meta` object carries `exchangeName`, `fullExchangeName`, and `currency` (confirmed: `XEQT.TO` → `"TOR"` / `"Toronto"` / `"CAD"`). No new call needed for this at all.

**Fund composition — real, but genuinely fragile.** `topHoldings` via `quoteSummary` does return a fund's actual constituent holdings with weights — confirmed live: `XEQT.TO`'s top five holdings are `XTOT.TO` (29%), `XIC.TO` (25%, Canadian), `XEF.TO` (25%), `ITOT` (16%), `XEC.TO` (5%). That is a real, self-updating foreign-equity signal, strictly better than a hand-maintained list — but it requires the same undocumented crumb workaround, which Yahoo could change or block without notice.

**Identifiers for statement imports — FIGI, not ISIN.** Plaid already supplies ISIN/CUSIP for connected accounts (used since #86). Statement imports have neither, and nothing free maps a bare ticker to an ISIN. OpenFIGI does map ticker+exchange to a FIGI — confirmed live: `XEQT` on exchange code `CT` resolves to `BBG00PPX3Y33`. A FIGI is a different identifier family than ISIN, but it serves the identical purpose in `resolveSecurityKey`'s pooling join: a real, globally unique identifier for one security, as opposed to a symbol that collides across exchanges and listings.

## Decisions

**1. Two confidence tiers, not one data source.** Yield and exchange/country ride on the endpoint this app already depends on for prices — if that breaks, price refresh breaks too, so it is already load-bearing and already monitored. Fund composition and FIGI lookup ride on endpoints this app has never called before, each with its own failure mode (an undocumented auth handshake; a public API's anonymous rate limit). Both new calls degrade to exactly what happens today — `UNKNOWN`, or the symbol-fallback key — rather than to an error. Nothing here is allowed to make the app worse than the stopgap it replaces.

**2. `classifyHolding` and `resolveSecurityKey` gain an optional hint, not an async rewrite.** `projectWithholding` already accepts injectable `assumptions.yieldPct` — the natural integration is a caller resolving a real yield and handing it in, not `projectWithholding` itself reaching across the network. Same principle for fund classification: `classifyHolding(row, { fundExposureHint })` accepts a pre-resolved verdict and only falls back to the hardcoded sets when none is supplied. Every existing test in `withholdingTax.test.js` keeps passing unchanged, because the hardcoded fallback is still there — the tests exercise the sync, hint-free path throughout, deliberately, since they should not depend on network access to prove the rule engine's logic is right.

**3. Foreign-equity classification reasons from holdings, not from a maintained list.** Instead of enumerating "known foreign funds" (unbounded, always stale) and "known domestic funds" (small, stable) as before, the domestic list is kept — pure-Canadian-equity index funds are a genuinely small, slow-changing set — and *any* holding in a fund's `topHoldings` that is not on that list counts as foreign exposure. This generalizes to funds never seen before, which is the entire point: `withholdingTax.js`'s hardcoded list was "blind to everything else."

**4. Cached hard, because none of this changes quickly.** A trailing yield is meaningful to a day's precision at most; exchange, composition, and identifiers change on the order of months or never. Followed the Redis pattern already used three times this session (`quoteCache.js`, `portfolioSeries.js`, `historicalFxCache.js`) — `null` when Redis isn't configured, so a deployment with nothing set up still works, just refetches every time.

## What this does not solve

A real ISIN for a statement-imported security. FIGI is the closest free substitute and is a real identifier, not a guess — but it is not the identifier Plaid supplies for connected accounts, so a security seen through both paths could, in principle, resolve to two different (both correct) identifiers rather than pooling on one. Out of scope here; worth its own issue if it turns out to matter in practice.

## Where

- New module: `src/server/securitiesReference.js` — dividend/yield parsing, exchange extraction, fund-composition classification, FIGI lookup, all as pure functions over already-fetched data, with thin IO wrappers around each live call
- New module: `src/server/securitiesReferenceCache.js` — the Redis wrapper
- `src/utils/withholdingTax.js` — `classifyHolding` and `projectWithholding` gain optional hint parameters, hardcoded sets stay as the sync fallback
- `src/utils/securityKey.js` — `resolveSecurityKey` gains a FIGI rung between CUSIP and the symbol fallback
