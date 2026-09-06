# Portfolio Tax page

Implemented 2026-09-06. Portfolio navigation is **Overview · Charts · Holdings · Tax · Accounts**.

The Tax tab is the home for the cross-account picture. Overview contains a single pointer into it. The account sheet retains a withholding section immediately below its holdings, calculated with the same model and with a link to the full page.

## Page layout

1. Annual withholding illustration, split by currency, with coverage and potential foreign tax credits.
2. Account table with editable registration types and an expandable explanation of excluded holdings.
3. Side-by-side account comparison for a selected holding, with a 1–30 year illustration at constant value/yield.
4. TFSA and RRSP room, editable as-of dates, contributions entered since those dates, and a planned-contribution check.
5. CAD-to-USD conversion cost comparison using editable spread, commission and bid–ask assumptions.
6. Recorded trading commissions and account fees from the transaction ledger.
7. Actual SELL records with a price-only hold-versus-sell scenario. Both positive and negative differences receive the same presentation.

The page supports light/dark themes, reduced motion, keyboard controls and narrow screens. Mobile account rows keep annual withholding visible without a horizontal table scroll.

## Feature placement in epic #16

| Feature | Main home | Context retained elsewhere |
| --- | --- | --- |
| Withholding / account comparison (#17) | Tax: accounts and comparison | Account sheet: withholding on its own holdings; Overview: pointer |
| Currency conversion (#18) | Tax: Currency section | Future cash/conversion flow may link to the section |
| Realised-sale counterfactuals (#20) | Tax: After a sale | Charts remains the portfolio benchmark home |
| Fee breakdown (#21) | Tax: Fees section | Original transactions remain in the ledger |
| Contribution room (#22) | Tax: Contribution room | Future contribution execution flows can use the same room check |

These are code/documentation placement decisions; the GitHub issues themselves have not been edited.

## Data and persistence

- Holdings/account currencies come from the existing portfolio. CAD and USD are never summed without conversion.
- Registration is taken from an unambiguous imported account type or a user-confirmed override. Account numbers and statement filenames do not establish registration.
- A CAD valuation does not establish a Canadian listing. If the listing currency is missing, the holding is excluded and explained.
- User-entered tax settings are stored at `users/{uid}/portfolio/tax`, separate from holdings, with the existing owner-scoped Firestore rules. Failed loads cannot overwrite previous figures, and failed saves retain the editable draft.
- The Tax tab reads `users/{uid}/transactions`. It does not write to the transaction ledger or create sales from account/import removals. Reads are paginated, bounded to the latest 5,000 records and disclose truncation.
- Preview mode bypasses tax persistence and ledger reads; preview edits do not enter a real account.

## What the figures mean

**Withholding is an illustration.** It assumes US-source dividends, treaty eligibility and an editable dividend yield (initially 1.3%). It uses the existing withholding rule module. Actual dividend distributions are not present in the holdings snapshot. Fund-level withholding is explicitly excluded because the underlying allocation and distributions are needed. The comparison covers dividend withholding, not total after-tax returns, RRSP deductions or withdrawal taxes. It does not compound the annual difference.

**Contribution room is user-maintained.** The user enters available room and contributions since its as-of date across all accounts of the same registration type. The page checks a proposed amount before the user acts. It does not infer contributions from buys, cash balances or ambiguous transfers. A previous-year figure becomes stale; annual room is never silently added. TFSA withdrawal add-backs are not automated. Automatic deposit classification and warnings inside a real contribution execution flow remain work for #22.

**Fees are recorded charges.** Trading fees and explicit FEE transactions are deduplicated and kept in their original currencies. Fund expenses and embedded FX spreads are excluded. Missing history is a data gap, not a zero fee.

**Sale comparisons use an explicit input price.** They are based only on genuine SELL records. They do not claim to be priced to today and exclude distributions, splits, tax, fees and reinvested proceeds. Corporate-action-aware current valuation is still needed for #20's automatic “held today” outcome; the page provides its presentation home and a usable manual price scenario now.

**Conversion figures are scenarios.** All cost assumptions are editable; defaults are examples from the existing generic conversion model, not current broker quotes. Broker-specific instructions, verified current rates and execution integration remain in #18. A negative difference is shown rather than suppressed. Costs are compared in CAD, so no invented FX rate is needed.

## Sources checked

- [Canada–US treaty, Articles X and XXI](https://www.canada.ca/en/department-finance/programs/tax-policy/tax-treaties/country/united-states-america-convention-consolidated-1980-1983-1984-1995-1997-2007.html)
- [CRA: before contributing to a TFSA](https://www.canada.ca/en/revenue-agency/services/tax/individuals/topics/tax-free-savings-account/contributing/before.html)
- [CRA: TFSA withdrawals and next-year room](https://www.canada.ca/en/revenue-agency/services/tax/individuals/topics/tax-free-savings-account/withdraw.html)
- [CRA: RRSP contributions](https://www.canada.ca/en/revenue-agency/services/tax/individuals/topics/rrsps-related-plans/contributing-a-rrsp-prpp.html)

## Validation

Tax model and UI tests cover currency separation, unknown identities, account treatment, zero yield, stale/future room, planned excess, fee deduplication, both sale-comparison directions, tab/pointer navigation and account context. Persistence tests cover delayed responses across user changes and failures on reads/writes. Playwright checks exercise the real page at desktop and 390-pixel mobile widths in light/dark themes.
