/**
 * Contribution room, and the warning before going over it.
 *
 * Design: #22. Small in dollars, large in trust.
 *
 * There is no API for contribution room. The CRA publishes it on the notice of
 * assessment and in My Account, and neither is machine-readable by a third
 * party. So the user types it in once and this counts deposits against it —
 * which makes the feature only as good as the number they entered, and means
 * it must say so rather than presenting a stale figure as fact.
 *
 * ## Staleness is a first-class state, not a warning banner
 *
 * Room is granted annually. A figure accurate as of last year is not a smaller
 * number this year, it is an *unknown* one — the new year's grant is not
 * something this app can compute, because the annual limit changes and the
 * user's own carry-forward is not derivable from anything stored here.
 *
 * So a figure from a previous tax year does not silently carry forward. It
 * goes stale, and a stale figure produces no warning at all: telling someone
 * they have $7,000 of room when the real answer is unknown is worse than
 * telling them nothing, because they would act on it.
 *
 * ## The TFSA re-contribution rule is excluded, and says so
 *
 * Money withdrawn from a TFSA is not available again until January 1 of the
 * following year, and re-contributing in the same year is the single most
 * common costly mistake. Modelling it needs withdrawal records this ledger
 * does not cleanly identify, so it is out of scope — and every result carries
 * `excludesTfsaRecontribution` rather than leaving a screen to remember. A
 * silent omission here would produce exactly the confident wrong number the
 * feature exists to prevent.
 */

import { toMinorUnits } from './money'

/** 1% of the excess per month, for every month it stays over. */
export const MONTHLY_PENALTY_RATE = 0.01

export const ROOM_STATUS = {
  OK: 'ok',
  STALE: 'stale',
  OVER: 'over',
  UNKNOWN: 'unknown',
}

/** Room is granted per calendar year, so staleness is a year comparison. */
function taxYearOf(isoDate) {
  const year = Number(String(isoDate ?? '').slice(0, 4))
  return Number.isFinite(year) && year > 1950 ? year : null
}

/**
 * Deposits into one account, on or after the date the room figure was accurate.
 *
 * Only contributions count — a buy inside the account moves money between
 * holdings, not into the account, and counting it would exhaust the room of
 * anyone who trades.
 */
export function depositsSince({ transactions = [], accountId, asOf }) {
  const from = String(asOf ?? '')
  return transactions
    .filter((t) => (
      t?.accountId === accountId
      && (t.action === 'TRANSFER' || t.action === 'CONTRIBUTION')
      && Number(t.quantity ?? 0) >= 0
      && typeof t.tradeDate === 'string'
      && (!from || t.tradeDate >= from)
    ))
    .reduce((sum, t) => sum + Math.abs(Number(t.amountMinor) || 0), 0)
}

/**
 * Where an account stands against the room the user entered.
 *
 * @param room { accountId, accountType, limitMinor, asOf } as the user stated it
 * @returns null when no room has been entered — nothing to say, and nothing to
 *   warn about. An absent figure is not zero room.
 */
export function roomStatus({ room, transactions = [], now = Date.now() } = {}) {
  if (!room?.accountId) return null

  const limitMinor = Number.isFinite(room.limitMinor) ? room.limitMinor : toMinorUnits(room.limit)
  if (!Number.isFinite(limitMinor) || limitMinor < 0) return null

  const statedYear = taxYearOf(room.asOf)
  const currentYear = new Date(now).getUTCFullYear()
  // A figure from a previous tax year is unknown, not smaller. The new year's
  // grant is not derivable from anything stored here.
  const stale = statedYear === null || statedYear < currentYear

  const depositedMinor = depositsSince({ transactions, accountId: room.accountId, asOf: room.asOf })
  const remainingMinor = limitMinor - depositedMinor

  return {
    accountId: room.accountId,
    accountType: String(room.accountType ?? '').trim().toUpperCase() || null,
    limitMinor,
    depositedMinor,
    // Reported even when stale, because it is still what the arithmetic says —
    // but `status` is what a caller gates a warning on, and a stale figure
    // never produces one.
    remainingMinor,
    asOf: room.asOf ?? null,
    stale,
    status: stale ? ROOM_STATUS.STALE : remainingMinor < 0 ? ROOM_STATUS.OVER : ROOM_STATUS.OK,
    overByMinor: !stale && remainingMinor < 0 ? Math.abs(remainingMinor) : 0,
    monthlyPenaltyMinor: !stale && remainingMinor < 0
      ? Math.round(Math.abs(remainingMinor) * MONTHLY_PENALTY_RATE)
      : 0,
    currency: 'CAD',
    excludesTfsaRecontribution: true,
  }
}

/**
 * Whether a contribution about to be made would go over — the warning that
 * arrives *before* the deposit rather than after it, which is the whole point
 * of the feature.
 *
 * Returns null when there is nothing to say: no room entered, or a stale
 * figure. Both mean the honest answer is "unknown", and a warning built on an
 * unknown is one someone would act on.
 */
export function checkContribution({ room, transactions = [], amountMinor, now = Date.now() } = {}) {
  const amount = Number.isFinite(amountMinor) ? amountMinor : toMinorUnits(amountMinor)
  if (!Number.isFinite(amount) || amount <= 0) return null

  const status = roomStatus({ room, transactions, now })
  if (!status) return null
  if (status.stale) {
    return {
      status: ROOM_STATUS.UNKNOWN,
      exceeds: false,
      asOf: status.asOf,
      accountType: status.accountType,
      excludesTfsaRecontribution: true,
    }
  }

  const remainingAfterMinor = status.remainingMinor - amount
  const excessMinor = remainingAfterMinor < 0 ? Math.abs(remainingAfterMinor) : 0

  return {
    status: excessMinor > 0 ? ROOM_STATUS.OVER : ROOM_STATUS.OK,
    exceeds: excessMinor > 0,
    accountType: status.accountType,
    amountMinor: amount,
    remainingBeforeMinor: status.remainingMinor,
    remainingAfterMinor,
    excessMinor,
    // 1% of the excess per month, for as long as it stays over.
    monthlyPenaltyMinor: Math.round(excessMinor * MONTHLY_PENALTY_RATE),
    asOf: status.asOf,
    currency: 'CAD',
    excludesTfsaRecontribution: true,
  }
}
