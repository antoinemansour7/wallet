// ─── Position Sizing Agent ─────────────────────────────────────────────────────
// Analyzes the user's current portfolio against nightly picks to provide
// allocation suggestions, overlap warnings, and concentration risk alerts.
// ────────────────────────────────────────────────────────────────────────────────

import Anthropic from '@anthropic-ai/sdk'

const CLAUDE_MODEL = 'claude-sonnet-5'

const POSITION_SIZING_SYSTEM_PROMPT = `You are a portfolio allocation specialist. Given a user's current holdings and a set of new stock picks, provide actionable position sizing advice.

Your framework:
1. OVERLAP CHECK — Does the user already hold any of the picks? If so, note the existing exposure.
2. SECTOR CONCENTRATION — Is the user already heavy in the same sector as the picks? Adding more increases correlation risk.
3. POSITION SIZE — For each pick, suggest a % of portfolio allocation based on conviction, risk, and existing exposure. Typical ranges:
   - High conviction (8-10): 3-5% of portfolio
   - Medium conviction (6-7): 1.5-3% of portfolio
   - Exploratory: 0.5-1.5% of portfolio
4. RISK BUDGET — Total new allocation across all picks shouldn't exceed 10-15% of portfolio value unless conviction is exceptional.

Be specific. Use dollar amounts when possible. Reference actual holdings.

Output format — return ONLY a JSON object:
{
  "totalPortfolioValue": 52000,
  "totalSuggestedAllocation": 3200,
  "allocationPct": 6.2,
  "picks": [
    {
      "ticker": "RKLB",
      "suggestedPct": 3.0,
      "suggestedAmount": 1560,
      "reasoning": "No aerospace exposure in current portfolio. High conviction pick with clear catalyst. Full 3% position warranted.",
      "overlap": null,
      "warning": null
    },
    {
      "ticker": "MU",
      "suggestedPct": 1.5,
      "suggestedAmount": 780,
      "reasoning": "Already hold NVDA (8% of portfolio) giving semiconductor exposure. Half-size position to avoid sector concentration.",
      "overlap": "NVDA (semiconductor)",
      "warning": "Semiconductor concentration would reach 9.5%"
    }
  ]
}`

export async function runPositionSizingAgent(picks, portfolioRows) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set')
  if (!picks || picks.length === 0) return { picks: [], error: 'No picks provided' }
  if (!portfolioRows || portfolioRows.length === 0) return { picks: [], error: 'No portfolio data' }

  const client = new Anthropic({ apiKey })

  // Summarize current portfolio
  const holdings = portfolioRows
    .filter((row) => {
      const qty = parseFloat(row.QUANTITY || row.quantity || 0)
      return qty > 0
    })
    .map((row) => {
      const symbol = (row.SYMBOL || row.symbol || '').trim().toUpperCase()
      const quantity = parseFloat(row.QUANTITY || row.quantity || 0)
      const marketValue = parseFloat(row['MARKET VALUE'] || row.marketValue || 0)
      const description = (row.DESCRIPTION || row.description || '').trim()
      return { symbol, quantity, marketValue, description }
    })
    .filter((h) => h.symbol && h.marketValue > 0)
    .sort((a, b) => b.marketValue - a.marketValue)

  const totalValue = holdings.reduce((sum, h) => sum + h.marketValue, 0)

  const portfolioSummary = holdings.map((h) => {
    const pct = ((h.marketValue / totalValue) * 100).toFixed(1)
    return `${h.symbol}: $${h.marketValue.toFixed(0)} (${pct}%) — ${h.description}`
  }).join('\n')

  // Summarize picks
  const picksSummary = picks.map((p) => {
    return [
      `${p.ticker} — Conviction: ${p.conviction}/10, Setup: ${p.setupType}`,
      p.reason ? `  Thesis: ${p.reason}` : null,
      p.price ? `  Price: $${p.price}` : null,
      p.riskScore ? `  Risk score: ${p.riskScore}/10` : null,
      p.themes?.length ? `  Themes: ${p.themes.join(', ')}` : null,
    ].filter(Boolean).join('\n')
  }).join('\n\n')

  const userMessage = `=== CURRENT PORTFOLIO (total: $${totalValue.toFixed(0)}) ===
${portfolioSummary}

=== NEW PICKS TO SIZE ===
${picksSummary}

Provide position sizing recommendations for these picks given my current portfolio.`

  const response = await client.messages.create({
    model: CLAUDE_MODEL,
    // Sonnet 5 answers the same prompt at noticeably greater length than
    // 4.6 did, and these budgets were sized for 4.6. Verified in production:
    // this call stopped mid-string at exactly its old ceiling and the whole
    // response was discarded as malformed JSON.
    max_tokens: 4000,
    stream: false,
    system: POSITION_SIZING_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }],
  })

  const textBlock = (response.content || []).find((b) => b.type === 'text')
  const raw = (textBlock?.text ?? '').trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/, '')

  try {
    const parsed = JSON.parse(raw)
    return parsed
  } catch (err) {
    console.error('[positionSizingAgent] failed to parse response:', err.message)
    return { picks: [], error: 'Failed to generate sizing recommendations' }
  }
}
