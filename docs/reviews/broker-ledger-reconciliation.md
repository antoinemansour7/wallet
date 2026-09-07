# Broker ledger reconciliation — 2026-09-07

Reconnect imports were inconsistent: manual sync selected one owner for an account, while the scheduled importer processed every linked copy. New Plaid items supply new account and transaction IDs, so stable transaction IDs alone did not prevent duplicate purchases across connections.

## Changes

- Manual and scheduled imports use the same per-user account ownership selection. The established connection wins over a newly linked copy; disabled imports do not fetch data or advance history timestamps.
- Account names alone are not identity evidence. Persistent account IDs are retained when available. Mask collisions within an item remain separate. Institution/mask/subtype matching remains a heuristic and is not sufficient evidence to delete historical rows.
- Disconnects invalidate the connection before deleting its imported ledger. Each import batch checks the connection selection in a Firestore transaction, preventing an in-flight import from recreating disconnected data. Re-enabling an account resets incremental sync so its history is backfilled.
- A single-item sync considers all current connections before pruning. Manual and CSV records are preserved.
- Pagination refuses early empty pages, overlapping transaction IDs, missing totals and changing totals. Skipped normalizations remain visible in per-account import coverage; incomplete imports suppress tax-history reads until a successful full import. A provider window does not establish an account opening date, opening cash, or complete lifetime tax history.
- Normalized records retain broker descriptions, account balance currency, transaction subtype, cash direction and original unit-price precision. Plaid's positive investment amounts debit cash; negative amounts credit it. Incoming institutional transfers require review before contribution-room calculations; they are not silently counted as new contributions.

## Scoped production repair

The account owner authorized duplicate removal and supplied the login identity. Three overlapping connections were read. Each fresh, paginated broker feed returned the same six events; two older ledger copies each repeated three purchases. The repair matched each duplicate one-to-one against the retained ledger, checked that the connections had not changed, archived all removed rows and prior selections, then removed six duplicates and disabled only the two duplicate account selections. Tokens were retained.

The archive is server-only in `ledgerReconciliations`; it contains the original document paths and values needed for restoration. The mutation was restricted to the identified user. Two subsequent scoped provider imports both wrote six records and left six active ledger documents.

Independent broker-statement reconciliation is still pending. The available local broker CSVs contain holdings snapshots, not cash movements or trade confirmations. The provider-to-ledger comparison verifies import fidelity, not that the provider includes every broker event. Obtain a monthly statement spanning the relevant deposits, purchases and institutional transfer, plus any earlier opening positions/cash, before expanding tax automation.

## FX presentation

When Wealthsimple USD purchases have a CAD account balance currency, the card can show a conditional **estimated fee**, with the funding assumption next to the figure. Balance currency is not proof of funding currency. Existing USD-funded trades do not incur the CAD-account trading conversion fee.

For purchases, the published formula is `corporate rate / (1 - 0.015)`. The estimate substitutes the daily reference rate for the unavailable corporate rate, rounds the modeled CAD debit and reference debit to cents, and subtracts them. It excludes any difference between the broker's corporate rate and the daily rate. The breakdown retains each trade, its date, USD amount, reference rate and estimated fee. Estimates and measured costs are not added into one total. Exact FX loss still requires actual conversion legs or the CAD amount and exchange rate on a trade confirmation.

Sources: [Plaid investment transaction fields](https://plaid.com/docs/api/products/investments/), [Wealthsimple fee schedule](https://www.wealthsimple.com/en-ca/legal/fees/trade).

## Validation

Regression coverage includes repeated scheduled/manual syncs, stable ownership when new IDs sort earlier, reconnect cleanup, concurrent disconnects and newly linked accounts, preservation of other/manual accounts, incomplete pagination/imports, broker cash direction, contribution-transfer review and conditional FX fee arithmetic. Local browser checks covered the populated FX card and expandable trade breakdown at 1440px and 390px in light/dark themes, with no overflow or runtime errors. The production build and changed-file ESLint passed; the build retains its existing bundle-size warning.
