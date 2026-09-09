// ─── Contrarian Agent ──────────────────────────────────────────────────────────
// After Claude picks tickers, this agent stress-tests each pick by finding
// reasons it could fail. Produces a bear case for each pick.
// Uses Exa search to ground bear cases in real news/data.
// ────────────────────────────────────────────────────────────────────────────────

import Anthropic from '@anthropic-ai/sdk'
import Exa from 'exa-js'
import { safeTruncate } from '../textSafety.js'

const CLAUDE_MODEL = 'claude-sonnet-5'

const CONTRARIAN_SYSTEM_PROMPT = `You are an elite short-seller and risk analyst. Your job is to DESTROY bullish theses. For every stock presented to you, find the strongest possible bear case.

You think like a skeptic:
- What's the crowded trade risk? If everyone on X is bullish, who's left to buy?
- What's the valuation reality? Is the stock priced for perfection?
- What's the catalyst risk? Could the expected event disappoint or be priced in?
- What's the technical risk? Is RSI overbought? Is it extended from all moving averages?
- What's the macro/sector headwind? Rising rates, sector rotation, competition?
- What's the downside scenario? If the thesis is wrong, where does it fall to?

Be specific. Use numbers. Reference the technicals provided. Don't be vague — if RSI is 83, say "RSI at 83 suggests exhaustion." If it's up 40% in a month, say "40% run = profit-taking risk."

Output format — return ONLY a JSON array:
[{"ticker":"RKLB","bearCase":"RSI at 78 signals overbought conditions after a 35% monthly run. The $150M NASA contract is public knowledge already priced in — similar contract wins in 2024 saw sell-the-news reactions. If Q2 guidance disappoints, support at $38 is 12% below current price with no clear floor beneath it.","riskScore":7}]

Rules:
- riskScore 1-10 (10 = extremely dangerous entry, 1 = minimal risk)
- bearCase: 2-3 sentences, specific and data-driven
- WRITE IT FOR A NON-PROFESSIONAL. Keep the numbers, drop the desk vocabulary. Say "the stock has already run 35% this month, so early buyers have a large profit to protect and may sell into any good news" rather than "35% monthly run = profit-taking risk into a sell-the-news setup".
- BANNED WORDS, unless the same sentence says what the word means: sell-the-news, priced in, crowded, crowded trade, extended, exhaustion, overbought, oversold, support, resistance, asymmetric, rotation, rotate, squeeze, breakout, setup, tape, beta, valuation multiple, de-rate.
  This applies to every use, including inside a phrase like "a crowded spot" or "if that rotation reverses" — describe what would actually happen instead: "if that money moves back into tech tomorrow".
- Plain sentences an intelligent non-trader could follow on one read.
- Cover ALL tickers provided
- Be honest — if a pick genuinely has low risk, give it a low riskScore. Don't force bearishness.`

export async function runContrarianAgent(picks, technicals = new Map()) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set')
  if (!picks || picks.length === 0) return []

  const client = new Anthropic({ apiKey })

  // ─── Exa: search for bearish/negative news on each ticker ─────────────────
  let bearishContext = ''
  const exaKey = process.env.EXA_API_KEY
  if (exaKey) {
    const exa = new Exa(exaKey)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    const searches = await Promise.all(picks.map(async (pick) => {
      try {
        const result = await exa.searchAndContents(
          `${pick.ticker} stock risk downgrade bearish sell overvalued competition headwind warning`,
          {
            type: 'auto',
            numResults: 3,
            text: { maxCharacters: 300 },
            startPublishedDate: thirtyDaysAgo,
            category: 'news',
          }
        )
        const articles = (result.results || [])
          .map((r) => `[${r.publishedDate?.slice(0, 10) || 'recent'}] ${r.title}: ${safeTruncate(r.text || '', 200)}`)
          .join('\n')
        return articles ? `${pick.ticker}:\n${articles}` : null
      } catch (err) {
        console.error(`[contrarianAgent] Exa search failed for ${pick.ticker}:`, err.message)
        return null
      }
    }))
    const validSearches = searches.filter(Boolean)
    if (validSearches.length > 0) {
      bearishContext = `\n\n--- RECENT NEGATIVE NEWS / RISK FACTORS (from web search) ---\n${validSearches.join('\n\n')}`
    }
    console.log(`[contrarianAgent] Exa grounding: ${validSearches.length}/${picks.length} tickers had bearish news`)
  }

  // Build the user message with pick details + technicals. Picks carry their
  // own technicals from postProcessCandidates — use them when no map is passed.
  const pickDetails = picks.map((p) => {
    const tech = technicals.get(p.ticker)
      ?? (p.technicals ? { analyzed: true, ...p.technicals } : null)
    const parts = [
      `TICKER: ${p.ticker}`,
      `Bull thesis: ${p.reason}`,
      `Conviction: ${p.conviction}/10`,
      `Setup: ${p.setupType}`,
      p.price ? `Price: $${p.price}` : null,
      p.quoteChangePercent != null ? `Today: ${p.quoteChangePercent > 0 ? '+' : ''}${p.quoteChangePercent.toFixed(1)}%` : null,
      tech?.analyzed ? [
        `RSI: ${tech.rsi}`,
        `Trend: ${tech.trend}`,
        tech.sma20 ? `SMA20: ${tech.sma20}` : null,
        tech.sma50 ? `SMA50: ${tech.sma50}` : null,
        tech.macd ? `MACD hist: ${tech.macd.histogram}` : null,
        tech.pctFrom52wHigh != null ? `From 52w high: ${tech.pctFrom52wHigh}%` : null,
        tech.relativeVolume != null ? `Rel volume: ${tech.relativeVolume}x` : null,
      ].filter(Boolean).join(', ') : null,
      p.sourceCount ? `Sources: ${p.sourceCount}` : null,
      p.repeatedAttention ? 'Repeated attention: YES' : null,
    ].filter(Boolean)
    return parts.join('\n')
  }).join('\n\n---\n\n')

  const userMessage = `Stress-test these bullish picks. Find the strongest bear case for each:\n\n${pickDetails}${bearishContext}`

  const response = await client.messages.create({
    model: CLAUDE_MODEL,
    // Sonnet 5 answers the same prompt at noticeably greater length than
    // 4.6 did, and these budgets were sized for 4.6. Verified in production:
    // this call stopped mid-string at exactly its old ceiling and the whole
    // response was discarded as malformed JSON.
    max_tokens: 4000,
    stream: false,
    system: CONTRARIAN_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }],
  })

  const textBlock = (response.content || []).find((b) => b.type === 'text')
  const raw = (textBlock?.text ?? '').trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/, '')

  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []

    // Merge bear cases back into picks
    const bearMap = new Map(parsed.map((b) => [b.ticker?.toUpperCase(), b]))
    return picks.map((pick) => {
      const bear = bearMap.get(pick.ticker)
      return {
        ...pick,
        bearCase: bear?.bearCase || null,
        riskScore: bear?.riskScore || null,
      }
    })
  } catch (err) {
    console.error('[contrarianAgent] failed to parse response:', err.message)
    return picks // Return picks unchanged if agent fails
  }
}
