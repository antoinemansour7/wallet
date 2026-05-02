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

export async function fetchAllYahooNews() {
  const results = await Promise.all(YAHOO_FEEDS.map(fetchFeed))
  const seen = new Set()
  return results.flat().filter((item) => {
    if (!item.title || seen.has(item.title)) return false
    seen.add(item.title)
    return true
  })
}

// ─── Claude Sonnet: extract tickers ───────────────────────────────────────────

import Anthropic from '@anthropic-ai/sdk'
import { fetchMarketQuotes } from './marketQuotes.js'
import { extractTickersFromText } from './xSignals.js'

const CLAUDE_MODEL = 'claude-sonnet-4-6'

const SQUEEZE_REGEX = /(short squeeze|short interest|gamma squeeze|squeez(?:e|ing)|days to cover|float rotation|covering)/i
const VOLUME_REGEX = /(unusual volume|relative volume|rvol|options sweep|dark pool|heavy volume|flow|accumulation)/i
const BREAKOUT_REGEX = /(breakout|reclaim|range expansion|trend continuation|flag breakout|base breakout|higher highs|momentum ignition|squeezing higher)/i
const CATALYST_REGEX = /(earnings|guidance|beat|miss|partnership|contract|launch|approval|fda|pdufa|trial|phase [123]|acquisition|merger|buyout|uplisting|backlog|deal win)/i
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

