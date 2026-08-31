// ─── Slack Agent ───────────────────────────────────────────────────────────────
// Conversational AI agent that lives in Slack. Handles:
// 1. Nightly pick alerts (push notifications after pipeline runs)
// 2. Conversational queries ("what are today's picks?", "show my portfolio exposure")
// 3. On-demand analysis ("analyze RKLB", "what's my sector breakdown?")
// ────────────────────────────────────────────────────────────────────────────────

import { WebClient } from '@slack/web-api'
import Anthropic from '@anthropic-ai/sdk'

const CLAUDE_MODEL = 'claude-sonnet-5'

const AGENT_SYSTEM_PROMPT = `You are WallAI, a stock research assistant living in Slack. You help the user understand their nightly AI picks, portfolio exposure, and market conditions.

You have access to the following data that was provided to you:
- Current nightly picks (tickers, conviction, reasoning, bear cases, catalyst info)
- Portfolio holdings (if available)
- Signal history (past picks and their performance)

Be concise. Use Slack formatting (*bold*, _italic_, \`code\`). Keep responses under 300 words unless asked for detail.
For ticker mentions, format as *$TICKER*.
For numbers, use appropriate precision ($42.50, not $42.502341).

If asked about something you don't have data for, say so clearly rather than guessing.`

// ─── Push alerts: send nightly picks to Slack channel ──────────────────────────

export async function sendPickAlerts(picks) {
  const token = process.env.SLACK_BOT_TOKEN
  const channel = process.env.SLACK_CHANNEL_ID
  if (!token || !channel) {
    console.warn('[slackAgent] SLACK_BOT_TOKEN or SLACK_CHANNEL_ID not set, skipping alerts')
    return
  }

  const slack = new WebClient(token)

  const pickBlocks = picks.slice(0, 5).map((pick, i) => {
    const conviction = pick.conviction || 0
    const emoji = conviction >= 8 ? '🟢' : conviction >= 6 ? '🟡' : '⚪'
    const catalystTag = pick.catalystVerified ? ' ✅ Catalyst verified' : ''
    const riskTag = pick.riskScore >= 7 ? ` ⚠️ Risk ${pick.riskScore}/10` : ''
    const levels = pick.price && pick.stopLoss && pick.target
      ? `\nEntry ~$${pick.price} · Stop $${pick.stopLoss} · Target $${pick.target}`
      : ''

    return {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `${emoji} *#${i + 1} $${pick.ticker}* — Conviction ${conviction}/10${catalystTag}${riskTag}\n${pick.reason || 'No reasoning available'}${pick.bearCase ? `\n_Bear case: ${pick.bearCase}_` : ''}${levels}`,
      },
    }
  })

  const headerBlock = {
    type: 'header',
    text: { type: 'plain_text', text: '🌙 Nightly Picks' },
  }

  const metaBlock = {
    type: 'context',
    elements: [{
      type: 'mrkdwn',
      text: `Generated at ${new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} • ${picks.length} picks`,
    }],
  }

  await slack.chat.postMessage({
    channel,
    text: `Nightly picks: ${picks.map((p) => p.ticker).join(', ')}`,
    blocks: [headerBlock, { type: 'divider' }, ...pickBlocks, { type: 'divider' }, metaBlock],
  })

  console.log(`[slackAgent] sent pick alert with ${picks.length} picks to channel ${channel}`)
}

// ─── Conversational: answer user questions about picks/portfolio ────────────────

export async function handleSlackMessage(text, context = {}) {
  const anthropicKey = process.env.ANTHROPIC_API_KEY
  if (!anthropicKey) return 'Agent unavailable — API key not configured.'

  const { picks = [], portfolioRows = [], history = [] } = context

  // Build context blocks for Claude
  const contextParts = []

  if (picks.length > 0) {
    const picksText = picks.map((p, i) => {
      const parts = [
        `#${i + 1} ${p.ticker} — Conviction ${p.conviction}/10 (${p.setupType})`,
        p.reason ? `  Thesis: ${p.reason}` : null,
        p.bearCase ? `  Bear case: ${p.bearCase}` : null,
        p.catalystVerified ? `  Catalyst: ${p.catalystDetail} (${p.catalystTimeline})` : null,
        p.price ? `  Price: $${p.price}` : null,
      ].filter(Boolean)
      return parts.join('\n')
    }).join('\n\n')
    contextParts.push(`=== TODAY'S PICKS ===\n${picksText}`)
  }

  if (portfolioRows.length > 0) {
    const holdings = portfolioRows
      .filter((r) => parseFloat(r.QUANTITY || r.quantity || 0) > 0)
      .map((r) => {
        const sym = (r.SYMBOL || r.symbol || '').trim()
        const mv = parseFloat(r['MARKET VALUE'] || r.marketValue || 0)
        return { sym, mv }
      })
      .filter((h) => h.sym && h.mv > 0)
      .sort((a, b) => b.mv - a.mv)
      .slice(0, 20)

    const total = holdings.reduce((s, h) => s + h.mv, 0)
    const holdingsText = holdings.map((h) => `${h.sym}: $${h.mv.toFixed(0)} (${((h.mv / total) * 100).toFixed(1)}%)`).join('\n')
    contextParts.push(`=== PORTFOLIO (top 20, total $${total.toFixed(0)}) ===\n${holdingsText}`)
  }

  if (history.length > 0) {
    const historyText = history.slice(0, 5).map((h) => {
      const date = h.generatedAt?.slice(0, 10) || 'unknown'
      const tickers = (h.picks || []).map((p) => p.ticker).join(', ')
      return `${date}: ${tickers}`
    }).join('\n')
    contextParts.push(`=== RECENT PICK HISTORY ===\n${historyText}`)
  }

  const systemWithContext = contextParts.length > 0
    ? `${AGENT_SYSTEM_PROMPT}\n\n---\nAvailable data:\n${contextParts.join('\n\n')}`
    : AGENT_SYSTEM_PROMPT

  const client = new Anthropic({ apiKey: anthropicKey })
  const response = await client.messages.create({
    model: CLAUDE_MODEL,
    // Sonnet 5 answers the same prompt at noticeably greater length than
    // 4.6 did, and these budgets were sized for 4.6. Verified in production:
    // this call stopped mid-string at exactly its old ceiling and the whole
    // response was discarded as malformed JSON.
    max_tokens: 2000,
    stream: false,
    system: systemWithContext,
    messages: [{ role: 'user', content: text }],
  })

  const textBlock = (response.content || []).find((b) => b.type === 'text')
  return textBlock?.text ?? 'No response generated.'
}
