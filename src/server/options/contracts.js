import { digest } from '../research/archive.js'
import { regularSessionClose } from './calendar.js'

const osiPattern = /^([A-Z0-9.-]{1,6})(\d{2})(\d{2})(\d{2})([CP])(\d{8})$/

export function parseOsiSymbol(value) {
  const match = osiPattern.exec(String(value || '').trim().toUpperCase())
  if (!match) return null
  const [, root, year, month, day, side, strike] = match
  return {
    root,
    expirationDate: `20${year}-${month}-${day}`,
    type: side === 'C' ? 'call' : 'put',
    strikePrice: Number(strike) / 1000,
  }
}

function number(value) {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export function validateOptionContract(raw, { security, enumeratedAt, provider, calendar } = {}) {
  if (!security?.securityId || !security?.issuerId) throw new Error('A resolved underlying identity is required')
  if (!Number.isFinite(Date.parse(enumeratedAt))) throw new Error('A valid contract enumeration timestamp is required')
  const reasons = []
  const parsed = parseOsiSymbol(raw?.symbol)
  if (!parsed) reasons.push('invalid_osi_symbol')
  const underlying = String(raw?.underlying_symbol || '').toUpperCase()
  if (underlying !== security.ticker) reasons.push('underlying_identity_mismatch')
  if (raw?.root_symbol && parsed && String(raw.root_symbol).toUpperCase() !== parsed.root) reasons.push('root_symbol_mismatch')
  if (parsed && raw?.expiration_date !== parsed.expirationDate) reasons.push('expiration_mismatch')
  if (parsed && raw?.type !== parsed.type) reasons.push('contract_type_mismatch')
  const strike = number(raw?.strike_price)
  if (parsed && (strike === null || Math.abs(strike - parsed.strikePrice) > 0.0001)) reasons.push('strike_mismatch')
  if (String(raw?.style || '').toLowerCase() !== 'american') reasons.push('unsupported_exercise_style')
  if (number(raw?.multiplier) !== 100 || number(raw?.size) !== 100 || (Array.isArray(raw?.additional_underlyings) && raw.additional_underlyings.length)) reasons.push('nonstandard_deliverable')
  if (raw?.status !== 'active' || raw?.tradable !== true) reasons.push('contract_not_active_tradable')
  if (!raw?.id) reasons.push('missing_provider_contract_id')

  let lastTradingAt = null
  if (parsed) {
    try { lastTradingAt = regularSessionClose(parsed.expirationDate, calendar) }
    catch { reasons.push('unresolved_last_trading_session') }
  }

  if (reasons.length) return { ok: false, symbol: raw?.symbol ?? null, reasons: [...new Set(reasons)] }
  const contract = {
    contractId: `osi:${raw.symbol}`,
    osiSymbol: raw.symbol,
    provider,
    providerContractId: raw.id,
    providerUnderlyingId: raw.underlying_asset_id ?? null,
    securityId: security.securityId,
    issuerId: security.issuerId,
    underlyingTicker: security.ticker,
    rootSymbol: parsed.root,
    type: parsed.type,
    exerciseStyle: 'american',
    settlementStyle: 'physical',
    strikePrice: parsed.strikePrice,
    expirationDate: parsed.expirationDate,
    lastTradingAt,
    multiplier: 100,
    deliverableShares: 100,
    adjusted: false,
    pennyProgram: raw.ppind === true,
    enumeratedAt,
  }
  return { ok: true, contract: { ...contract, fingerprint: digest(contract) }, reasons: [] }
}

export function createContractEnumeration({ security, rawContracts, enumeratedAt, provider = 'unknown', calendar,
  complete = false, nextPageToken = null, requestedExpirationRange = null } = {}) {
  if (!Array.isArray(rawContracts)) throw new TypeError('rawContracts must be an array')
  const accepted = [], rejected = []
  for (const raw of rawContracts) {
    const result = validateOptionContract(raw, { security, enumeratedAt, provider, calendar })
    if (result.ok) accepted.push(result.contract)
    else rejected.push({ symbol: result.symbol, reasons: result.reasons })
  }
  const enumeration = {
    schemaVersion: 'options-contract-enumeration-v1',
    provider,
    enumeratedAt,
    securityId: security.securityId,
    issuerId: security.issuerId,
    underlyingTicker: security.ticker,
    contracts: accepted,
    rejected,
    complete: complete === true && !nextPageToken,
    nextPageToken,
    requestedExpirationRange,
  }
  return { ...enumeration, enumerationId: digest(enumeration) }
}

export function listedContract(enumeration, { contractId, expirationDate, securityId, issuerId } = {}) {
  if (!enumeration?.complete) return { listed: false, reason: 'enumeration_incomplete' }
  if (securityId && enumeration.securityId !== securityId) return { listed: false, reason: 'security_identity_mismatch' }
  if (issuerId && enumeration.issuerId !== issuerId) return { listed: false, reason: 'issuer_identity_mismatch' }
  const matches = enumeration.contracts.filter((contract) => (!contractId || contract.contractId === contractId || contract.osiSymbol === contractId)
    && (!expirationDate || contract.expirationDate === expirationDate))
  if (matches.length !== 1) return { listed: false, reason: matches.length ? 'ambiguous_contract' : 'contract_not_listed' }
  return { listed: true, contract: matches[0], enumerationId: enumeration.enumerationId }
}
