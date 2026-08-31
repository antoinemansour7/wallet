// ─── Yahoo Finance RSS ─────────────────────────────────────────────────────────

const YAHOO_FEEDS = [
  'https://finance.yahoo.com/news/rssindex',
  'https://finance.yahoo.com/rss/headline?s=SPY',
]

function parseRssItems(xml) {
  const items = []
  const itemRegex = /<item>([\s\S]*?)<\/item>/g
  let match
  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1]
    const get = (tag) => {
      const m = block.match(new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>|<${tag}[^>]*>([^<]*)<\\/${tag}>`))
      return m ? (m[1] ?? m[2] ?? '').trim() : ''
    }
    items.push({
      title:       get('title'),
      link:        get('link'),
      pubDate:     get('pubDate'),
      description: get('description').slice(0, 300),
      source:      'Yahoo Finance',
    })
  }
  return items
}

async function fetchFeed(url) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(10000) })
    if (!res.ok) return []
    const xml = await res.text()
    return parseRssItems(xml)
  } catch (err) {
    console.error(`[researchEngine] RSS fetch failed for ${url}:`, err.message)
    return []
  }
}

// Yahoo's feeds carry a long tail of evergreen content — the oldest item in a
// live pull was over two years old, and the median was already past the 30h
// signal window. Untouched, all of it reached the ranking prompt weighted the
// same as breaking news. Anything without a usable date is kept, since a missing
// pubDate is not evidence the item is stale.
const ARTICLE_MAX_AGE_MS = Number(process.env.NEWS_MAX_AGE_HOURS || 48) * 60 * 60 * 1000

export async function fetchAllYahooNews() {
  const results = await Promise.all(YAHOO_FEEDS.map(fetchFeed))
  const seen = new Set()
  const cutoff = Date.now() - ARTICLE_MAX_AGE_MS
  let stale = 0

  const fresh = results.flat().filter((item) => {
    if (!item.title || seen.has(item.title)) return false
    const published = Date.parse(item.pubDate)
    if (Number.isFinite(published) && published < cutoff) { stale += 1; return false }
    seen.add(item.title)
    return true
  })

  if (stale > 0) console.log(`[researchEngine] dropped ${stale} articles older than ${ARTICLE_MAX_AGE_MS / 36e5}h`)
  return fresh
}

// ─── Claude Sonnet: extract tickers ───────────────────────────────────────────

import Anthropic from '@anthropic-ai/sdk'
import { fetchMarketQuotes } from './marketQuotes.js'
import { extractTickersFromText } from './xSignals.js'

const CLAUDE_MODEL = 'claude-sonnet-5'

// Sonnet 5 controls thinking with an effort level, not a token budget: the
// older { type: 'enabled', budget_tokens } shape is rejected outright with a
// 400. Verified live on this key — 'high' returns a thinking block and clean
// JSON, 'medium' returns no thinking block at all.
const RESEARCH_EFFORT = process.env.RESEARCH_EFFORT || 'high'

const SQUEEZE_REGEX = /(short squeeze|short interest|gamma squeeze|squeez(?:e|ing)|days to cover|float rotation|covering)/i
const VOLUME_REGEX = /(unusual volume|relative volume|rvol|options sweep|dark pool|heavy volume|flow|accumulation)/i
const BREAKOUT_REGEX = /(breakout|reclaim|range expansion|trend continuation|flag breakout|base breakout|higher highs|momentum ignition|squeezing higher)/i
// A catalyst has to be a concrete, dated or contractual event. The previous
// pattern matched bare topic words — earnings, guidance, beat, miss, contract,
// launch — which appear in almost every financial headline, so nearly every
// media signal classified as "catalyst". That flooded the board with one setup
// type and fed the same mislabel into the setup-performance learning loop.
export const CATALYST_REGEX = new RegExp([
  // Regulatory and clinical events, specific by nature
  'pdufa',
  'phase [123]\\b',
  'fda (approval|clearance|decision|filing|submission)',
  'breakthrough (therapy )?designation',
  'orphan drug',
  // Corporate actions
  'definitive agreement',
  'tender offer',
  'takeover (bid|offer)',
  'buyout (bid|offer)',
  '(to be|agreed to be) acquired',
  'agreed to acquire',
  'merger (agreement|with)',
  'uplisting',
  'stock split',
  'special dividend',
  // Earnings tied to an actual event or surprise, not the topic
  'reports? (q[1-4]|fq[1-4]|earnings|results)',
  'earnings (call|date|report) (on|is|scheduled|set)',
  '(beats?|missed|misses) (estimates|consensus|expectations|the street)',
  '(raise[sd]?|lift(s|ed)?|cuts?|lowered|slashed) [a-z ]{0,14}guidance',
  'guidance (above|below|ahead of|raised|cut)',
  // Contracts and orders with substance attached
  '(awarded|wins|won|secures|secured|lands|landed) [a-z ]{0,24}(contract|order|deal|mandate)',
  '\\$[\\d.]+ ?(million|billion|[mb])\\b[a-z ,]{0,24}(contract|order|deal|award|backlog)',
  // Commercial launches, not "launched a blog"
  '(product|commercial|global|nationwide) launch',
  'launches? (its )?(new )?[a-z-]+ (platform|product|drug|service|chip|model)',
].join('|'), 'i')
const FAILURE_REGEX = /(collapse|collapsed|unwind|unwound|rug|rugged|bloodbath|dead cat|bagholder|dump|dumped|selloff|sell-off|guidance cut|cut guidance|secondary offering|offering|dilution|reverse split|halted|delisting|chapter 11|broken chart|crash|crashed|imploded|implosion)/i

const MEGA_CAP_TICKERS = new Set(['AAPL', 'MSFT', 'NVDA', 'AMZN', 'META', 'GOOGL', 'GOOG', 'TSLA'])

const TECH_THEMES = new Set(['semiconductor', 'ai', 'software', 'cloud', 'chip', 'gpu', 'cpu', 'saas', 'cyber', 'data', 'tech', 'computing', 'silicon', 'quantum', 'ml', 'automation'])

// Sector ETFs for trend detection — maps themes/keywords to sector ETFs
const SECTOR_ETF_MAP = {
  software: 'IGV', saas: 'IGV', cloud: 'IGV',
  semiconductor: 'SMH', chip: 'SMH', gpu: 'SMH', cpu: 'SMH', silicon: 'SMH',
  tech: 'XLK', ai: 'XLK', computing: 'XLK', cyber: 'XLK', data: 'XLK',
  biotech: 'XBI', pharma: 'XBI', fda: 'XBI',
  energy: 'XLE', oil: 'XLE', solar: 'XLE',
  finance: 'XLF', bank: 'XLF', fintech: 'XLF',
  crypto: 'BITO', bitcoin: 'BITO',
  defense: 'ITA', space: 'ITA', aerospace: 'ITA',
}

const ALL_SECTOR_ETFS = [...new Set(Object.values(SECTOR_ETF_MAP))]

function unique(items) {
  return [...new Set(items.filter(Boolean))]
}

function normalizeTicker(symbol) {
  return String(symbol || '').toUpperCase()
}

function priceBand(price) {
  if (!Number.isFinite(price)) return 'unknown'
  if (price < 5) return 'penny-risk'
  if (price < 12) return 'starter'
  if (price <= 80) return 'core-upside'
  if (price <= 280) return 'established'
  return 'large'
}

function pricePreferenceScore(price) {
  if (!Number.isFinite(price)) return -0.25
  if (price < 5) return -6.5
  if (price < 12) return 1.15
  if (price <= 80) return 1.45
  if (price <= 200) return 0.5
  return -0.15
}

function dominantSetupType(item) {
  const setupScores = [
    ['squeeze', item.squeezeSignals],
    ['breakout', item.breakoutSignals],
    ['volume', item.volumeSignals],
    ['catalyst', item.catalystSignals],
  ].sort((a, b) => b[1] - a[1])

  return setupScores[0][1] > 0 ? setupScores[0][0] : 'momentum'
}

// Cheap pre-rank used to pick which tickers are worth spending a quote lookup
// on. It has to mirror the archetype score's evidence types, or a weight there
// can never take effect: screener hits arrive one signal per ticker, so without
// a term of their own they lost every top-30 slot to media names carrying three
// or four articles, and no technically-qualified setup was ever priced.
function baseBoardSortScore(item) {
  return (item.signalCount * 1.4)
    + (item.sources.length * 1.1)
    + (item.maxScore * 0.35)
    + (item.accountMentions * 0.3)
    + ((item.screenerMentions || 0) * 1.35)
}

function buildSignalBoard(signals, articles) {
  const board = new Map()

  for (const signal of signals) {
    for (const ticker of signal.tickers || []) {
      if (!board.has(ticker)) {
        board.set(ticker, {
          ticker,
          signalCount: 0,
          articleCount: 0,
          maxScore: 0,
          sources: new Set(),
          themes: new Set(),
          snippets: [],
          squeezeSignals: 0,
          volumeSignals: 0,
          breakoutSignals: 0,
          catalystSignals: 0,
          negativeSignals: 0,
          accountMentions: 0,
          convictionMentions: 0,
          contextMentions: 0,
          searchMentions: 0,
          screenerMentions: 0,
          mediaMentions: 0,
        })
      }

      const item = board.get(ticker)
      item.signalCount += 1
      item.maxScore = Math.max(item.maxScore, Number(signal.score || 0))
      ;(signal.sourceLabels || []).forEach((source) => item.sources.add(source))
      ;(signal.themes || []).forEach((theme) => item.themes.add(theme))
      if (signal.text && item.snippets.length < 4) item.snippets.push(signal.text)
      if (signal.sourceType === 'account') item.accountMentions += 1
      if (signal.sourceRole === 'context') item.contextMentions += 1
      else item.convictionMentions += 1
      // Exa is curated financial media carrying an actual narrative, so it is
      // counted apart from X keyword search, whose low weight exists to discount
      // broad-match noise. Lumping them together scored Exa at a seventh of a
      // bare Finviz hit.
      const isMedia = (signal.sourceLabels || []).includes('exa-discovery')
      if (isMedia) item.mediaMentions += 1
      else if (signal.sourceType === 'search') item.searchMentions += 1
      if (signal.sourceType === 'screener') item.screenerMentions += 1

      if (signal.sourceType === 'screener') {
        // Screener signals carry text this pipeline generated about itself
        // ("identified as squeeze+breakout setup by technical screener"), which
        // tripped both the squeeze and breakout regexes on top of the screener
        // bonus — one mechanical hit scoring as three pieces of evidence.
        // Classify from the declared theme instead.
        const declared = new Set(signal.themes || [])
        if (declared.has('squeeze')) item.squeezeSignals += 1
        if (declared.has('breakout')) item.breakoutSignals += 1
        if (declared.has('earnings')) item.catalystSignals += 1
      } else {
        if (SQUEEZE_REGEX.test(signal.text)) item.squeezeSignals += 1
        if (VOLUME_REGEX.test(signal.text)) item.volumeSignals += 1
        if (BREAKOUT_REGEX.test(signal.text)) item.breakoutSignals += 1
        if (CATALYST_REGEX.test(signal.text)) item.catalystSignals += 1
        if (FAILURE_REGEX.test(signal.text)) item.negativeSignals += 1
      }
    }
  }

  for (const article of articles) {
    for (const ticker of extractTickersFromText(`${article.title} ${article.description}`)) {
      if (!board.has(ticker)) {
        board.set(ticker, {
          ticker,
          signalCount: 0,
          articleCount: 0,
          maxScore: 0,
          sources: new Set(),
          themes: new Set(),
          snippets: [],
          squeezeSignals: 0,
          volumeSignals: 0,
          breakoutSignals: 0,
          catalystSignals: 0,
          negativeSignals: 0,
          accountMentions: 0,
          convictionMentions: 0,
          contextMentions: 0,
          searchMentions: 0,
          screenerMentions: 0,
          mediaMentions: 0,
        })
      }

      const item = board.get(ticker)
      item.articleCount += 1
      if (article.title && item.snippets.length < 4) item.snippets.push(article.title)
      if (CATALYST_REGEX.test(`${article.title} ${article.description}`)) item.catalystSignals += 0.5
      if (FAILURE_REGEX.test(`${article.title} ${article.description}`)) item.negativeSignals += 0.5
    }
  }

  return [...board.values()]
    .map((item) => ({
      ...item,
      ticker: normalizeTicker(item.ticker),
      sources: [...item.sources],
      themes: [...item.themes],
    }))
    .sort((a, b) => baseBoardSortScore(b) - baseBoardSortScore(a))
}

/**
 * Choose which tickers are worth a quote lookup.
 *
 * Taking the top N of one ranked list hands the whole pool to whichever source
 * emitted the most signals — roughly 135 screener hits against 70 media names,
 * so one lane always shut the other out entirely and no weight could fix it.
 * Reserve a share for each lane instead, then let the archetype score rank
 * what comes back.
 */
export function selectCandidates(board, limit = 30) {
  const sorted = [...board].sort((a, b) => baseBoardSortScore(b) - baseBoardSortScore(a))
  const picked = new Map()

  const take = (predicate, count) => {
    let taken = 0
    for (const item of sorted) {
      if (taken >= count || picked.size >= limit) break
      if (picked.has(item.ticker) || !predicate(item)) continue
      picked.set(item.ticker, item)
      taken += 1
    }
  }

  const lane = Math.floor(limit * 0.4)
  // Corroboration across lanes is the strongest evidence the board produces.
  take((i) => i.screenerMentions > 0 && i.mediaMentions > 0, limit)
  take((i) => i.mediaMentions > 0, lane)
  take((i) => i.screenerMentions > 0, lane)
  // Remaining slots by overall rank — accounts, X search, news-only names.
  take(() => true, limit)

  return [...picked.values()]
}

function buildQuoteMap(quotes = []) {
  const map = new Map()
  for (const quote of quotes) {
    for (const symbol of [quote.symbol, quote.requestedSymbol].filter(Boolean)) {
      map.set(normalizeTicker(symbol), quote)
    }
  }
  return map
}

// Board items can come from older cached payloads that predate newer count
// fields — a single undefined field would turn the whole score into NaN.
function normalizeBoardItem(item) {
  const num = (value) => (Number.isFinite(value) ? value : 0)
  return {
    ...item,
    signalCount: num(item.signalCount),
    articleCount: num(item.articleCount),
    maxScore: num(item.maxScore),
    squeezeSignals: num(item.squeezeSignals),
    volumeSignals: num(item.volumeSignals),
    breakoutSignals: num(item.breakoutSignals),
    catalystSignals: num(item.catalystSignals),
    negativeSignals: num(item.negativeSignals),
    accountMentions: num(item.accountMentions),
    convictionMentions: num(item.convictionMentions),
    contextMentions: num(item.contextMentions),
    searchMentions: num(item.searchMentions),
    screenerMentions: num(item.screenerMentions),
    mediaMentions: num(item.mediaMentions),
    sources: item.sources || [],
    themes: item.themes || [],
  }
}

export function rankHighUpsideBoard(signalBoard, quotesByTicker = new Map(), sectorTrends = new Map()) {
  return signalBoard
    .map(normalizeBoardItem)
    .map((item) => {
      const quote = quotesByTicker.get(item.ticker)
      const price = Number.isFinite(Number(quote?.price)) ? Number(quote.price) : null
      const quoteChangePercent = Number.isFinite(Number(quote?.changePercent)) ? Number(quote.changePercent) : null
      const quoteVerified = Number.isFinite(price)
      const repeatedAttention = item.convictionMentions >= 1 && (item.signalCount >= 2 || item.sources.length >= 2)
      const setupType = dominantSetupType(item)
      const pennyStockRisk = price !== null && price < 5
      const hugeDownDay = quoteChangePercent !== null && quoteChangePercent <= -15
      const moderateDip = quoteChangePercent !== null && quoteChangePercent > -15 && quoteChangePercent <= -3
      const contextHeavy = item.convictionMentions === 0 && item.contextMentions > 0
      const mainstreamCrowdFavorite = MEGA_CAP_TICKERS.has(item.ticker)
      const megaCapPenalty = mainstreamCrowdFavorite ? 6 : 0

      let archetypeScore = (item.signalCount * 1.65)
        + (item.sources.length * 1.35)
        + (item.maxScore * 0.42)
        + (item.squeezeSignals * 2.4)
        + (item.volumeSignals * 1.8)
        + (item.breakoutSignals * 2.2)
        + (item.catalystSignals * 0.9)
        + (item.accountMentions * 0.5)
        + (item.convictionMentions * 0.75)
        + (item.searchMentions * 0.35)
        // A Finviz hit says the chart qualifies — necessary, not sufficient, and
        // 135 of them arrive per run. Media coverage is the scarcer input: it
        // carries why anyone would buy. Weight accordingly.
        + (item.screenerMentions * 1.6)
        + (item.mediaMentions * 1.15)
        + (Math.min(item.articleCount, 2) * 0.22)
        + (repeatedAttention ? 1.0 : -0.5)
        + pricePreferenceScore(price)

      if (pennyStockRisk) archetypeScore -= 3.25
      if (!quoteVerified) archetypeScore -= 6
      if (contextHeavy) archetypeScore -= 2.4

      // Tech sector preference (~62.5% tech target)
      const itemThemes = [...(item.themes || [])]
      const hasTechTheme = itemThemes.some((t) => TECH_THEMES.has(t.toLowerCase()))
      if (hasTechTheme) archetypeScore += 1.5

      // Sector downtrend penalty — penalize stocks in sectors with declining ETFs
      let sectorPenalty = 0
      for (const theme of itemThemes) {
        const etf = SECTOR_ETF_MAP[theme.toLowerCase()]
        if (etf && sectorTrends.has(etf)) {
          const etfChg = sectorTrends.get(etf)
          if (etfChg <= -3) sectorPenalty = Math.max(sectorPenalty, 3.0)
          else if (etfChg <= -1.5) sectorPenalty = Math.max(sectorPenalty, 1.5)
          else if (etfChg <= -0.5) sectorPenalty = Math.max(sectorPenalty, 0.5)
        }
      }
      if (sectorPenalty > 0) archetypeScore -= sectorPenalty

      // Signal volume alone shouldn't dominate — cap signal count contribution
      if (item.signalCount > 4 && item.sources.length <= 1) archetypeScore -= 2.0
      if (item.signalCount > 3 && !item.catalystSignals && !item.squeezeSignals && !item.breakoutSignals) archetypeScore -= 1.5

      if (item.negativeSignals > 0) archetypeScore -= item.negativeSignals * 1.8
      if (hugeDownDay) archetypeScore -= 5.5
      if (quoteChangePercent !== null && quoteChangePercent <= -8 && !hugeDownDay) archetypeScore -= 2.25
      if (moderateDip && !item.negativeSignals && repeatedAttention) archetypeScore += 1.2
      if (megaCapPenalty > 0) archetypeScore -= megaCapPenalty
      if (item.articleCount > item.signalCount + 2) archetypeScore -= 0.75

      const brokenSetupRisk = Boolean(
        hugeDownDay
        || item.negativeSignals >= 2
        || (item.negativeSignals >= 1 && (item.squeezeSignals + item.breakoutSignals + item.volumeSignals) <= item.negativeSignals)
      )

      const exceptionalPennySetup = Boolean(
        pennyStockRisk
        && repeatedAttention
        && item.sources.length >= 2
        && item.catalystSignals >= 2
        && (item.squeezeSignals + item.breakoutSignals + item.volumeSignals) >= 4
        && !brokenSetupRisk
        && archetypeScore >= 12.5
      )

      if (exceptionalPennySetup) archetypeScore += 2.1

      return {
        ...item,
        price,
        quoteVerified,
        quoteChangePercent,
        priceBand: priceBand(price),
        pennyStockRisk,
        exceptionalPennySetup,
        moderateDip,
        repeatedAttention,
        brokenSetupRisk,
        mainstreamCrowdFavorite,
        setupType,
        archetypeScore: Number(archetypeScore.toFixed(2)),
      }
    })
    .sort((a, b) => {
      if (b.archetypeScore !== a.archetypeScore) return b.archetypeScore - a.archetypeScore
      if (b.signalCount !== a.signalCount) return b.signalCount - a.signalCount
      return b.maxScore - a.maxScore
    })
}

async function getRankedSignalBoard(signals, articles) {
  const baseBoard = buildSignalBoard(signals, articles)
  const candidateTickers = selectCandidates(baseBoard).map((item) => item.ticker)
  let quotesByTicker = new Map()
  let sectorTrends = new Map()

  if (candidateTickers.length > 0) {
    try {
      const quoteResult = await fetchMarketQuotes([...candidateTickers, ...ALL_SECTOR_ETFS])
      quotesByTicker = buildQuoteMap(quoteResult.quotes)

      // Build sector trend map from ETF performance
      for (const etf of ALL_SECTOR_ETFS) {
        const quote = quotesByTicker.get(etf)
        if (quote) {
          const chg = Number(quote.changePercent ?? quote.regularMarketChangePercent ?? 0)
          sectorTrends.set(etf, chg)
          // Remove ETFs from ticker map so they don't appear as picks
          quotesByTicker.delete(etf)
        }
      }
      console.log('[researchEngine] sector trends:', Object.fromEntries(sectorTrends))
    } catch (err) {
      console.error('[researchEngine] ticker quote enrichment failed:', err.message)
    }
  }

  const ranked = rankHighUpsideBoard(baseBoard, quotesByTicker, sectorTrends)
  return { board: ranked, sectorTrends }
}

function sanitizeSignalText(text) {
  if (!text) return ''
  return String(text)
    .replace(/^(ignore|forget|disregard|override|return|you are|you must|system:|assistant:).*/gim, '[redacted]')
    .slice(0, 300)
}

export function summarizeSignalsForPrompt(signals, articles, options = {}) {
  const signalBoard = options.signalBoard ?? rankHighUpsideBoard(buildSignalBoard(signals, articles))
  const topBoardTickers = new Set(signalBoard.slice(0, 15).map((item) => item.ticker))

  const boardJson = signalBoard.slice(0, 30).map((item) => ({
    ticker: item.ticker,
    xMentions: item.signalCount,
    conviction: item.convictionMentions,
    context: item.contextMentions,
    sources: item.sources.length,
    articles: item.articleCount,
    verified: item.quoteVerified ?? false,
    price: item.price !== null ? Number(item.price.toFixed(2)) : null,
    band: item.priceBand,
    setup: item.setupType,
    repeated: item.repeatedAttention ?? false,
    broken: item.brokenSetupRisk ?? false,
    dipBuy: item.moderateDip ?? false,
    dayChange: item.quoteChangePercent !== null ? Number(item.quoteChangePercent.toFixed(1)) : null,
    archetype: Number(item.archetypeScore.toFixed(2)),
    squeeze: item.squeezeSignals,
    volume: item.volumeSignals,
    breakout: item.breakoutSignals,
    catalyst: item.catalystSignals,
    negative: item.negativeSignals,
    screener: item.screenerMentions,
    sample: sanitizeSignalText(item.snippets[0]).slice(0, 140),
  }))
  const boardText = JSON.stringify(boardJson, null, 2)

  // Ensure each top-15 ticker gets up to 15 signals for Claude to read
  const MAX_PER_TICKER = 15
  const signalsByTicker = new Map()
  for (const ticker of topBoardTickers) signalsByTicker.set(ticker, [])

  for (const signal of signals) {
    for (const ticker of (signal.tickers || [])) {
      if (topBoardTickers.has(ticker) && signalsByTicker.get(ticker).length < MAX_PER_TICKER) {
        signalsByTicker.get(ticker).push(signal)
      }
    }
  }

  const seen = new Set()
  const dedupedSignals = [...signalsByTicker.values()].flat().filter((s) => {
    if (seen.has(s.id)) return false
    seen.add(s.id)
    return true
  })

  const signalText = dedupedSignals
    .map((signal) => (
      `[${Number(signal.score || 0).toFixed(2)}] ${signal.sourceType.toUpperCase()} ${signal.sourceLabels?.join(', ') || 'unknown'}`
      + ` | tickers=${signal.tickers?.join(', ') || 'none'}`
      + ` | themes=${signal.themes?.join(', ') || 'none'}`
      + ` | @${signal.username || 'unknown'}: ${sanitizeSignalText(signal.text)}`
    ))
    .join('\n')

  return { signalBoard, boardText, signalText }
}

const TICKER_SYSTEM_PROMPT = `You are an elite stock signal analyst. Your job is to find the stocks most likely to rise in the NEXT TRADING SESSION (measured open→close). The user buys at the next open and is scored on that single session — a great pick that takes a week to move is a failed pick here. You think critically, not reactively.

Because the horizon is one session, weight these hardest:
- Catalysts landing TODAY or TOMORROW (earnings before open/after close, FDA dates, scheduled announcements) beat vague "upcoming" catalysts
- earnings-calendar and premarket-movers screener signals are time-critical — a stock reporting earnings tomorrow morning IS tomorrow's mover, in one direction or the other; pick them only when the setup and positioning favor an upside reaction
- Fresh signals (<24h) beat persistent multi-day chatter, which is usually already priced in

## Your Decision Framework

Signal volume (mentions, chatter) is a CLUE, not a CONCLUSION. A stock mentioned 10 times by the same person is noise. A stock mentioned independently by 3 different traders with specific catalyst language is signal. You must distinguish between:
- "Attention because it's setting up" → potential buy
- "Attention because it's crashing/controversial" → avoid
- "Attention from repetition/spam" → discount heavily

For each candidate, evaluate these dimensions:
1. CATALYST QUALITY — Is there a specific, time-bound event? (earnings date, FDA ruling, contract announcement, product launch) A vague "bullish vibes" thesis is worth far less than "reports Q2 earnings May 8 with whisper numbers 20% above consensus"
2. TECHNICAL SETUP — Use the per-ticker technical analysis provided (RSI, SMA20/SMA50, MACD, trend label, % from 52-week high, relative volume). Do NOT guess at chart conditions — use the actual numbers. A stock with RSI >70 is overbought. Price below SMA50 is a downtrend. MACD histogram negative = losing momentum. Relative volume >1.5 = unusual interest.
3. SECTOR CONDITIONS — Check the sector ETF trends provided. A stock in a sector that's declining -3%+ needs an exceptionally strong idiosyncratic catalyst to overcome headwinds. Don't fight the trend without cause.
4. RISK/REWARD — What's the downside if wrong vs upside if right? A stock at $5 support with $8 target is 60% upside / 20% downside. That's asymmetry. A stock already up 40% in 2 weeks with no floor? That's risk.
5. SOURCE INDEPENDENCE — Are multiple independent traders/sources flagging this? Or is it one loud account tweeting 5 times? Check sourceCount and contextMentions vs convictionMentions.
6. REGIME FIT — Read the MACRO BACKDROP section for the environment these picks have to survive: rates, liquidity, positioning, geopolitics. Tighten conviction and size when the backdrop is hostile (rising yields, risk-off, escalation); allow more when it is supportive. A good setup in a bad tape is still a bad trade. The backdrop constrains picks, it never creates them.

## What Makes a Great Pick
- Multiple independent sources with conviction language (not just context)
- Specific catalyst with a date or timeline
- Technical setup showing consolidation/breakout, not extension — confirmed by RSI <70, price above SMA20+SMA50, and positive MACD histogram
- Sector tailwinds OR idiosyncratic story strong enough to override headwinds
- Screener confirmation (sourceType=screener = price action validated)
- Repeated attention across multiple days (repeatedAttention=true)

## What to Reject
- High signal count but all from one source or one day → noise
- "Momentum" with no specific catalyst → could reverse any day
- Sector in decline with no stock-specific reason to outperform
- Already extended 50%+ monthly → late entry, UNLESS there is an exceptional upcoming catalyst (earnings date, FDA ruling, major contract) with strong multi-source independent conviction. If a stock already ripped, you need a very specific reason it continues — not just "it's been going up"
- Penny stocks / sub-$5 unless exceptional multi-source + catalyst + screener overlap
- Broken charts (down 15%+) where attention is about damage, not recovery setup
- Mega-caps unless a very specific near-term catalyst + strong X setup exists

## Output Format
Return ONLY a valid JSON array, no markdown fences, no explanation:
[{"ticker":"RKLB","conviction":9,"reason":"NASA awarded a $150M hypersonic test contract last week, and 3 independent flow traders flagged heavy May call buying. The stock is consolidating at $42 support with a screener-confirmed breakout pattern — classic pre-catalyst coil with asymmetric upside if the contract pipeline accelerates."},...]

Rules:
- conviction 1–10 (10 = strongest). Be honest — a 7 with clear reasoning beats an inflated 9
- reason: 2-4 sentences (40-80 words). Explain the SPECIFIC catalyst, why the setup is compelling, and what makes the risk/reward asymmetric. Reference concrete details from the signals — dates, price levels, contract values, earnings dates, specific trader observations. Also reference the technical setup (RSI, trend, MACD direction) to validate entry timing. This is the main thing users read, make it insightful and specific, not generic.
- Max 5 tickers, sorted by conviction descending
- Only quote-verified, tradable tickers from the board
- PREFER band=starter or band=core-upside
- TARGET sector allocation: ~62.5% tech/semiconductor/software, ~37.5% other sectors
- If equal setups, prefer the tech stock
- AVOID: broad ETFs (SPY, QQQ, IWM, IGV)
- Use the ticker board first for setup quality, then X signals for nuance and catalyst specificity`

// Housekeeping posts from the same desks: subscription pushes, "sale ends
// tonight", and the TV-hit scheduling notes ("looking forward to joining X at
// 8am"). They are frequent, they are always the newest thing in the feed, and
// they say nothing about the regime. Deliberately narrow — this matches posting
// *about the account* rather than any word that happens to look commercial, so
// a real story about a company's discounting or a Fed speaker's schedule still
// gets through.
const MACRO_HOUSEKEEPING_REGEX = /(\b\d{1,2}% off\b|\bsale (has begun|ends|is live)\b|\buse code\b|\blink in bio\b|\bsign ?up\b|\bsubscribe\b|\bpromo\b|\b(is|are) live now\b|\blooking forward to joining\b|\b(catch|join) me on\b|\bwill be (on|joining) @)/i

const MACRO_BLOCK_LIMIT = 14

// Context accounts are macro desks, not stock pickers: they explain the regime a
// pick has to survive, and whatever tickers they name are usually incidental to
// the point being made. The board rightly refuses to promote a ticker carried
// only by context mentions — which meant their commentary had no route to the
// model at all, so the one input that should shape sizing and risk appetite was
// the one input being thrown away. This surfaces the posts themselves, kept
// deliberately apart from the pick evidence so they inform the read on the tape
// without becoming candidates.
//
// Selection is round-robin across desks rather than newest-first. These accounts
// post at wildly different rates — one of them posts every ~18 minutes and the
// other two in bursts a few times a day — so straight recency handed 11 of 14
// slots to the loudest desk and pushed the slower, more considered macro reads
// out of the prompt entirely. Frequency is not authority.
export function buildMacroContextBlock(signals) {
  const byDesk = new Map()
  for (const signal of signals) {
    if (signal.sourceRole !== 'context' || signal.sourceType !== 'account') continue
    if (!signal.text || MACRO_HOUSEKEEPING_REGEX.test(signal.text)) continue
    if (!byDesk.has(signal.username)) byDesk.set(signal.username, [])
    byDesk.get(signal.username).push(signal)
  }
  if (byDesk.size === 0) return ''

  for (const posts of byDesk.values()) {
    posts.sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0))
  }

  const picked = []
  for (let rank = 0; picked.length < MACRO_BLOCK_LIMIT; rank += 1) {
    let placed = false
    for (const posts of byDesk.values()) {
      if (!posts[rank]) continue
      picked.push(posts[rank])
      placed = true
      if (picked.length >= MACRO_BLOCK_LIMIT) break
    }
    if (!placed) break
  }
  picked.sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0))

  const lines = picked.map((post) => {
    const ageH = (Date.now() - Date.parse(post.createdAt || 0)) / 36e5
    const age = !Number.isFinite(ageH) ? '?'
      : ageH < 24 ? `${Math.round(ageH)}h`
      : `${Math.round(ageH / 24)}d`
    const body = post.text.replace(/\s+/g, ' ').slice(0, 300)
    return `  [@${post.username}, ${age} ago] ${body}`
  })

  return [
    '',
    '=== MACRO BACKDROP (context desks — regime, not picks) ===',
    ...lines,
    'Read this for the environment: rates, liquidity, positioning, risk appetite, geopolitics.',
    'Use it to decide how aggressive to be, and to reject picks that fight the current regime.',
    'Do NOT generate a pick from this section — a ticker appearing here is evidence of nothing',
    'unless it also appears on the board above.',
    '',
  ].join('\n')
}

function buildTickerUserMessage(signals, articles, signalBoard, sectorTrends = new Map(), technicals = new Map()) {
  const { boardText, signalText } = summarizeSignalsForPrompt(signals, articles, { signalBoard })
  const articleTexts = articles.slice(0, 25).map((a) => `${a.title} — ${a.description}`).join('\n')

  let sectorBlock = ''
  if (sectorTrends.size > 0) {
    const lines = [...sectorTrends.entries()]
      .sort((a, b) => a[1] - b[1])
      .map(([etf, chg]) => `  ${etf}: ${chg >= 0 ? '+' : ''}${chg.toFixed(2)}%`)
    sectorBlock = `\n=== SECTOR ETF TRENDS (today's session move) ===\n${lines.join('\n')}\nETFs in decline signal broad sector headwinds — picks from those sectors need extra-strong catalysts to justify.\n`
  }

  let techBlock = ''
  if (technicals.size > 0) {
    const lines = [...technicals.values()]
      .filter((t) => t.analyzed)
      .map((t) => {
        const parts = [
          `${t.ticker}: trend=${t.trend}`,
          t.rsi != null ? `RSI=${t.rsi}` : null,
          t.sma20 != null ? `SMA20=${t.sma20}` : null,
          t.sma50 != null ? `SMA50=${t.sma50}` : null,
          t.price != null ? `price=${t.price}` : null,
          t.macd ? `MACD=${t.macd.macd} signal=${t.macd.signal} hist=${t.macd.histogram}` : null,
          t.pctFrom52wHigh != null ? `from52wHigh=${t.pctFrom52wHigh}%` : null,
          t.relativeVolume != null ? `relVol=${t.relativeVolume}` : null,
        ].filter(Boolean)
        return `  ${parts.join(', ')}`
      })
    if (lines.length > 0) {
      techBlock = `\n=== PER-TICKER TECHNICAL ANALYSIS (12-month daily candles) ===\n${lines.join('\n')}\nUse these to validate entry timing. Reject overbought (RSI>70) or downtrend stocks unless the catalyst is exceptional.\n`
    }
  }

  const macroBlock = buildMacroContextBlock(signals)

  return `=== HIGH-UPSIDE TICKER BOARD ===
${boardText}
${sectorBlock}${techBlock}${macroBlock}
=== X SIGNALS (${signals.length} total, showing top matches) ===
${signalText}

=== NEWS CONTEXT ===
${articleTexts}`
}

// Score adjustment from the actual chart, so entry timing isn't left to the
// LLM's discretion alone. Positive = confirmed setup, negative = bad entry.
export function technicalAdjustment(tech) {
  if (!tech) return 0
  let adj = 0

  const trendAdj = {
    'uptrend': 1.2,
    'recovery': 0.5,
    'consolidating': 0.4,
    'pullback': 0,
    'overbought-uptrend': -1.8,
    'oversold-downtrend': -1.5,
    'downtrend': -2.5,
  }
  adj += trendAdj[tech.trend] ?? 0

  const hist = tech.macd?.histogram
  if (Number.isFinite(hist)) adj += hist > 0 ? 0.6 : -0.6

  if (Number.isFinite(tech.rsi)) {
    if (tech.rsi > 75) adj -= 1.0
    else if (tech.rsi >= 45 && tech.rsi <= 65) adj += 0.5
  }

  if (Number.isFinite(tech.relativeVolume)) {
    if (tech.relativeVolume >= 1.5) adj += 0.8
    else if (tech.relativeVolume >= 1.2) adj += 0.4
  }

  return Number(adj.toFixed(2))
}

// Feedback loop applied numerically, not just as prompt text: setups with a
// proven (n>=5) weighted win rate get boosted, proven losers get penalized.
export function setupPerformanceAdjustment(setupType, stats) {
  const setupStats = stats?.bySetup?.[setupType]
  if (!setupStats || setupStats.total < 5) return 0
  if (setupStats.weightedWinRate >= 60) return 1.5
  if (setupStats.weightedWinRate <= 30) return -2.0
  return 0
}

// Per-source feedback: signal sources (X accounts, finviz, exa) with a proven
// track record boost the picks they flagged; proven losers drag them down.
// Capped so no single dimension dominates the composite.
export function sourcePerformanceAdjustment(sources, stats) {
  const bySource = stats?.bySource
  if (!bySource || !sources || sources.length === 0) return 0

  let adj = 0
  for (const source of sources) {
    const sourceStats = bySource[source]
    if (!sourceStats || sourceStats.total < 3) continue
    if (sourceStats.weightedWinRate >= 60) adj += 0.75
    else if (sourceStats.weightedWinRate <= 30) adj -= 1.0
  }

  return Number(Math.max(-2, Math.min(1.5, adj)).toFixed(2))
}

export function postProcessCandidates(parsed, signalBoard, technicals = new Map(), options = {}) {
  const boardByTicker = new Map(signalBoard.map((item) => [item.ticker, item]))
  const recentPickedTickers = options.recentPickedTickers ?? new Set()
  const performanceStats = options.performanceStats ?? null
  const normalized = parsed
    .filter((t) => t.ticker && typeof t.conviction === 'number')
    .map((tickerObj) => {
      const ticker = normalizeTicker(tickerObj.ticker)
      const summary = boardByTicker.get(ticker)
      const tech = technicals.get(ticker)
      const techAdjustment = technicalAdjustment(tech?.analyzed ? tech : null)
      const setupAdjustment = setupPerformanceAdjustment(summary?.setupType ?? 'momentum', performanceStats)
      const sourceAdjustment = sourcePerformanceAdjustment(summary?.sources ?? [], performanceStats)
      return {
        techAdjustment,
        setupAdjustment,
        sourceAdjustment,
        sources: summary?.sources ?? [],
        ...tickerObj,
        ticker,
        sourceCount: summary?.sources.length ?? 0,
        signalCount: summary?.signalCount ?? 0,
        articleCount: summary?.articleCount ?? 0,
        themes: unique(summary?.themes ?? []).slice(0, 4),
        setupType: summary?.setupType ?? 'momentum',
        archetypeScore: summary?.archetypeScore ?? 0,
        price: summary?.price ?? null,
        quoteVerified: Boolean(summary?.quoteVerified),
        quoteChangePercent: summary?.quoteChangePercent ?? null,
        priceBand: summary?.priceBand ?? 'unknown',
        repeatedAttention: Boolean(summary?.repeatedAttention),
        pennyStockRisk: Boolean(summary?.pennyStockRisk),
        exceptionalPennySetup: Boolean(summary?.exceptionalPennySetup),
        brokenSetupRisk: Boolean(summary?.brokenSetupRisk),
        mainstreamCrowdFavorite: Boolean(summary?.mainstreamCrowdFavorite),
        convictionMentions: summary?.convictionMentions ?? 0,
        contextMentions: summary?.contextMentions ?? 0,
        recentRepeat: recentPickedTickers.has(ticker),
        // ATR-based exit levels: stop 1.5×ATR below, target 2.5×ATR above
        stopLoss: tech?.analyzed && Number.isFinite(tech.atr) && summary?.price
          ? Number((summary.price - 1.5 * tech.atr).toFixed(2)) : null,
        target: tech?.analyzed && Number.isFinite(tech.atr) && summary?.price
          ? Number((summary.price + 2.5 * tech.atr).toFixed(2)) : null,
        compositeScore: Number((
          (Number(tickerObj.conviction) * 1.5)
          + (summary?.archetypeScore ?? 0)
          + techAdjustment
          + setupAdjustment
          + sourceAdjustment
        ).toFixed(2)),
        technicals: tech?.analyzed ? {
          rsi: tech.rsi,
          sma20: tech.sma20,
          sma50: tech.sma50,
          macd: tech.macd,
          trend: tech.trend,
          pctFrom52wHigh: tech.pctFrom52wHigh,
          relativeVolume: tech.relativeVolume,
        } : null,
      }
    })

  const fresh = normalized.filter((item) => !item.recentRepeat)
  const candidates = fresh.length > 0 ? fresh : normalized

  const strict = candidates
    .filter((item) => item.quoteVerified)
    .filter((item) => !item.pennyStockRisk || item.exceptionalPennySetup)
    .filter((item) => item.repeatedAttention)
    .filter((item) => !item.brokenSetupRisk)
    .filter((item) => !item.mainstreamCrowdFavorite)
    .filter((item) => item.convictionMentions > 0)
    .sort((a, b) => b.compositeScore - a.compositeScore)

  if (strict.length > 0) return strict.slice(0, 5)

  const relaxed = candidates
    .filter((item) => item.quoteVerified)
    .filter((item) => !item.pennyStockRisk || item.exceptionalPennySetup)
    .filter((item) => !item.brokenSetupRisk)
    .filter((item) => !item.mainstreamCrowdFavorite)
    .filter((item) => item.convictionMentions > 0 || item.signalCount > item.contextMentions)
    .sort((a, b) => b.compositeScore - a.compositeScore)
    .slice(0, 5)

  if (relaxed.length > 0) return relaxed

  console.warn('[researchEngine] all filters returned 0 tickers — using minimal fallback')
  return candidates
    .filter((item) => item.quoteVerified)
    .sort((a, b) => b.compositeScore - a.compositeScore)
    .slice(0, 3)
}

export async function extractTickers(signals, articles, options = {}) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set')

  const { board: signalBoard, sectorTrends } = await getRankedSignalBoard(signals, articles)

  // Fetch per-ticker technical analysis for top candidates
  const { analyzeTickersBatch } = await import('./technicalAnalysis.js')
  const candidateTickers = signalBoard.slice(0, 15).map((item) => item.ticker)
  let technicals = new Map()
  try {
    technicals = await analyzeTickersBatch(candidateTickers, { concurrency: 3 })
    const analyzed = [...technicals.values()].filter((t) => t.analyzed).length
    console.log(`[researchEngine] technical analysis: ${analyzed}/${candidateTickers.length} tickers analyzed`)
  } catch (err) {
    console.error('[researchEngine] technical analysis failed:', err.message)
  }

  // Load historical performance stats for feedback loop
  let performanceBlock = ''
  let performanceStats = null
  let recentPickedTickers = new Set()
  try {
    const { getWinRateStats, formatStatsForPrompt, getRecentPickedTickers } = await import('./agents/signalHistoryTools.js')
    const stats = await getWinRateStats()
    performanceStats = stats
    performanceBlock = formatStatsForPrompt(stats)
    if (performanceBlock) console.log(`[researchEngine] feedback loop: loaded stats from ${stats.totalPicks} tracked picks`)
    recentPickedTickers = await getRecentPickedTickers(3)
    if (recentPickedTickers.size > 0) console.log(`[researchEngine] cooldown: blocking ${recentPickedTickers.size} recently picked tickers`)
  } catch (err) {
    console.error('[researchEngine] performance stats load failed:', err.message)
  }

  const freshSignalBoard = signalBoard.filter((item) => !recentPickedTickers.has(item.ticker))
  const candidateSignalBoard = freshSignalBoard.length > 0 ? freshSignalBoard : signalBoard

  // Hand the ranked board to the caller (shadow tracking trains the feedback
  // loop on top candidates that never make the final cut)
  options.onBoard?.(candidateSignalBoard)

  const client = new Anthropic({ apiKey })
  const userContent = buildTickerUserMessage(signals, articles, candidateSignalBoard, sectorTrends, technicals)

  // Inject performance feedback into the system prompt
  const systemPrompt = performanceBlock
    ? `${TICKER_SYSTEM_PROMPT}\n\n${performanceBlock}`
    : TICKER_SYSTEM_PROMPT

  const messages = [{ role: 'user', content: userContent }]

  let parsed
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await client.messages.create({
      model: CLAUDE_MODEL,
      // Thinking tokens are drawn from this same budget, so the answer can be
      // truncated even when the text itself is short — which is what happened
      // on the first production run: 1685 chars of valid JSON cut mid-string,
      // reported as a parse error and silently costing a whole retry. 16000 is
      // as high as this can go while stream:false, above which the SDK refuses
      // the request outright.
      max_tokens: 16000,
      // Ranking 30 candidates against six rejection criteria, sector trends and
      // per-ticker technicals is exactly the shape of work extended thinking is
      // for, and it had never been switched on — the block below has always
      // skipped thinking blocks that could not occur. It also helps with the
      // empty first attempt this loop retries around: given somewhere to
      // reason, the model stops using the answer slot to think out loud.
      thinking: { type: 'adaptive' },
      output_config: { effort: RESEARCH_EFFORT },
      stream: false,
      system: systemPrompt,
      messages,
    })
    const message = typeof response === 'string' ? JSON.parse(response) : response

    // Find the text block (skip thinking blocks)
    const textBlock = (message.content || []).find((b) => b.type === 'text')
    const raw = (textBlock?.text ?? '').trim()
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/, '')

    console.log(
      `[researchEngine] Claude attempt ${attempt + 1} raw (${raw.length} chars, `
      + `stop=${message.stop_reason}):`, raw.slice(0, 200),
    )
    // Truncation and malformed output need different fixes, and reporting the
    // first as the second sent us looking at the prompt instead of the budget.
    if (message.stop_reason === 'max_tokens') {
      console.warn(`[researchEngine] attempt ${attempt + 1} hit max_tokens — output truncated, not malformed`)
    }
    if (!raw) console.log('[researchEngine] content blocks:', JSON.stringify((message.content || []).map(b => ({ type: b.type, len: b.text?.length }))))

    if (!raw) {
      if (attempt < 2) {
        messages.push({ role: 'assistant', content: '[]' })
        messages.push({ role: 'user', content: 'The response was empty. Return ONLY a valid JSON array of ticker picks. No explanation, just the JSON.' })
        continue
      }
      throw new Error(`Claude returned empty response (stop_reason: ${message.stop_reason})`)
    }

    try {
      parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) break
      throw new Error('Claude did not return a JSON array')
    } catch (err) {
      if (attempt < 2) {
        messages.push({ role: 'assistant', content: raw })
        messages.push({ role: 'user', content: 'That was not valid JSON. Return ONLY a valid JSON array, no explanation.' })
        continue
      }
      throw err
    }
  }

  return postProcessCandidates(parsed, candidateSignalBoard, technicals, { recentPickedTickers, performanceStats })
}

