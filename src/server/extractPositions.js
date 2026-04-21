export function buildPrompt(text) {
  const truncated = text.length > 120_000 ? `${text.slice(0, 120_000)}\n[truncated]` : text

  return `You are a financial data extractor specialising in brokerage statements and portfolio documents.

Extract every stock, ETF, CDR, or equity position from the document text below.
Return a JSON array where each object uses EXACTLY these keys (empty string "" if unavailable):

"ACCOUNT NUMBER"          - account identifier
"ACCOUNT CURRENCY"        - currency code (CAD, USD, etc.)
"SYMBOL"                  - ticker symbol (e.g. AAPL, NVDA)
"DESCRIPTION"             - full security name
"QUANTITY"                - number of shares/units
"AVERAGE UNIT COST"       - average cost per unit (number, no $ sign)
"BOOK VALUE"              - total cost basis (number, no $ sign)
"MARKET PRICE"            - current price per unit (number, no $ sign)
"MARKET VALUE"            - current total value (number, no $ sign)
"DAY CHANGE"              - today's total dollar change (number, include - for negative)
"DAY CHANGE %"            - today's change as percentage string e.g. "2.14%"
"UNREALIZED GAIN/LOSS"    - total unrealized P&L (number, include - for negative)
"UNREALIZED GAIN/LOSS %"  - unrealized P&L as percentage string e.g. "-24.10%"

Rules:
- Return ONLY a valid JSON array, no markdown fences, no explanation, no trailing commas
- All numeric fields are plain number strings without currency symbols (e.g. "150.25" not "$150.25")
- Percentage fields include the % sign (e.g. "2.14%", "-24.10%")
- Skip cash balances, money-market funds, and non-equity entries
- If a position appears on multiple pages (e.g. split across accounts), include it once per account

Document text:
---
${truncated}
---`
}

export async function extractPositionsWithGroq(text, apiKey) {
  if (!apiKey) {
    throw new Error('GROQ_API_KEY is not set. Add it to your environment variables.')
  }

  if (!text || typeof text !== 'string') {
    throw new Error('Missing text field in request')
  }

  const groqRes = await fetch(
    'https://api.groq.com/openai/v1/chat/completions',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [{ role: 'user', content: buildPrompt(text) }],
        temperature: 0,
      }),
    },
  )

  if (!groqRes.ok) {
    const errBody = await groqRes.text()
    throw new Error(`Groq error ${groqRes.status}: ${errBody}`)
  }

  const groqData = await groqRes.json()
  const raw = groqData.choices[0].message.content.trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/, '')

  const rows = JSON.parse(raw)
  if (!Array.isArray(rows)) throw new Error('Model did not return a JSON array')

  return rows
}
