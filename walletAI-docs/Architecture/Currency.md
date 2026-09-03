# Currency

The subtlest thing in the app, and the source of the worst bug it has shipped: a
position bought at a loss reporting a profit.

## Two fields, two different questions

| Field | Answers |
|---|---|
| `ACCOUNT CURRENCY` | What the figures on this row are **denominated in** |
| `CURRENCY` | What the security **trades in** |

They are not the same. A Canadian account holding RKLB reports a USD price
against a CAD balance. Conflating them is what went wrong.

## The rule that must hold

**Market value and book value must always be in the same currency.** If one side
of the subtraction is converted and the other is not, the reported return is the
exchange rate rather than a return.

That is exactly what happened. The FX gate required `ACCOUNT CURRENCY === 'CAD'`,
and the Plaid route only ever emitted `CURRENCY` — so the gate never opened and
US dollars were added to a Canadian total at face value. Then a client change
began treating an unrecorded currency as Canadian and converting the market
value, while the deployed server still sent cost basis in USD. A position down
23% reported a 6% gain.

## Two conventions for cost basis

- **A statement** reports book value already in the account's currency. This is
  what the rest of the app assumes.
- **Plaid** reports cost basis in the *security's* currency.

So the Plaid route converts price, market value **and** cost basis at the
boundary, and states the currency the figures actually landed in — never one it
could not reach. If the FX lookup fails, the row is labelled with the security's
currency rather than the account's, so nothing downstream double-converts.

## When nothing records a currency

Inferred from evidence, not assumed. The import stored a price beside the book
value, in the same currency, so comparing that price against the quote answers
it: closer to the raw quote means the row is in the quote's currency, closer to
the converted quote means it is already Canadian. A hypothesis only wins if it
lands within 15%; otherwise the row is left in whatever currency it arrived in.

Assuming instead — "unknown means CAD" — is what converted one side and not the
other.

## Never backfill one from the other

`applyLivePrices` used to write `quote.currency` into `ACCOUNT CURRENCY` when the
field was empty. That made a US stock in a Canadian account claim to be a US
account, which switched conversion off permanently after the first refresh. The
field is now preserved, never derived.

## CDRs are the exception

Canadian Depositary Receipts already trade in CAD, so they are never converted.
Identifying one matters more than it looks: the flag decides which ticker to
quote, whether to convert, and whether the quote is plausible. Miss it and the
receipt is priced against the US share — several times too high — and then
multiplied by the exchange rate on top.

Detection uses structured data from the institution (the Cboe Canada suffix, or a
CAD security on the NEOE venue), with the description check kept only for
statements, which carry no such data. A magnitude guard rejects any quote more
than 3× from the price a row arrived with, as a backstop for wrong-listing
matches whatever the cause.
