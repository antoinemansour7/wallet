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
  if (price <= 200) return 'established'
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

export function rankHighUpsideBoard(signalBoard, quotesByTicker = new Map()) {
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
        + (item.squeezeSignals * 1.2)
        + (item.volumeSignals * 1.0)
        + (item.breakoutSignals * 1.1)
        + (item.catalystSignals * 0.9)
        + (item.accountMentions * 0.5)
        + (item.convictionMentions * 0.75)
        + (item.searchMentions * 0.35)
        + (Math.min(item.articleCount, 2) * 0.22)
        + (repeatedAttention ? 1.35 : -1.25)
        + pricePreferenceScore(price)

      if (pennyStockRisk) archetypeScore -= 3.25
      if (!quoteVerified) archetypeScore -= 6
      if (contextHeavy) archetypeScore -= 2.4
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

  if (candidateTickers.length > 0) {
    try {
      const quoteResult = await fetchMarketQuotes(candidateTickers)
      quotesByTicker = buildQuoteMap(quoteResult.quotes)
    } catch (err) {
      console.error('[researchEngine] ticker quote enrichment failed:', err.message)
    }
  }

  return rankHighUpsideBoard(baseBoard, quotesByTicker)
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

const TICKER_SYSTEM_PROMPT = `You are an elite stock signal analyst focused on finding medium-known, high-upside stocks that are in good buying positions — not just what is trending today.

You are receiving signals from the last 72 hours of curated X accounts, adaptive search results, and Yahoo Finance RSS. Multi-day signal persistence (a ticker showing up across several days) is a strong positive — it means sustained attention, not a one-day spike.

Some account sources are context-only. They are useful for information and framing, but they should not create conviction on their own.

Use an approximate 70/30 weighting:
- 70% X signals and repeated trader discovery
- 30% news validation and context

Return ONLY a valid JSON array, no markdown fences, no explanation:
[{"ticker":"RKLB","conviction":9,"reason":"Repeated squeeze and breakout chatter with catalyst"},...]

Strict rules:
- conviction is 1–10 (10 = strongest fit)
- reason is ≤15 words and must name the specific setup or catalyst
- Sort by conviction descending, max 5 tickers
- PRIORITIZE: medium-known stocks with repeated X attention, unusual volume, breakout language, squeeze potential, and specific catalysts
- LOOK FOR buying opportunities: a stock down 3-8% with strong positive signals and a specific catalyst is a potential dip buy — score it higher than a flat stock with weaker signals
- AVOID free-falls: a stock down 15%+ or with collapsing fundamentals is NOT a dip buy, it is a broken chart
- Strongly avoid penny stocks, sub-$5 names, OTC-style low-liquidity setups, or obscure microcaps
- Only allow a sub-$5 name if the setup is exceptional: repeated independent attention, strong catalyst specificity, and aggressive breakout/squeeze behavior
- Do not recommend failed squeeze unwinds, post-crash names, broken charts, or tickers where the attention is mostly about collapse or damage
- Only consider quote-verified, tradable tickers from the board
- PREFER names in the board marked with band=starter or band=core-upside
- PREFER repeated=true and xMentions >= 2 over generic news-only coverage
- AVOID: broad ETFs (SPY, QQQ, IWM, IGV) entirely
- AVOID: mega-cap crowd favorites unless there is a very specific near-term catalyst and strong X setup
- News should confirm or sharpen the X-led thesis, not create the thesis on its own
- Use the ticker board first to identify the best setup archetypes, then use the raw X signals for nuance`

function buildTickerUserMessage(signals, articles, signalBoard) {
  const { boardText, signalText } = summarizeSignalsForPrompt(signals, articles, { signalBoard })
  const articleTexts = articles.slice(0, 25).map((a) => `${a.title} — ${a.description}`).join('\n')

  return `=== HIGH-UPSIDE TICKER BOARD ===
${boardText}

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

  const signalBoard = await getRankedSignalBoard(signals, articles)
  const client = new Anthropic({ apiKey })
  const userContent = buildTickerUserMessage(signals, articles, signalBoard)
  const messages = [{ role: 'user', content: userContent }]

  let parsed
  for (let attempt = 0; attempt < 2; attempt++) {
    const stream = client.messages.stream({
      model: CLAUDE_MODEL,
      max_tokens: 1024,
      system: TICKER_SYSTEM_PROMPT,
      messages,
    })
    const message = await stream.finalMessage()

    const raw = (message.content?.[0]?.text ?? '').trim()
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/, '')

    if (!raw) {
      if (attempt === 0) {
        messages.push({ role: 'assistant', content: '[]' })
        messages.push({ role: 'user', content: 'The response was empty. Return ONLY a valid JSON array of ticker picks.' })
        continue
      }
      throw new Error(`Claude returned empty response (stop_reason: ${message.stop_reason})`)
    }

    try {
      parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) break
      throw new Error('Claude did not return a JSON array')
    } catch (err) {
      if (attempt === 0) {
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
  if (!apiKey) throw new Error('OPENAI_API_KEY is not set')

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
      results.push({ ...tickerObj, error: err.message })
    }

    if (tickers.indexOf(tickerObj) < tickers.length - 1) {
      await sleep(1000)
    }
  }

  return results
}