// ─── Final re-ranking after the contrarian + catalyst agents ──────────────────
// Those agents produce riskScore, catalystVerified, catalystPricedIn and
// catalystConfidence — this folds them into the order picks are delivered in,
// instead of leaving them as display-only metadata.

export function finalizePicks(picks) {
  if (!picks || picks.length === 0) return []

  const scored = picks.map((pick) => {
    let score = (Number(pick.conviction) || 5) * 1.5 + (pick.archetypeScore ?? 0) * 0.4

    if (pick.catalystVerified === true && !pick.catalystPricedIn) {
      score += 2.5 + (Number(pick.catalystConfidence) || 5) * 0.3
    } else if (pick.catalystVerified === false) {
      score -= 1.5
    }
    if (pick.catalystPricedIn) score -= 3

    const risk = Number(pick.riskScore)
    if (Number.isFinite(risk)) {
      if (risk >= 8) score -= 3
      else if (risk >= 6) score -= 1
      else if (risk <= 3) score += 1
    }

    score += pick.techAdjustment ?? 0

    return { ...pick, finalScore: Number(score.toFixed(2)) }
  })

  // Hard gate: a pick whose catalyst is already priced in AND that carries
  // extreme contrarian risk has no edge left — drop it if alternatives exist.
  const dangerous = (pick) => pick.catalystPricedIn && (Number(pick.riskScore) || 0) >= 8
  const safe = scored.filter((pick) => !dangerous(pick))
  const kept = safe.length > 0 ? safe : scored

  return kept.sort((a, b) => b.finalScore - a.finalScore)
}

