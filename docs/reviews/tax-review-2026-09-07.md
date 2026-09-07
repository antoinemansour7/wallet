# Tax workspace review — September 7, 2026

## Assessment

Keep the three Summary cards. The main usability problem was below them: Tax had Summary/Planning/Sales navigation, Planning had a second switch, contribution forms sat on the overview, and the sources window displayed the entire imported ledger. Several surfaces mixed headline results, editable assumptions, raw source details and implementation terminology at the same visual level.

The next product step is to make each figure understandable and traceable, then verify it against brokerage records. More charts or more tax sections would add complexity before those foundations are reliable.

## Changes made

| Area | Problem | Result |
| --- | --- | --- |
| Main page | Multiple layers of navigation and permanently visible forms | Three existing metric cards followed by three task rows: Contribution room, Compare accounts, Review sales. Each opens a focused window. |
| Contributions | Forms, planned-deposit inputs and long guidance competed for attention | One room editor at a time; planned contribution checks expand on request; stale/unknown figures stay suppressed. TFSA-specific withdrawal wording no longer appears under RRSP. |
| Account comparison | The default 10-year illustration made a simple comparison look like a long-term forecast; selecting the same account twice was possible | One-year default, optional longer illustration, and distinct account selections. The withholding-only limitation remains attached. |
| Sales | Raw pool provenance, security-match keys and quote metadata formed a long paragraph | Outcome and short limitations first; structured calculation details on expansion. |
| Sources | Unbounded ledger, repetitive caveats and an always-visible fallback editor | Searchable imported records in a collapsed disclosure, 20 rows initially. Yield editing is optional; display precision is bounded. |
| Sync | Raw skip diagnostics occupied the page after a sync | A concise result with expandable diagnostic detail. |

## Calculation and data fixes

1. **Preserve legitimate repeated trades.** `dedupeTransactions` previously discarded rows matching date, action, security, quantity, amount and currency, deliberately ignoring account. Identical purchases in TFSA and RRSP could collapse to one row and corrupt downstream cost-base and contribution calculations. It now removes only repeated stable source identities within the same account. A duplicate connection must be reconciled using verified account identity, not a guess based on matching amounts.
2. **Do not classify ordinary deposits as measured FX.** A CAD deposit and a USD deposit can have a plausible exchange-rate ratio without being the legs of one conversion. The measurement path now requires explicit FX records (or the existing verified-price embedded path). Multiple distinct FX legs on the same day remain unpriced unless explicit conversion identifiers disambiguate them. Equal-valued, interchangeable pairs are retained.
3. **Separate hypothetical FX from recorded costs.** A USD purchase can use cash already held. Its existence does not prove that CAD was converted. The fallback spread calculation is now a clearly labeled, optional scenario in the currency window, with the full-conversion assumption carried in its result. It no longer replaces an unknown historical cost on the Summary card. Measured totals and scenarios use the same current-year/as-of cutoff; future-dated records are excluded.
4. **Accept a published 0% fund fee.** Zero is a valid fee value; null, absent and invalid values remain missing. Weighted expense ratios now use unrounded fee calculations rather than rounded penny totals, so small positions do not distort the reported percentage.
5. **Distinguish unavailable history from no activity.** Loading, failed and capped ledger reads no longer display “No conversions recorded.” The currency window suppresses figures until usable history exists. A rejected reference lookup ends its loading state and exposes an error. An unreadable HTTP-success sync response is treated as a failure, not a successful empty sync.

These changes do not edit or delete production transactions. Correcting read-time deduplication can legitimately change displayed totals when previously hidden trades are restored.

## What should be done next, in order

### 1. Reconcile a representative account against its broker statement

Compare transaction counts, deposits, withdrawals, fees and conversions for a known period. Include a same-day repeated trade, two accounts holding the same stock, USD purchases funded from existing USD cash, and a rejected import. Record the broker statement's expected result and the application's result in fixtures. The automated checks in this change use synthetic records; they do not establish that an individual production ledger is complete.

Completion criterion: every imported or excluded statement line has a reason, the cash movement totals reconcile by currency, and repeated syncs preserve the same identities.

### 2. Establish account identity and cash movement direction at ingestion

Reconnects can produce new Plaid account IDs. Preserve a verified mapping from old and new feeds to a brokerage account before collapsing overlapping imports. Preserve cash direction and explicit conversion linkage where the provider supplies it. Do not infer account identity from a matching amount or a truncated account mask.

The current embedded-FX calculation still assumes no opening USD cash before the available history. Its detailed result discloses that assumption, but a history start date alone cannot prove a zero opening balance. A verified opening cash balance and movement direction are required before broadening automatic FX measurement. The unit-price currency guard remains in place; current records are not retroactively labeled USD based on a ticker.

The [Plaid Investments API documentation](https://plaid.com/docs/api/products/investments/) documents account-ID changes after reconnects and the separate account/transaction fields. This supports requiring explicit identity reconciliation; it does not supply a universal broker conversion join for the current normalized ledger.

### 3. Make history completeness a stored property

The app currently uses a bounded ledger read, history-start metadata and a capped-result flag. Those are useful guardrails, but the absence of older rows or rejected imports is not proof of a complete account history. Persist coverage by account and period, including skipped records and source gaps. Compute completeness before any read-time deduplication or filtering, and keep a limited query distinguishable from a genuinely short ledger.

Contribution calculations also need reliable distinctions between new contributions, withdrawals and transfers between registered accounts. Until then, the displayed figure remains based on the entered starting room and imported deposits; it is not an independently verified CRA balance.

### 4. Improve withholding inputs before adding more forecasts

Fund-level withholding currently approximates foreign exposure using assumed US-source dividends and treaty rates. A boolean foreign-equity flag does not establish the US dividend share or all withholding layers. Replace it with sourced distribution/exposure data where available, retaining explicit unknowns elsewhere. Add a first-class recorded withholding breakdown for accounts whose headline uses ledger measurements, so users can trace those figures to tax records rather than only today's yield references.

### 5. Validate the simplified flows with real usage

Ask a small set of users to answer three questions without explanation: “What is estimated versus recorded?”, “Where do I update my room?”, and “Why is a figure unavailable?” Observe task completion before adding more navigation. Only add inline detail when its absence blocks those tasks.

## Validation

The complete automated suite passed 931 tests across 73 files. Regression coverage includes repeated trade identities, transfer-versus-FX evidence, ambiguous same-day pairing, future-date cutoffs, zero-MER handling, weighted rounding, failed reads/syncs, contribution saves and stale values, source search/pagination, and sale provenance.

Browser review used the production Tax components with synthetic data at 1440px, 768px and 390px in both themes. All six tool windows were exercised, including Escape/focus restoration, exclusive room editing, source search and mobile overflow. No browser runtime errors or horizontal page overflow were observed.

Changed-file ESLint and the production build passed; the existing large-bundle warning remains. The final dialog-transition change passed all 19 UI integration tests and the six-theme/viewport browser matrix was rerun with settled animations.