function baseBoardSortScore(item) {
  return (item.signalCount * 1.4) + (item.sources.length * 1.1) + (item.maxScore * 0.35) + (item.accountMentions * 0.3)
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
      if (signal.sourceType === 'search') item.searchMentions += 1
      if (signal.sourceType === 'screener') item.screenerMentions += 1
      if (SQUEEZE_REGEX.test(signal.text)) item.squeezeSignals += 1
      if (VOLUME_REGEX.test(signal.text)) item.volumeSignals += 1
      if (BREAKOUT_REGEX.test(signal.text)) item.breakoutSignals += 1
      if (CATALYST_REGEX.test(signal.text)) item.catalystSignals += 1
      if (FAILURE_REGEX.test(signal.text)) item.negativeSignals += 1
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

function buildQuoteMap(quotes = []) {
  const map = new Map()
  for (const quote of quotes) {
    for (const symbol of [quote.symbol, quote.requestedSymbol].filter(Boolean)) {
      map.set(normalizeTicker(symbol), quote)
    }
  }
  return map
}

export function rankHighUpsideBoard(signalBoard, quotesByTicker = new Map(), sectorTrends = new Map()) {
  return signalBoard
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
        + (item.screenerMentions * 2.5)
        + (Math.min(item.articleCount, 2) * 0.22)
        + (repeatedAttention ? 2.0 : -1.25)
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
  const candidateTickers = baseBoard.slice(0, 30).map((item) => item.ticker)
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

  const signalText = signals
    .filter((signal) => (signal.tickers || []).some((t) => topBoardTickers.has(t)))
    .slice(0, 80)
    .map((signal) => (
      `[${Number(signal.score || 0).toFixed(2)}] ${signal.sourceType.toUpperCase()} ${signal.sourceLabels?.join(', ') || 'unknown'}`
      + ` | tickers=${signal.tickers?.join(', ') || 'none'}`
      + ` | themes=${signal.themes?.join(', ') || 'none'}`
      + ` | @${signal.username || 'unknown'}: ${sanitizeSignalText(signal.text)}`
    ))
    .join('\n')

  return { signalBoard, boardText, signalText }
}

const TICKER_SYSTEM_PROMPT = `You are an elite stock signal analyst. Your job is to find high-conviction buying opportunities — stocks with asymmetric risk/reward where multiple factors align. You think critically, not reactively.

## Your Decision Framework

Signal volume (mentions, chatter) is a CLUE, not a CONCLUSION. A stock mentioned 10 times by the same person is noise. A stock mentioned independently by 3 different traders with specific catalyst language is signal. You must distinguish between:
- "Attention because it's setting up" → potential buy
- "Attention because it's crashing/controversial" → avoid
- "Attention from repetition/spam" → discount heavily

For each candidate, evaluate these dimensions:
1. CATALYST QUALITY — Is there a specific, time-bound event? (earnings date, FDA ruling, contract announcement, product launch) A vague "bullish vibes" thesis is worth far less than "reports Q2 earnings May 8 with whisper numbers 20% above consensus"
2. TECHNICAL SETUP — Is the chart constructive? (tight consolidation, volume building, near resistance with momentum) Or is it extended, broken, or in freefall?
3. SECTOR CONDITIONS — Check the sector ETF trends provided. A stock in a sector that's declining -3%+ needs an exceptionally strong idiosyncratic catalyst to overcome headwinds. Don't fight the trend without cause.
4. RISK/REWARD — What's the downside if wrong vs upside if right? A stock at $5 support with $8 target is 60% upside / 20% downside. That's asymmetry. A stock already up 40% in 2 weeks with no floor? That's risk.
5. SOURCE INDEPENDENCE — Are multiple independent traders/sources flagging this? Or is it one loud account tweeting 5 times? Check sourceCount and contextMentions vs convictionMentions.

## What Makes a Great Pick
- Multiple independent sources with conviction language (not just context)
- Specific catalyst with a date or timeline
- Technical setup showing consolidation/breakout, not extension
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
[{"ticker":"RKLB","conviction":9,"reason":"Repeated squeeze + NASA contract announcement May 12"},...]

Rules:
- conviction 1–10 (10 = strongest). Be honest — a 7 with clear reasoning beats an inflated 9
- reason ≤15 words, must name the SPECIFIC catalyst or setup (not "bullish signals")
- Max 5 tickers, sorted by conviction descending
- Only quote-verified, tradable tickers from the board
- PREFER band=starter or band=core-upside
- TARGET sector allocation: ~62.5% tech/semiconductor/software, ~37.5% other sectors
- If equal setups, prefer the tech stock
- AVOID: broad ETFs (SPY, QQQ, IWM, IGV)
- Use the ticker board first for setup quality, then X signals for nuance and catalyst specificity`

function buildTickerUserMessage(signals, articles, signalBoard, sectorTrends = new Map()) {
  const { boardText, signalText } = summarizeSignalsForPrompt(signals, articles, { signalBoard })
  const articleTexts = articles.slice(0, 25).map((a) => `${a.title} — ${a.description}`).join('\n')

  let sectorBlock = ''
  if (sectorTrends.size > 0) {
    const lines = [...sectorTrends.entries()]
      .sort((a, b) => a[1] - b[1])
      .map(([etf, chg]) => `  ${etf}: ${chg >= 0 ? '+' : ''}${chg.toFixed(2)}%`)
    sectorBlock = `\n=== SECTOR ETF TRENDS (5-day) ===\n${lines.join('\n')}\nETFs in decline signal broad sector headwinds — picks from those sectors need extra-strong catalysts to justify.\n`
  }

  return `=== HIGH-UPSIDE TICKER BOARD ===
${boardText}
${sectorBlock}
=== X SIGNALS (${signals.length} total, showing top matches) ===
${signalText}

=== NEWS CONTEXT ===
${articleTexts}`
}

function postProcessCandidates(parsed, signalBoard) {
  const boardByTicker = new Map(signalBoard.map((item) => [item.ticker, item]))
  const normalized = parsed
    .filter((t) => t.ticker && typeof t.conviction === 'number')
    .map((tickerObj) => {
      const ticker = normalizeTicker(tickerObj.ticker)
      const summary = boardByTicker.get(ticker)
      return {
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
      }
    })

  const strict = normalized
    .filter((item) => item.quoteVerified)
    .filter((item) => !item.pennyStockRisk || item.exceptionalPennySetup)
    .filter((item) => item.repeatedAttention)
    .filter((item) => !item.brokenSetupRisk)
    .filter((item) => !item.mainstreamCrowdFavorite)
    .filter((item) => item.convictionMentions > 0)
    .sort((a, b) => ((b.conviction * 1.5) + b.archetypeScore) - ((a.conviction * 1.5) + a.archetypeScore))

  if (strict.length > 0) return strict.slice(0, 5)

  const relaxed = normalized
    .filter((item) => item.quoteVerified)
    .filter((item) => !item.pennyStockRisk || item.exceptionalPennySetup)
    .filter((item) => !item.brokenSetupRisk)
    .filter((item) => !item.mainstreamCrowdFavorite)
    .filter((item) => item.convictionMentions > 0 || item.signalCount > item.contextMentions)
    .sort((a, b) => ((b.conviction * 1.5) + b.archetypeScore) - ((a.conviction * 1.5) + a.archetypeScore))
    .slice(0, 5)

  if (relaxed.length > 0) return relaxed

  console.warn('[researchEngine] all filters returned 0 tickers — using minimal fallback')
  return normalized
    .filter((item) => item.quoteVerified)
    .sort((a, b) => ((b.conviction * 1.5) + b.archetypeScore) - ((a.conviction * 1.5) + a.archetypeScore))
    .slice(0, 3)
}

export async function extractTickers(signals, articles) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set')

  const { board: signalBoard, sectorTrends } = await getRankedSignalBoard(signals, articles)
  const client = new Anthropic({ apiKey })
  const userContent = buildTickerUserMessage(signals, articles, signalBoard, sectorTrends)
  const messages = [{ role: 'user', content: userContent }]

  let parsed
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await client.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 2048,
      stream: false,
      system: TICKER_SYSTEM_PROMPT,
      messages,
    })
    const message = typeof response === 'string' ? JSON.parse(response) : response

    // Find the text block (skip thinking blocks)
    const textBlock = (message.content || []).find((b) => b.type === 'text')
    const raw = (textBlock?.text ?? '').trim()
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/, '')

    console.log(`[researchEngine] Claude attempt ${attempt + 1} raw (${raw.length} chars):`, raw.slice(0, 200))
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

  return postProcessCandidates(parsed, signalBoard)
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
