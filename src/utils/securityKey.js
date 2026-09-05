/**
 * The identity a security pools on.
 *
 * Canadian ACB pools identical securities across every non-registered account
 * at every institution, so this key is the join the whole cost-base
 * calculation rests on. Getting it wrong is not a display bug — it merges two
 * unrelated holdings into one cost base, or splits one holding into two, and
 * the resulting number goes on a tax return.
 *
 * Symbols cannot carry that join by themselves:
 *   · Plaid's `security_id` is internal to one Plaid item, so the same ETF at
 *     two brokerages arrives with two different ids.
 *   · The same listing is spelled differently by different brokers — XEQT at
 *     one, XEQT.TO at another.
 *   · A CDR shares its ticker with the security it tracks and is not that
 *     security. NVDA on the NEO in CAD and NVDA on the Nasdaq in USD have
 *     separate cost bases.
 *
 * So: prefer a real identifier, fall back to the listing, and always report
 * which rung was used, because a symbol-based join is a guess and the caller
 * is entitled to know that before putting a number on a screen.
 *
 * ISIN and CUSIP come from Plaid directly for connected accounts. Statement
 * imports have neither, and there is no free service that maps a bare ticker
 * to an ISIN — but OpenFIGI maps ticker+exchange to a FIGI, a different
 * identifier family serving the identical purpose here (#88): a real,
 * globally unique key, ranked below the two Plaid supplies directly.
 */

export const KEY_BASIS = {
  ISIN: 'isin',
  CUSIP: 'cusip',
  FIGI: 'figi',
  SYMBOL: 'symbol',
}

const ALPHANUMERIC = /^[A-Z0-9]+$/

function clean(value) {
  return String(value ?? '').trim().toUpperCase()
}

/**
 * A malformed identifier is worse than an absent one: it looks authoritative
 * and pools on garbage. Anything that is not the right length, or carries
 * punctuation an identifier cannot contain, falls through to the next rung.
 */
function validIdentifier(value, length) {
  const candidate = clean(value)
  if (candidate.length !== length) return ''
  return ALPHANUMERIC.test(candidate) ? candidate : ''
}

/**
 * `?` rather than an empty segment. 'sym:VTI::' would collide with a listing
 * that genuinely records no exchange; naming the gap keeps the two apart and
 * makes the missing field visible in any key that gets logged.
 */
function segment(value) {
  return clean(value) || '?'
}

export function resolveSecurityKey(security) {
  if (!security) return null

  const isin = validIdentifier(security.isin, 12)
  if (isin) return { key: `isin:${isin}`, basis: KEY_BASIS.ISIN }

  const cusip = validIdentifier(security.cusip, 9)
  if (cusip) return { key: `cusip:${cusip}`, basis: KEY_BASIS.CUSIP }

  // FIGI arrives on a distinct `figi` field, never on `isin` — it happens to
  // share ISIN's 12-character length, but a security carrying only a FIGI
  // must resolve to a figi: key, never get promoted to isin: by coincidence
  // of length. It ranks below CUSIP because Plaid, the higher-confidence
  // source, supplies ISIN/CUSIP directly; FIGI (#88) is a looked-up
  // substitute for statement imports that have neither.
  const figi = validIdentifier(security.figi, 12)
  if (figi) return { key: `figi:${figi}`, basis: KEY_BASIS.FIGI }

  const symbol = clean(security.symbol)
  if (!symbol) return null

  // Currency is part of the key on purpose. It is the one field that reliably
  // separates a CDR from its underlying when the exchange is missing, which is
  // the common case in a statement import.
  return {
    key: `sym:${symbol}:${segment(security.exchange)}:${segment(security.currency)}`,
    basis: KEY_BASIS.SYMBOL,
  }
}
