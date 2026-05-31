# API Credits

Status and management of external API dependencies.

---

## Anthropic (Claude)

- **Used for:** Ticker extraction and ranking
- **Model:** `claude-sonnet-4-20250514` (deprecated, should migrate)
- **Cost per run:** ~$0.02-0.05 (one call with signal board context)
- **Key env var:** `ANTHROPIC_API_KEY`
- **Status:** Active

## OpenAI

- **Used for:** Deep research reports with web search
- **Model:** `gpt-4.1-mini` with `web_search_preview` tool
- **Cost per run:** ~$0.15-0.30 (5 picks × web search)
- **Key env var:** `OPENAI_API_KEY`
- **Status:** Credits exhausted as of May 4, 2026
- **Fallback:** Engine stores picks without reports when credits are 0

## X (Twitter) API

- **Used for:** Pulling tweets from curated accounts
- **Tier:** Basic ($200/month for 10k tweets/month read)
- **Key env var:** `X_BEARER_TOKEN`
- **Signals per run:** ~125 tweets across curated accounts
- **Status:** Active (credits refreshed May 2026)

## Upstash Redis

- **Used for:** Caching research results, screener candidates, history
- **Plan:** Free tier (10k commands/day)
- **Key env vars:** `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`
- **Keys used:**
  - `research:latest` (48h TTL)
  - `research:history:<date>` (7d TTL)
  - `research:history-index` (list, capped at 30)
  - `screener:breakout-candidates` (12h TTL)

## Checking Credits

- **Claude:** https://console.anthropic.com/settings/billing
- **OpenAI:** https://platform.openai.com/usage
- **X:** https://developer.x.com/en/portal/dashboard