// ─── OpenAI: generate research reports (with web search) ─────────────────────

import OpenAI from 'openai'

const OPENAI_RESEARCH_MODEL = 'gpt-4.1-mini'

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function buildResearchPrompt(tickerObj) {
  const ticker = tickerObj.ticker
  const context = [
    tickerObj.reason ? `Signal thesis: ${tickerObj.reason}` : '',
    tickerObj.setupType ? `Setup type: ${tickerObj.setupType}` : '',
    tickerObj.price ? `Share price: ${tickerObj.price}` : '',
    tickerObj.priceBand ? `Price band: ${tickerObj.priceBand}` : '',
    tickerObj.sourceCount ? `Independent sources: ${tickerObj.sourceCount}` : '',
    tickerObj.signalCount ? `X signal mentions: ${tickerObj.signalCount}` : '',
    tickerObj.articleCount ? `News article mentions: ${tickerObj.articleCount}` : '',
    tickerObj.themes?.length ? `Themes: ${tickerObj.themes.join(', ')}` : '',
  ].filter(Boolean).join('\n')

  const snippetBlock = (tickerObj.snippets || []).slice(0, 3)
    .map((s) => `- "${sanitizeSignalText(s).slice(0, 200)}"`)
    .join('\n')

  return `Generate a comprehensive Deep Research Report on ${ticker}. Cover these sections:

${context ? `Recent signal context:\n${context}\n` : ''}${snippetBlock ? `\nKey signal snippets from X:\n${snippetBlock}\n\nUse these snippets to validate or challenge the thesis — do not take them at face value.\n` : ''}
## 1. Business Model
How exactly do they make money? Core product in plain English. Revenue breakdown if available.

## 2. Moat and Competition
Top 3 competitors. Does ${ticker} have a unique technological advantage or patent that competitors lack?

## 3. Catalyst
Upcoming product launches, regulatory approvals, partnerships, or earnings catalysts in the next 12 months. Be specific with dates if known.

## 4. Asymmetry Check
Low valuation floor vs high growth ceiling? What is the bull case price target vs downside scenario?

---

## 5. Peer Comparison Table
Search Yahoo Finance and Macrotrends. Create a relative valuation table for ${ticker} vs its top 2 competitors. Include: P/S (TTM and forward), EV/EBITDA, gross margin, YoY revenue growth, and a Value/Growth Score (P/S TTM / revenue growth). Lower score = more growth per valuation dollar.

---

## 6. Risk Assessment
Act as a skeptic. Write a 3-point risk assessment for ${ticker} focusing on: accounting irregularities, customer concentration, and competitive threats. Search Seeking Alpha bear articles, recent Reddit discussions (r/stocks, r/investing, r/wallstreetbets), and Twitter/X sentiment to find the strongest real bear arguments being made right now.

---

## 7. Buy Score: X/10
Based on everything above, give ${ticker} an overall Buy Score out of 10. Break it down:
- **Momentum** (social signal strength + price action): X/10
- **Catalyst quality** (specificity + timeline + size of opportunity): X/10
- **Valuation** (cheap vs peers? asymmetric upside?): X/10
- **Risk-adjusted conviction** (upside vs downside, how early is this signal?): X/10
- **Overall Buy Score**: X/10 — one sentence verdict.`
}

