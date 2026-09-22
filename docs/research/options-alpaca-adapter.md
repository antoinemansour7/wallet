# Alpaca options-data adapter

Story #205 implements the Phase 0, zero-cost provider selected in the options-scanner Epic. The adapter is a server-only research input. It does not place orders and its free option data must never be labeled executable or live NBBO.

## Endpoints and feed meaning

`src/server/options/alpaca.js` uses three explicit endpoints:

- Alpaca [multi-stock snapshots](https://docs.alpaca.markets/us/reference/stocksnapshots-1) with `feed=iex` for synchronized underlying quotes, trades and bars. This is real-time IEX data with single-venue coverage, not consolidated SIP.
- Alpaca [option-chain snapshots](https://docs.alpaca.markets/us/reference/optionchain) with `feed=indicative` for quotes, trades, bars, IV and Greeks. Free quotes are modified indicative derivatives and trades are delayed by 15 minutes.
- Alpaca [option contracts](https://docs.alpaca.markets/us/reference/get-options-contracts) for provider IDs, OCC symbols, roots, strike, expiration, type, style, multiplier, status, tradability, open interest and its date.

The adapter never substitutes a previous close, bar, trade, fetch timestamp or Yahoo value for a missing or stale quote. It records quote, trade and bar timestamps separately at their original nanosecond precision. Provider retrieval time becomes `availableAt`/`fetchedAt`; the provider does not supply a distinct publication timestamp, so `publicAt` remains null with a reason.

Open interest is labeled prior-session-close inventory and retains `open_interest_date`. Option daily volume is labeled with its RTH session date. FMV is explicitly absent on this feed. A stale underlying quote leaves the response structurally complete but sets `pricingReady=false`; the later liquidity-gate story decides whether a contract is eligible.

## Analytics conventions

Alpaca says its snapshot IV and Greeks are Black–Scholes calculations and may be missing when inputs do not support convergence. The adapter preserves nulls and records their reasons. Analytics have no provider timestamp, so their age is `unknown` and downstream pricing is told to recalibrate locally from synchronized inputs.

The v1 units follow the implementation Alpaca identifies in its [market-data FAQ](https://docs.alpaca.markets/us/docs/market-data-faq) (`gopriceoptions`):

- IV: annualized decimal fraction (`0.54` means 54%).
- Delta: option-price dollars per $1 underlying move.
- Gamma: delta change per $1 underlying move.
- Theta: option-price dollars per calendar day.
- Vega: option-price dollars per one volatility percentage-point move.
- Rho: option-price dollars per one interest-rate percentage-point move.

Values are provider observations, not locally validated valuations. The scenario engine must preserve the observed values and store its independently calibrated values separately.

## Failure and budget behavior

The adapter constructs only allowlisted HTTPS paths on configured origins. Alpaca pagination cursors are length/character bounded, deduplicated and sent through `URLSearchParams`; pagination URLs are never accepted. Credentials remain in headers and errors expose only a category and HTTP status.

Every run has page, request, retry and deadline limits. Network failures, 429 responses and 5xx responses retry only while the stage deadline permits. Authentication, missing entitlement, malformed payloads and unsafe pagination do not retry. Any incomplete metadata or snapshot page sets `complete=false`; subsequent stages must not interpret partial rows as a full chain.

Recorded fixtures cover pagination, optional analytics, malformed timestamps, stale underlying data, missing entitlement, throttling and deadline exhaustion. `npm run options:alpaca:acceptance` performs a bounded, read-only one-symbol check when authorized credentials exist; it prints counts and statuses only.
