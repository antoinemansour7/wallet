import { useMemo, useState } from 'react'
import { fmtCurrency, fmtNumber, fmtPct, parseNum } from '../../utils/portfolioStats'
import CompanyLogo from '../../components/CompanyLogo'
import Reveal from '../../components/Reveal'
import EmptyState from './EmptyState'
import { sortPositionsByValue } from './helpers'
import { lastPricedAt, isPriceStale, PRICED_AT_KEY } from '../../utils/livePrices'

// This screen is a ledger, and a ledger is read down its columns. What made it
// hard to read was not density but repetition: every account stated its return
// under the headline number, again in a pill, and a third time in a footer
// strip, while every row carried both a dollar change and a percentage change
// side by side. With a book that is mostly down, that renders as two full
// columns of red and no way to tell a large position from a small one.
//
// So each fact is stated once. Rows carry the value and the percentage — the
// figure that compares across positions — and the dollar amount moves into the
// row's own detail, one tap away.
//
// Deliberately absent: per-row weight bars. CompositionPanel drew those once
// and dropped them, because the allocation strip already puts every proportion
// on one shared scale; two competing pictures of the same thing is worse than
// one good one.

const sign = (n) => (n < 0 ? '−' : '+')

/**
 * When a price was last taken, said the way a person would say it.
 *
 * "Not updated" invites a shrug; a date does not. Anything older than a week
 * gets the date rather than a count of days, because "9 days ago" is harder to
 * place than "Aug 24".
 */
