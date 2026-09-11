export const REVIEW_PRIORITY_VERSION = 'attention-review-priority-v2'

const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value))
const round = (value) => Number(value.toFixed(1))
const unique = (values) => [...new Set(values.filter(Boolean))]
const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const CATALYST = /\b(earnings|results|guidance|forecast|approval|approved|fda|trial|contract|award|launch|release|investor day|acquisition|merger|tender offer|buyback|dividend|spinoff|spin-off|open-market|insider|bought|purchased|price target|upgrade|downgrade)\b/i
const DATE = /\b(?:20\d{2}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[-/]\d{1,2}[-/]20\d{2}|(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+20\d{2})?)\b/i
const CONCRETE_NUMBER = /(?:\$\s?\d|\b\d+(?:\.\d+)?\s?(?:%|million|billion|trillion|[MBTK])\b)/i
const OPEN_MARKET = /(?:\b(?:ceo|cfo|director|chair(?:man|woman)?|officer|insider)\b.{0,100}\b(?:bought|purchased|acquired)\b|\bopen-market\s+(?:buy|purchase))/i
const ROUTINE_INSIDER = /\b(?:option exercise|exercised options?|vest(?:ed|ing)?|tax withholding|automatic sale|rule 10b5-1)\b/i
const HYPE = /\b(?:to the moon|guaranteed|can't lose|cannot lose|easy money|\d{2,4}x)\b/i
const NEGATIVE = /\b(?:bankrupt(?:cy)?|going concern|fraud|investigation|restatement|dilution|offering|missed estimates?|cut guidance|default|crash|collapse|material weakness)\b/i

function labels(evidence) {
  return (evidence.source?.labels || evidence.measurements?.attention?.sourceLabels || []).map((label) => String(label).toLowerCase())
}

function channel(evidence) {
  if (evidence.strategyFamily !== 'attention') return 'primary disclosure'
  const sourceLabels = labels(evidence)
  const type = String(evidence.source?.type || '').toLowerCase()
  const url = String(evidence.source?.url || '').toLowerCase()
  if (type === 'screener' || sourceLabels.includes('finviz') || sourceLabels.includes('premarket-movers')) return 'technical'
  if (sourceLabels.includes('exa-discovery') || type === 'news' || (url && !url.includes('x.com') && !url.includes('twitter.com'))) return 'news'
  if (type === 'account' || type === 'search' || url.includes('x.com') || url.includes('twitter.com')) return 'social'
  return 'attention'
}

function publisher(evidence) {
  const measured = String(evidence.measurements?.attention?.publisher || '').trim().toLowerCase()
  if (measured) return measured.replace(/^@/, '')
  try {
    const url = new URL(evidence.source?.url)
    if (['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com'].includes(url.hostname.toLowerCase())) return url.pathname.split('/').filter(Boolean)[0]?.toLowerCase() || null
    return url.hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return labels(evidence).find((label) => label.startsWith('@'))?.slice(1) || null
  }
}

// Long multi-ticker roundups otherwise give every mentioned security credit for
// every fact in the post. Only nearby paragraphs/sentences are inspected when a
// ticker or company name can be found.
function relevantText(evidence, ticker, name) {
  const text = String(evidence.source?.excerpt || evidence.interpretation?.thesis || '').replace(/\s+/g, ' ').trim()
  if (!text || text.length <= 600) return text
  const terms = unique([
    ticker && `\\$${escapeRegex(ticker)}\\b`,
    ticker && `\\b${escapeRegex(ticker)}\\b`,
    name && `\\b${escapeRegex(name)}\\b`,
  ])
  if (!terms.length) return text.slice(0, 600)
  const matcher = new RegExp(terms.join('|'), 'ig')
  const snippets = []
  for (const match of text.matchAll(matcher)) snippets.push(text.slice(Math.max(0, match.index - 220), Math.min(text.length, match.index + match[0].length + 220)))
  return snippets.length ? unique(snippets).join(' ') : text.slice(0, 600)
}

function normalizedText(value) {
  return value.toLowerCase().replace(/https?:\/\/\S+/g, '').replace(/\$?[a-z]{1,5}\b/gi, '').replace(/\d+(?:\.\d+)?/g, '#').replace(/[^a-z#]+/g, ' ').trim()
}

function evidenceQuality(count) {
  return [0, 8, 13, 17, 20][Math.min(count, 4)]
}

function sourceIndependence(count) {
  return [0, 5, 11, 16, 20][Math.min(count, 4)]
}

function freshnessScore(evidence, asOf) {
  const decisionTime = new Date(asOf).getTime()
  const newest = Math.max(...evidence.map((item) => Date.parse(item.publicAt)).filter(Number.isFinite))
  if (!Number.isFinite(decisionTime) || !Number.isFinite(newest) || newest > decisionTime + 300000) return 0
  const ageHours = (decisionTime - newest) / 3600000
  if (ageHours <= 6) return 10
  if (ageHours <= 24) return 8
  if (ageHours <= 48) return 5
  if (ageHours <= 168) return 2
  return 0
}

/**
 * Deterministic production score for ranking attention candidates before
 * Claude. Every input exists at the admission cutoff and every component is
 * returned for audit.
 */
export function attentionReviewPriority(evidence, { asOf = Date.now(), ticker, name } = {}) {
  const items = evidence.filter((item) => item.strategyFamily === 'attention')
  const documents = unique(items.map((item) => item.source?.documentId || item.id))
  const publishers = unique(items.map(publisher)).sort()
  const channels = unique(items.map(channel)).sort()
  const texts = items.map((item) => relevantText(item, ticker, name))
  const catalystTexts = texts.filter((text) => CATALYST.test(text))
  const hasCatalyst = catalystTexts.length > 0
  const hasDatedCatalyst = catalystTexts.some((text) => DATE.test(text))
  const hasConcreteFact = catalystTexts.some((text) => CONCRETE_NUMBER.test(text))
  const hasOpenMarketPurchase = catalystTexts.some((text) => OPEN_MARKET.test(text))
  const hasRoutineInsiderEvent = texts.some((text) => ROUTINE_INSIDER.test(text)) && !hasOpenMarketPurchase
  const technicalCount = items.filter((item) => channel(item) === 'technical').length
  const convictionCount = items.filter((item) => item.interpretation?.role !== 'context').length
  const negativeCount = texts.filter((text) => NEGATIVE.test(text)).length
  const normalized = texts.map(normalizedText).filter(Boolean)
  const duplicateRatio = normalized.length ? 1 - (unique(normalized).length / normalized.length) : 0
  const currentMaximum = Math.max(0, ...items.map((item) => Number(item.priority) || 0))

  const components = {
    evidenceQuality: evidenceQuality(documents.length),
    sourceIndependence: sourceIndependence(publishers.length),
    catalystSpecificity: (hasCatalyst ? 6 : 0) + (hasDatedCatalyst ? 6 : 0) + (hasConcreteFact ? 4 : 0) + (hasOpenMarketPurchase ? 4 : 0),
    technicalConfirmation: technicalCount >= 2 ? 10 : technicalCount === 1 ? 7 : 0,
    freshness: freshnessScore(items, asOf),
    crossChannelConfirmation: channels.length >= 3 ? 12 : channels.length === 2 ? 7 : 0,
    signalStrength: round(clamp(currentMaximum / 100, 0, 1) * 8),
    repetitionPenalty: documents.length >= 4 && publishers.length <= 1 ? -8 : duplicateRatio >= 0.5 ? -6 : 0,
    contextOnlyPenalty: items.length > 0 && convictionCount === 0 ? -8 : 0,
    routineInsiderPenalty: hasRoutineInsiderEvent ? -6 : 0,
    hypePenalty: texts.some((text) => HYPE.test(text)) && publishers.length <= 1 && channels.length <= 1 ? -6 : 0,
    negativeEvidencePenalty: -Math.min(12, negativeCount * 4),
  }
  const score = round(clamp(Object.values(components).reduce((sum, value) => sum + value, 0), 0, 100))
  return {
    version: REVIEW_PRIORITY_VERSION,
    score,
    components,
    features: {
      evidenceCount: documents.length,
      independentPublishers: publishers.length,
      channels,
      newestAgeScore: components.freshness,
      hasCatalyst,
      hasDatedCatalyst,
      hasConcreteFact,
      hasOpenMarketPurchase,
      technicalEvidenceCount: technicalCount,
      contextOnly: items.length > 0 && convictionCount === 0,
      duplicateRatio: round(duplicateRatio),
      negativeEvidenceCount: negativeCount,
    },
  }
}

export function reviewPriorityModel(candidate, { asOf = Date.now(), evidence = candidate.evidence || [] } = {}) {
  const streamScores = {}
  for (const item of evidence) streamScores[item.strategyFamily] = Math.max(streamScores[item.strategyFamily] || 0, Number(item.priority) || 0)
  const attention = evidence.some((item) => item.strategyFamily === 'attention')
    ? attentionReviewPriority(evidence, { asOf, ticker: candidate.ticker, name: candidate.name })
    : null
  if (attention) streamScores.attention = attention.score
  return {
    version: REVIEW_PRIORITY_VERSION,
    usedForAdmission: true,
    // Non-attention stream priorities retain their original precision and
    // behavior. Only the attention entry above is replaced with v2.
    score: Math.max(0, ...Object.values(streamScores)),
    streamScores,
    ...(attention && { attentionScore: attention.score, components: attention.components, features: attention.features }),
  }
}

export function compareAttentionPriorities(candidates, { asOf = Date.now(), budget = 12 } = {}) {
  const rows = candidates.filter((candidate) => (candidate.streams || candidate.strategies || []).includes('attention'))
    .map((candidate) => ({ ...candidate, legacyPriority: candidate.legacyPriority ?? candidate.priority,
      priorityModel: candidate.priorityModel || reviewPriorityModel(candidate, { asOf }) }))
  const legacy = [...rows].sort((a, b) => (b.legacyPriority || 0) - (a.legacyPriority || 0) || String(a.securityId).localeCompare(String(b.securityId)))
  const production = [...rows].sort((a, b) => b.priorityModel.streamScores.attention - a.priorityModel.streamScores.attention || String(a.securityId).localeCompare(String(b.securityId)))
  const legacyRanks = new Map(legacy.map((candidate, index) => [candidate.securityId, index + 1]))
  const productionRanks = new Map(production.map((candidate, index) => [candidate.securityId, index + 1]))
  const selectedLegacy = new Set(legacy.slice(0, budget).map((candidate) => candidate.securityId))
  const selectedProduction = new Set(production.slice(0, budget).map((candidate) => candidate.securityId))
  return {
    version: REVIEW_PRIORITY_VERSION,
    usedForAdmission: true,
    candidates: rows.length,
    budget,
    saturation: {
      legacyAt95: rows.filter((candidate) => (candidate.legacyPriority || 0) >= 95).length,
      productionAt95: rows.filter((candidate) => candidate.priorityModel.streamScores.attention >= 95).length,
    },
    legacyCutoff: legacy[budget - 1] ? { ticker: legacy[budget - 1].ticker, score: legacy[budget - 1].legacyPriority } : null,
    productionCutoff: production[budget - 1] ? { ticker: production[budget - 1].ticker, score: production[budget - 1].priorityModel.streamScores.attention } : null,
    entering: production.filter((candidate) => selectedProduction.has(candidate.securityId) && !selectedLegacy.has(candidate.securityId)).map((candidate) => ({ ticker: candidate.ticker, legacyRank: legacyRanks.get(candidate.securityId), productionRank: productionRanks.get(candidate.securityId), productionScore: candidate.priorityModel.streamScores.attention })),
    leaving: legacy.filter((candidate) => selectedLegacy.has(candidate.securityId) && !selectedProduction.has(candidate.securityId)).map((candidate) => ({ ticker: candidate.ticker, legacyRank: legacyRanks.get(candidate.securityId), productionRank: productionRanks.get(candidate.securityId), productionScore: candidate.priorityModel.streamScores.attention })),
    ordering: production.map((candidate, index) => ({ ticker: candidate.ticker, legacyScore: candidate.legacyPriority, productionScore: candidate.priorityModel.streamScores.attention, legacyRank: legacyRanks.get(candidate.securityId), productionRank: index + 1 })),
  }
}
