import Anthropic from '@anthropic-ai/sdk'
import { getUserHoldings, getSectorExposure, getConcentrationRisk } from '../src/server/agents/portfolioTools.js'

const CLAUDE_MODEL = 'claude-sonnet-4-6'

const ANALYZER_SYSTEM_PROMPT = `You are a portfolio analyst. Given a user's holdings with sector exposure and concentration metrics, provide an actionable analysis.

Cover these areas:
1. Portfolio Health — Is it well-diversified or dangerously concentrated? Grade it A-F.
2. Sector Exposure — Which sectors are over/under-weight relative to a balanced growth portfolio?
3. Risk Flags — Any single positions too large? Correlated holdings that would all drop together?
4. Opportunities — What sectors or themes are missing that could improve risk-adjusted returns?
5. Action Items — 2-3 specific, actionable suggestions (trim X, add exposure to Y, rebalance Z).

Be direct and specific. Use the actual numbers provided. Keep it under 400 words.
Format with markdown headers (##), bold for emphasis, and bullet points.
Do NOT use emojis. Do NOT use colored circles or symbols like 🔴🟡🟢⚠️📊🚨💡✅. Keep it text-only and professional.`

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { portfolioRows } = req.body || {}
  if (!portfolioRows || !Array.isArray(portfolioRows) || portfolioRows.length === 0) {
    return res.status(400).json({ error: 'portfolioRows array is required' })
  }
  if (portfolioRows.length > 200) {
    return res.status(400).json({ error: 'Maximum 200 rows allowed' })
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return res.status(503).json({ error: 'API key not configured' })
  }

  // Compute portfolio metrics
  const { holdings, totalValue } = getUserHoldings(portfolioRows)
  const { sectors } = getSectorExposure(portfolioRows)
  const risk = getConcentrationRisk(portfolioRows)

  if (holdings.length === 0) {
    return res.status(400).json({ error: 'No valid holdings found' })
  }

  // Build context for Claude
  const holdingsText = holdings.slice(0, 30).map((h) =>
    `${h.symbol}: $${h.marketValue.toFixed(0)} (${h.weight}%) — ${h.sector} — P&L: ${h.gainLossPct >= 0 ? '+' : ''}${h.gainLossPct.toFixed(1)}%`
  ).join('\n')

  const sectorText = sectors.map((s) =>
    `${s.sector}: ${s.weight}% ($${s.totalValue.toFixed(0)}) — ${s.count} positions`
  ).join('\n')

  const riskText = [
    `Total value: $${totalValue.toFixed(0)}`,
    `Positions: ${risk.positionCount}`,
    `Top 5 weight: ${risk.top5Weight}%`,
    risk.largestPosition ? `Largest: ${risk.largestPosition.symbol} at ${risk.largestPosition.weight}%` : null,
    risk.largestSector ? `Largest sector: ${risk.largestSector.sector} at ${risk.largestSector.weight}%` : null,
    risk.risks.length > 0 ? `Risk flags: ${risk.risks.join('; ')}` : 'No concentration flags',
  ].filter(Boolean).join('\n')

  const userMessage = `Analyze this portfolio:\n\n=== HOLDINGS (top 30) ===\n${holdingsText}\n\n=== SECTOR BREAKDOWN ===\n${sectorText}\n\n=== RISK METRICS ===\n${riskText}`

  try {
    const client = new Anthropic({ apiKey })
    const response = await client.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 1200,
      stream: false,
      system: ANALYZER_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
    })

    const textBlock = (response.content || []).find((b) => b.type === 'text')
    const analysis = textBlock?.text ?? 'Analysis unavailable.'

    return res.status(200).json({
      analysis,
      metrics: {
        totalValue,
        positionCount: risk.positionCount,
        top5Weight: risk.top5Weight,
        sectors,
        risks: risk.risks,
        diversified: risk.diversified,
      },
    })
  } catch (err) {
    console.error('[analyze-portfolio] Claude failed:', err.message)
    return res.status(500).json({ error: 'Analysis failed' })
  }
}