function priceAge(value) {
  const ms = Date.parse(String(value ?? ''))
  if (!Number.isFinite(ms)) return 'not updated'

  const days = Math.floor((Date.now() - ms) / 86400000)
  if (days < 1) return 'earlier today'
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days} days ago`
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

/** Signed money, using a real minus so columns line up under tabular figures. */
function signedCurrency(amount) {
  return `${sign(amount)}${fmtCurrency(Math.abs(amount))}`
}

function toneOf(amount) {
  if (amount > 0) return 'text-gain'
  if (amount < 0) return 'text-loss'
  return 'text-ink/40'
}

function normalizePct(val) {
  if (val == null || val === '') return null
  const s = String(val)
  if (s.endsWith('%')) return s
  const n = parseFloat(s)
  return Number.isFinite(n) ? `${n.toFixed(2)}%` : s
}

/** A percentage with its sign, never a triangle. */
function pctLabel(raw, amount) {
  const s = normalizePct(raw)
  if (!s) return null
  // Hyphen last: [+-−] is the range '+' through '−', which swallows every
  // digit, so "13.25%" was rendering as "3.25%".
  const bare = s.replace(/^[+−-]/, '')
  return `${sign(amount)}${bare}`
}

function Detail({ label, children }) {
  return (
    <div className="min-w-0">
      <p className="text-[12px] text-ink/40">{label}</p>
      <div className="mt-1 truncate text-[13px] font-medium tabular text-ink/75">{children}</div>
    </div>
  )
}

function PositionRow({ row, expanded, onToggle, stale }) {
  const isCdrRow = /\bCDR\b/i.test(String(row.DESCRIPTION ?? ''))
  const symbol = row.SYMBOL ?? '—'
  const pnl = parseNum(row['UNREALIZED GAIN/LOSS'])
  const pnlPct = pctLabel(row['UNREALIZED GAIN/LOSS %'], pnl)
  const dayAmt = parseNum(row['DAY CHANGE'])
  const dayPct = pctLabel(row['DAY CHANGE %'], dayAmt)
  const price = parseNum(row['MARKET PRICE'])
  const mktVal = parseNum(row['MARKET VALUE'])
  const bookVal = parseNum(row['BOOK VALUE'])
  const qty = parseNum(row.QUANTITY)

  return (
    // The tint sits on the wrapper, not the button: highlighting only the
    // header left the detail below it on bare white, reading as a separate row
    // rather than as the row you just opened.
    <div className={expanded ? 'bg-ink/[0.03]' : ''}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className={`flex w-full items-center gap-3.5 px-4 py-3.5 text-left transition-colors duration-150 focus-visible:outline-none focus-visible:bg-ink/[0.05] sm:px-5 ${
          expanded ? '' : 'hover:bg-ink/[0.025]'
        }`}
      >
        <CompanyLogo symbol={symbol} description={row.DESCRIPTION} size={38} />

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-[14.5px] font-semibold tracking-[-0.01em] text-ink">{symbol}</span>
            {isCdrRow && (
              <span
                className="shrink-0 rounded-full bg-ink/[0.07] px-1.5 py-px text-[9.5px] font-semibold tracking-wide text-ink/45"
                title="Canadian Depositary Receipt"
              >
                CDR
              </span>
            )}
          </div>
          {/* The staleness sits beside the price it describes, not in a banner
              at the top of the page that scrolls away and can be dismissed. */}
          <p className="mt-0.5 truncate text-[12.5px] tabular text-ink/40">
            {fmtNumber(qty)} shares · {fmtCurrency(price)}
            {stale && <span className="text-warning"> · {priceAge(row[PRICED_AT_KEY])}</span>}
          </p>
        </div>

        {/* One number per line. The percentage is what compares across rows;
            the dollar change is in the detail below. */}
        <div className="shrink-0 text-right">
          <p className="text-[14.5px] font-semibold tabular text-ink">{fmtCurrency(mktVal)}</p>
          {pnlPct && <p className={`mt-0.5 text-[12.5px] font-medium tabular ${toneOf(pnl)}`}>{pnlPct}</p>}
        </div>
      </button>

      {expanded && (
        <div className="animate-fade-in grid grid-cols-2 gap-x-4 gap-y-3.5 px-4 pb-4 pl-[66px] sm:grid-cols-4 sm:px-5 sm:pl-[71px]">
          <Detail label="Today">
            <span className={toneOf(dayAmt)}>
              {signedCurrency(dayAmt)}{dayPct ? ` (${dayPct})` : ''}
            </span>
          </Detail>
          <Detail label="Total return">
            <span className={toneOf(pnl)}>
              {signedCurrency(pnl)}{pnlPct ? ` (${pnlPct})` : ''}
            </span>
          </Detail>
          <Detail label="Book cost">{fmtCurrency(bookVal)}</Detail>
          <Detail label="Name">
            <span className="font-normal" title={row.DESCRIPTION ?? ''}>{row.DESCRIPTION ?? '—'}</span>
          </Detail>
        </div>
      )}
    </div>
  )
}

/** Cash is part of the balance, so it sits in the ledger — but it is not a win,
 *  so it does not get the green treatment a gain would. */
function CashRow({ account }) {
  const source = account.cashSource === 'explicit' ? 'From file'
    : account.cashSource === 'inferred' ? 'Inferred'
      : 'Balance'

  return (
    <div className="flex items-center gap-3.5 px-4 py-3.5 sm:px-5">
      <span className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-full bg-ink/[0.06] text-[15px] font-medium text-ink/50">
        $
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[14.5px] font-semibold tracking-[-0.01em] text-ink">Cash</p>
        <p className="mt-0.5 truncate text-[12.5px] text-ink/40">
          {source} · {account.currency || 'CAD'}
        </p>
      </div>
      <p className="shrink-0 text-[14.5px] font-semibold tabular text-ink">{fmtCurrency(account.cash)}</p>
    </div>
  )
}

/**
 * The account's own line. Same shape as the account detail sheet — eyebrow,
 * the number at display size, one meta line — so the two screens that describe
 * an account describe it the same way.
 */
function AccountHeader({ account, staleCount }) {
  const s = account.stats
  const facts = [
    <span key="pnl" className={toneOf(s.totalPnl)}>
      {signedCurrency(s.totalPnl)} ({fmtPct(s.totalPnlPct)})
    </span>,
    <span key="day" className={toneOf(s.totalDayChange)}>
      {signedCurrency(s.totalDayChange)} today
    </span>,
    <span key="book" className="text-ink/45">{fmtCurrency(s.totalBookValue)} book cost</span>,
  ]

  // A total built from a mix of current and stale prices is neither, and
  // saying so beside it is the only place a person would look.
  if (staleCount > 0) {
    facts.push(
      <span key="stale" className="text-warning">
        {staleCount} price{staleCount === 1 ? '' : 's'} not updated
      </span>,
    )
  }

  return (
    <div className="mb-3 px-1">
      <p className="text-[13px] font-medium text-ink/45">Account {account.accountNumber}</p>
      <p className="mt-1.5 font-display text-[28px] font-medium leading-none tracking-[-0.03em] tabular text-ink">
        {fmtCurrency(s.totalMarketValue)}
      </p>
      {/* Separated by space, not by middots: the line wraps on a phone, and an
          interpunct that lands at the start of the wrapped line reads as a
          bullet for a list that is not there. */}
      <p className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-[13px] font-medium tabular">
        {facts}
      </p>
    </div>
  )
}

export default function HoldingsView({ rows, accounts, onUploadClick }) {
  const [expandedKey, setExpandedKey] = useState(null)

  // Judged across the whole book, not per account: a refresh either reached a
  // row or it did not, and the comparison that matters is against the rows it
  // did reach.
  const newestPricedAt = useMemo(() => lastPricedAt(rows), [rows])

  const sortedAccounts = useMemo(
    () => accounts.map((account) => ({
      ...account,
      positions: sortPositionsByValue(account.positions),
    })),
    [accounts],
  )

  if (!accounts.length && !rows.length) return <EmptyState onUploadClick={onUploadClick} />

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6 flex items-baseline justify-between gap-4">
        <h2 className="text-[15px] font-semibold text-ink">Holdings</h2>
        <span className="text-[12.5px] tabular text-ink/40">
          {accounts.length} account{accounts.length === 1 ? '' : 's'} · {rows.length} position{rows.length === 1 ? '' : 's'}
        </span>
      </div>

      <div className="space-y-9">
        {sortedAccounts.map((account, accountIndex) => {
          const acct = account.accountNumber

          return (
            <Reveal key={acct} delay={accountIndex * 80}>
              <section>
                <AccountHeader
                  account={account}
                  staleCount={account.positions.filter((r) => isPriceStale(r, newestPricedAt)).length}
                />

                <div className="divide-y divide-ink/[0.06] overflow-hidden rounded-2xl border border-ink/[0.08] bg-wall-surface">
                  {account.positions.length === 0 && (
                    <p className="px-5 py-4 text-[13.5px] text-ink/45">No open positions in this account.</p>
                  )}

                  {account.positions.map((row, i) => {
                    const key = `${acct}:${row.SYMBOL ?? i}`
                    return (
                      <PositionRow
                        key={key}
                        row={row}
                        stale={isPriceStale(row, newestPricedAt)}
                        expanded={expandedKey === key}
                        onToggle={() => setExpandedKey(expandedKey === key ? null : key)}
                      />
                    )
                  })}

                  {account.cash !== 0 && <CashRow account={account} />}
                </div>
              </section>
            </Reveal>
          )
        })}
      </div>
    </div>
  )
}
