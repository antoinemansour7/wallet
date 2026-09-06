/**
 * Reference data for the securities a portfolio holds — real yield, listing,
 * whether a Canadian-listed fund holds foreign equities, and the expense ratio.
 *
 * The tax features were shipped on two stopgaps: a hardcoded list of about 35
 * funds, and a 1.3% yield assumed for every holding. Both are plausible for a
 * broad US equity fund and wrong for a REIT, a bond fund or a dividend ETF, and
 * the projection inherits the error directly.
 *
 * Every field is independently optional. A caller that gets no yield keeps its
 * own assumption and says the number is an assumption; one that gets no
 * composition classifies the fund as unknown and says nothing at all. Nothing
 * here substitutes a default, which is what makes it safe behind a tax figure.
 */

const MAX_SYMBOLS = 200

export const EMPTY_REFERENCE = Object.freeze({})

/**
 * Resolve reference data for the given symbols.
 *
 * Returns an empty map rather than throwing: every consumer treats a missing
 * record as "use the assumption and label it one", so a failed lookup degrades
 * to exactly the behaviour that existed before this module.
 */
export async function fetchSecurityReference(symbols = [], { fetchImpl = fetch } = {}) {
  const unique = [...new Set(
    symbols.map((symbol) => String(symbol ?? '').trim().toUpperCase()).filter(Boolean),
  )].slice(0, MAX_SYMBOLS)
  if (unique.length === 0) return EMPTY_REFERENCE

  try {
    const response = await fetchImpl('/api/live-prices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reference: unique }),
    })
    if (!response.ok) return EMPTY_REFERENCE

    const body = await response.json()
    return body?.securities && typeof body.securities === 'object' ? body.securities : EMPTY_REFERENCE
  } catch (error) {
    console.error('[securityReference] lookup failed:', error?.message ?? error)
    return EMPTY_REFERENCE
  }
}

/** The symbols a set of holdings actually needs resolved. */
export function symbolsToResolve(rows = []) {
  return [...new Set(
    rows.map((row) => String(row?.SYMBOL ?? '').trim().toUpperCase()).filter(Boolean),
  )]
}