export async function generateResearchReports(tickers) {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    console.warn('[researchEngine] OPENAI_API_KEY not set — returning picks without reports')
    return tickers.map((t) => ({ ...t, report: null, citations: [] }))
  }

  const client = new OpenAI({ apiKey })
  const results = []

  for (const tickerObj of tickers) {
    try {
      const response = await client.responses.create({
        model: OPENAI_RESEARCH_MODEL,
        tools: [{ type: 'web_search_preview' }],
        input: buildResearchPrompt(tickerObj),
        max_output_tokens: 4096,
        temperature: 0.2,
      })

      const report = response.output_text || ''
      const citations = (response.output || [])
        .filter((item) => item.type === 'web_search_call')
        .flatMap((item) => item.results || [])
        .map((r) => r.url)
        .filter(Boolean)

      results.push({ ...tickerObj, report, citations })
    } catch (err) {
      console.error(`[researchEngine] report failed for ${tickerObj.ticker}:`, err.message)
      if (err.status === 402 || err.status === 429 || err.message?.includes('insufficient_quota')) {
        console.warn('[researchEngine] OpenAI credits exhausted — returning remaining picks without reports')
        results.push({ ...tickerObj, report: null, citations: [] })
        for (const remaining of tickers.slice(tickers.indexOf(tickerObj) + 1)) {
          results.push({ ...remaining, report: null, citations: [] })
        }
        return results
      }
      results.push({ ...tickerObj, error: err.message, report: null, citations: [] })
    }

    if (tickers.indexOf(tickerObj) < tickers.length - 1) {
      await sleep(1000)
    }
  }

  return results
}
