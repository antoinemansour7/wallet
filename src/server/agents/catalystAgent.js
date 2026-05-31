// ─── Catalyst Verification Agent ──────────────────────────────────────────────
// Uses Exa AI search to verify that catalysts mentioned in X signals are real,
// upcoming, and not already priced in. Enriches picks with verified catalyst data.
// ────────────────────────────────────────────────────────────────────────────────

import Exa from 'exa-js'
import Anthropic from '@anthropic-ai/sdk'

const CLAUDE_MODEL = 'claude-sonnet-4-6'

const CATALYST_VERIFICATION_PROMPT = `You are a catalyst verification specialist. Given search results about a stock ticker, determine:
1. Is there a REAL, SPECIFIC upcoming catalyst? (earnings date, FDA date, contract, product launch)
2. Is it ALREADY priced in? (announced weeks ago, stock already rallied on the news)
3. What's the exact timeline?

Output format — return ONLY a JSON array:
[{
  "ticker": "RKLB",
  "catalystVerified": true,
  "catalyst": "Q2 earnings report on June 12, with whisper EPS of $0.08 vs consensus $0.04",
  "timeline": "28 days",
  "pricedIn": false,
  "confidence": 8,
  "sources": ["Seeking Alpha", "Yahoo Finance"]
}]

Rules:
- catalystVerified: true only if you found a SPECIFIC event with a date/timeline
- pricedIn: true if the news is >7 days old AND the stock already moved significantly on it
- confidence: 1-10 in the catalyst's potential to move the stock
- If no catalyst found, set catalystVerified=false, catalyst="No specific upcoming catalyst identified"
- Cover ALL tickers provided`

export async function runCatalystAgent(picks) {
  const exaKey = process.env.EXA_API_KEY
  const anthropicKey = process.env.ANTHROPIC_API_KEY
  if (!exaKey) { console.warn('[catalystAgent] EXA_API_KEY not set, skipping'); return picks }
  if (!anthropicKey) throw new Error('ANTHROPIC_API_KEY is not set')
  if (!picks || picks.length === 0) return []

  const exa = new Exa(exaKey)

  // Search Exa for each ticker's catalyst info
  console.log(`[catalystAgent] searching Exa for ${picks.length} tickers: ${picks.map((p) => p.ticker).join(', ')}`)
  const searchResults = await Promise.all(picks.map(async (pick) => {
    try {
      const result = await exa.searchAndContents(
        `${pick.ticker} stock upcoming catalyst earnings FDA approval contract 2026`,
        {
          type: 'auto',
          numResults: 5,
          text: { maxCharacters: 500 },
          startPublishedDate: getDateNDaysAgo(30),
          category: 'news',
        }
      )
      console.log(`[catalystAgent] Exa ${pick.ticker}: ${result.results?.length || 0} results`)
      return {
        ticker: pick.ticker,
        results: (result.results || []).map((r) => ({
          title: r.title,
          url: r.url,
          text: (r.text || '').slice(0, 400),
          publishedDate: r.publishedDate,
        })),
      }
    } catch (err) {
      console.error(`[catalystAgent] Exa search failed for ${pick.ticker}:`, err.message)
      return { ticker: pick.ticker, results: [] }
    }
  }))

  // Build context for Claude
  const searchContext = searchResults.map((sr) => {
    const articles = sr.results.length > 0
      ? sr.results.map((r) => `  - [${r.publishedDate?.slice(0, 10) || 'recent'}] ${r.title}\n    ${r.text}`).join('\n')
      : '  No recent articles found.'
    return `=== ${sr.ticker} ===\nBull thesis: ${picks.find((p) => p.ticker === sr.ticker)?.reason || 'N/A'}\nSearch results:\n${articles}`
  }).join('\n\n')

  // Ask Claude to verify catalysts
  const client = new Anthropic({ apiKey: anthropicKey })
  const response = await client.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 1200,
    stream: false,
    system: CATALYST_VERIFICATION_PROMPT,
    messages: [{ role: 'user', content: `Verify the catalysts for these picks:\n\n${searchContext}` }],
  })

  const textBlock = (response.content || []).find((b) => b.type === 'text')
  const raw = (textBlock?.text ?? '').trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/, '')

  console.log(`[catalystAgent] Claude raw response (${raw.length} chars):`, raw.slice(0, 300))

  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) {
      console.error('[catalystAgent] parsed response is not an array:', typeof parsed)
      return picks
    }

    console.log(`[catalystAgent] parsed ${parsed.length} catalyst entries:`, parsed.map((c) => c.ticker))
    const catalystMap = new Map(parsed.map((c) => [c.ticker?.toUpperCase(), c]))
    return picks.map((pick) => {
      const catalyst = catalystMap.get(pick.ticker)
      if (!catalyst) return pick
      return {
        ...pick,
        catalystVerified: catalyst.catalystVerified ?? false,
        catalystDetail: catalyst.catalyst || null,
        catalystTimeline: catalyst.timeline || null,
        catalystPricedIn: catalyst.pricedIn ?? false,
        catalystConfidence: catalyst.confidence ?? null,
      }
    })
  } catch (err) {
    console.error('[catalystAgent] failed to parse Claude response:', err.message, '| raw:', raw.slice(0, 200))
    return picks
  }
}

function getDateNDaysAgo(n) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().slice(0, 10)
}
