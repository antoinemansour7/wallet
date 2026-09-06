# Portfolio Tax page

Issue #124 connects the Tax workspace preserved in commit `287da25` to the engines merged under epic #16. Navigation remains **Overview · Charts · Holdings · Tax · Accounts**. Overview contains a quiet pointer; the account sheet retains its contextual withholding section.

## Page and data flow

| Section | Source and calculation | Qualifications displayed |
| --- | --- | --- |
| Across accounts | `accountTypeOf` reads imported `ACCOUNT TYPE`; `accountWithholding` and `projectWithholding` use `securityReference` | Listing, resolved dividend yield or explicit fallback, reference date, treatment and named gaps |
| Side-by-side comparison | Same holding and reference passed to `projectWithholding` for two existing accounts | Withholding only, constant value/yield, no compounding; fund-level treatment stays unavoidable |
| Contribution room | Entered starting room/date plus ledger deposits passed to `roomStatus` and `checkContribution` | Stale room suppresses numbers and warnings; `excludesTfsaRecontribution` stays beside the figure |
| Currency conversion | Editable spread, commissions and bid–ask scenario | Assumptions, not a broker quote; settlement and exchange-rate changes excluded |
| Fund fees | `summarizeFundFees` reads `securityReference` expense ratios | Annual estimate at current values; weighted across priced funds only; missing MER named; stocks excluded |
| After a sale | `poolCostBase` disposals feed `saleCounterfactuals` and `summarizeCounterfactuals` | CAD after FX conversion; pool provenance and security-match basis; `excludesReinvestment` travels with the figures |

## Shared reads and joins

`useTaxWorkspace` owns reference data, ledger and account-history metadata for both the page and account sheet. It uses `fetchSecurityReference`, `loadTransactions` and `loadHistoryStarts`; there is no second Firestore ledger reader. Market requests are bounded to the endpoint's 200-symbol limit, including the FX symbol for sale quotes. Vite delegates reference requests to the production handler so local and deployed behavior match.

The Tax page's `taxModel.js` contains presentation adapters, not alternate tax rules. `taxStorage.js` persists only settings at `users/{uid}/portfolio/tax`. Failed settings reads prevent writes; failed saves retain the last saved values and editable drafts. User changes invalidate in-flight reads.

Imported registration takes precedence over a manual fallback, including Plaid's `Non-Registered` spelling. An unknown registration can still be entered manually. A reference exchange establishes listing location independently of the currency in which holdings are valued. An explicit CDR remains a Canadian wrapper. Canadian funds with unresolved composition stay unknown even if a legacy hardcoded list names them. Chart metadata identifies funds even when a fund-profile request fails.

Ledger IDs join through each holding's `__plaidAccountId`, rather than the display account number. Measured annual withholding requires a full twelve-month window for every represented feed and the selected currency. Otherwise the figure remains an explicitly labeled projection. CAD and USD valuation totals stay separate. Mixed portfolio totals containing a projection are labeled estimates; each account retains its own basis.

## Contribution records

Room is saved as `{ limitMinor, asOf }` by registration. The adapter groups account IDs and converts USD deposits to CAD using their stored historical FX rates before invoking the shared engine. A missing rate prevents a room check. Current-year room and planned checks are withheld while ledger reads are loading, failed or capped.

Old `{ room, contributed, asOf }` records require confirmation. The old room amount is offered for editing; its manually entered contribution total is never deducted a second time alongside the ledger.

The shared engine counts incoming transfers as deposits. Transfers between registered accounts, missing brokerage history and contributions outside this app require reconciliation with the user's records. It does not model TFSA withdrawal add-backs or add new annual limits. These limitations remain visible in the section.

## Ledger and sync

The browser reads the shared store's newest 2,000 transactions and their account history starts. Reaching that bound is disclosed and suppresses contribution and sale calculations rather than treating a truncated ledger as complete. Strict read errors appear separately from empty-history states. Fund-fee estimates remain available without a ledger.

**Sync transactions** calls the existing authenticated `sync-transactions` action through `callPlaid`. The server derives the user from the Firebase ID token. Partial connection failures are shown even when the endpoint returns HTTP 200; successful results refresh the shared reads. No browser code writes ledger records or creates sales from deleted imports/accounts. Scheduled sync remains at 23:00 UTC weekdays.

Only disposals emitted by the shared taxable-account cost-base engine are compared. Incomplete pools expose their reasons. Missing prices, explicitly stale quotes, unsupported quote currencies and missing USD/CAD rates do not produce a comparison. Current stock prices are compared with net historical proceeds in CAD. Both outcomes receive equal presentation. Dividends, subsequent corporate actions, Canadian tax and reinvestment remain excluded; the output is not an after-tax performance claim.

## Validation and operational handoff

Unit and integration tests cover imported registration, CAD-valued US listings, reference and composition gaps, Plaid ID joins, incomplete history, fund fees with an empty ledger, currency conversion, stale room, legacy settings migration, both sale outcomes, attached limitations, capped reads, account-switch races and partial sync failures.

The one-time production sync has **not run** in this development session. Automatic approval review rejected exporting production configuration to a local file. Run **Tax → Sync transactions** in an authenticated deployed session, or explicitly authorize that production-configuration access for a scoped operational run. A successful build/test run does not establish that the production ledger has been populated.

Verified locally: 847 tests passed across 70 files; ESLint and production build passed (the existing bundle-size warning remains). Playwright checked empty and populated withholding states with mocked reference responses at 1440px and 390px in light/dark themes: no page errors or horizontal overflow. Live production reference availability and transaction counts were not verified.
