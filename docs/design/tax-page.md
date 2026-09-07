# Portfolio Tax page

Issue #124 connects the Tax workspace preserved in commit `287da25` to the engines merged under epic #16. Navigation remains **Overview · Charts · Holdings · Tax · Accounts**. Overview contains a quiet pointer; the account sheet retains its contextual withholding section.

## Simplified workspace

The default **Summary** has three equal-width cards: annual dividend withholding, annual fund expenses, and the current year's measured FX difference. Each uses the same label, amount, currency/period, qualification and action hierarchy. CAD FX measurements remain explicitly CAD even when the portfolio display currency is USD. Annual estimates and historical measurements are not combined into a misleading total.

A short data-status row replaces the long inline source list. **Data & assumptions** opens an accessible modal with excluded holdings, the editable fallback yield and a table of per-holding yields, accounts, listings and reference dates. Percentages round to two decimal places for display only. Assumed yields and fund-level limitations remain identified. Missing coverage and assumed-yield qualifications remain beside the summary figure; fund expenses retain their own breakdown and named gaps.

Contribution room spans the available page width, with TFSA and RRSP beside each other on desktop and stacked on mobile. Only one contribution editor can be open at once. Current room, stale-data behavior and planned-contribution checks continue to use the shared engine.

**Planning** presents one tool at a time: account comparison or a historical currency report. The report shares the Summary's measurement object and year. Statement-style conversion rows show dates, account identifiers and the signed difference from the daily reference; expanding a row reveals both currency amounts, both rates and the evidence used. A negative measured difference is labeled below reference, not presented as a negative fee paid. Equal-looking transactions with different stable identities remain separate. **Sales** retains its focused view.

The page uses shared light/dark color tokens, aligned tabular amounts and restrained motion. Keyboard tab navigation, dialog focus trapping/restoration and reduced-motion behavior remain supported. Switching page sections preserves drafts and comparison selections; opening another contribution editor closes the previous one.

## Page and data flow

| Section | Source and calculation | Qualifications displayed |
| --- | --- | --- |
| Withholding summary and details | `accountTypeOf` reads imported `ACCOUNT TYPE`; `accountWithholding` and `projectWithholding` use `securityReference` | Listing, resolved dividend yield or explicit fallback, reference date, treatment and named gaps |
| Side-by-side comparison | Same holding and reference passed to `projectWithholding` for two existing accounts | Withholding only, constant value/yield, no compounding; fund-level treatment stays unavoidable |
| Contribution room | Entered starting room/date plus ledger deposits passed to `roomStatus` and `checkContribution` | Stale room suppresses numbers and warnings; `excludesTfsaRecontribution` stays beside the figure |
| Currency conversion | One `measureConversionCost` result shared by Summary and the historical Planning report | CAD/USD amounts, account, daily reference, evidence source and unpriced records; no hypothetical calculator |
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

## FX evidence guard

A CAD transaction amount and quantity × unit price do not establish two different currency legs. Legacy trade records do not independently establish that the unit price is USD, and identical amounts were previously interpreted as a 1.0000 CAD/USD rate. The embedded-conversion path now requires independently established `priceCurrency: 'USD'`; missing price currency is disclosed as an unpriced record. Known CAD-priced CAD trades are not FX conversions. This guard does not populate that metadata by guessing from a ticker or a current quote.

The [Plaid investment transaction schema](https://plaid.com/docs/api/products/investments/) supplies a transaction currency and price; the security currency describes its closing price. The application cannot assume the latter independently verifies the currency of a transaction's unit price. Explicit paired CAD/USD FX records continue to be measured. Existing history and cash-balance prerequisites still apply to verified embedded trades. The report states its opening-cash assumption next to those derived figures.

Repeated transaction identities are counted once per account. Distinct records with the same date and amount are retained; account labels make them distinguishable. Unsupported currency pairs are left unpriced instead of being labeled CAD/USD.

Validation for the card/detail redesign: the full suite passed 911 tests across 72 files; the final focused run passed 61 Tax/FX tests. Changed-file ESLint and the production build passed (existing bundle-size warning). A temporary harness rendered the production Tax components with synthetic populated references and both verified and unverified FX records at 1440px, 768px and 390px in light/dark themes. All 12 combinations had no horizontal overflow or runtime errors. Checks covered equal card heights, rounded yields, dialog Escape/focus restoration, exclusive contribution editing, retained account-specific conversions, and reduced motion. No production account data was used in browser checks.
