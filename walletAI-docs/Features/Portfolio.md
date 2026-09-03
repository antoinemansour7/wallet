# Portfolio

The screens, and the reasoning behind them. Rewritten 2026-09-02 — the previous
version described a CSV-upload-only, dark-theme-only app with a KPI grid, none of
which is true any more.

Model first: [[Architecture/Accounts and Imports]].

## Getting in

**Accounts** is the list of what you have; adding is a task that opens over it.
The page used to *be* the add form, which meant the thing you look at most often
was a pair of upload boxes.

The empty screen **is** the chooser rather than a sign pointing at one — the two
routes in are two rows, so connecting a brokerage is one click rather than a
button that opens a sheet asking the same question again. The whole panel is a
drop target, because dropping a statement was always supported and was buried two
clicks inside the add sheet, which is the one place you cannot drop a file until
you have already decided to import one.

## The add sheet

Copy is deliberately thin. An overlay this size is read at a glance, and every
sentence explaining the flow competes with the two choices that *are* the flow.

The review step leads with **the sum**, at a size nothing competes with, because
the whole decision is where that number lands — and it holds still while you move
between destinations. A connected import skips the destination question entirely
and lists the accounts it will create, since Plaid already said which account
each holding belongs to.

Sizing note: everything in here once sat between 11.5px and 13.5px at a third
opacity. That is the register of a dense dashboard, not of a sheet you are asked
to make one decision in, and it is most of why it read as filler.

## Removing an import

Confirming happens **in the row**, not by replacing the list. Replacing it hid
what the account was made of at exactly the moment that mattered.

The consequence is stated as the same before → after arithmetic the add sheet
uses, because adding a statement and removing one are the same operation in
opposite directions. The wording says what is deleted and names the account —
it used to say holdings would "leave this account" and that "the account goes
with it", which describes a deletion as a departure and never says what is
destroyed.

The destructive button is **tinted, not filled**. A saturated slab put the
brightest thing in the sheet on the button that destroys holdings; the arithmetic
above it should draw the eye.

An account with no imports left — reachable with a cash-only statement — offers
to remove itself, because imports are counted from positions and such an account
has none to remove one at a time.

## The holdings ledger

A ledger is read down its columns. What made it hard to read was repetition, not
density: every account stated its return under the headline, again in a pill, and
a third time in a footer strip, while every row carried both a dollar change and
a percentage side by side. On a book that is mostly down, that renders as two
full columns of red with no way to tell a large position from a small one.

Each fact is now stated once. Rows carry the value and the percentage — the
figure that compares across positions — with the dollar amount one tap away.

A row whose price could not be refreshed says **when** it was last priced, beside
the price it describes. Staleness is judged against the other rows rather than
against the clock, so a portfolio that has never been priced marks nothing.

**Deliberately absent:** per-row weight bars. `CompositionPanel` drew those once
and dropped them, because the allocation strip already puts every proportion on
one shared scale. Two competing pictures of the same thing is worse than one.

Cash sits in the ledger because it is part of the balance, but gets no green
treatment — green is reserved for gains, and cash is not one.

## Theming

Light and dark, following the system preference unless overridden.

**A trap worth knowing.** The light theme is not implemented with tokens
throughout: `src/index.css` carries a block of `!important` overrides matching on
Tailwind class *substrings*, scoped to `.portfolio-shell` and `.modal-panel`.

```css
html:not(.dark) .portfolio-shell [class*="text-white"] { color: #17211d !important; }
```

Any element carrying `text-white` is ink-coloured in light mode regardless of
what it sits on — so `bg-accent text-white` rendered dark green on dark green,
about 2.4:1. It matches `hover:` classes too, which left every holdings row
permanently in its hover state with the hairlines invisible.

Both are fixed, but the override block is still there. Use the `ink` tokens; do
not add `text-white` or `bg-white/NN` inside the portfolio tree.
