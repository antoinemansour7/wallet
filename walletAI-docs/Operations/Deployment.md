# Deployment

How the app gets to production.

---

## Stack

- **Frontend:** React 18 + Vite + Tailwind CSS 3
- **Backend:** Vercel Serverless Functions (Node.js)
- **Database:** Upstash Redis (REST API)
- **Hosting:** Vercel (production)
- **Repo:** github.com/antoinemansour7/wallet (SSH key on different account — use HTTPS for push)

## Deploy Commands

```bash
# Deploy to production
npx vercel --prod

# Preview deployment
npx vercel
```

## Environment Variables (Vercel)

All secrets are set in Vercel dashboard. For local runs, use `.env` file:

```
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
X_BEARER_TOKEN=AAAA...
UPSTASH_REDIS_REST_URL=https://...upstash.io
UPSTASH_REDIS_REST_TOKEN=gQAAA...
CRON_SECRET=8f7b3a...
```

## Deployment Protection

Vercel has SSO-based deployment protection enabled. To call API routes externally:
- Use `vercel curl /api/endpoint` (handles bypass automatically)
- Or pass the CRON_SECRET as `Authorization: Bearer <secret>` header

## Routes

| Route | Description |
|-------|-------------|
| `/` | Portfolio page |
| `/research` | AI picks + reports |
| `/history` | Past picks performance |
| `/api/nightly-research` | Cron endpoint (POST, needs auth) |
| `/api/get-research-history` | Returns history entries |
| `/api/live-prices` | POST with tickers, returns quotes |

## Known Issues

- Git push fails with SSH (wrong GitHub account signed in) — use HTTPS or switch accounts
- Pre-existing test failures (Login.test.jsx, ProtectedRoute.test.jsx) — React production build issue, unrelated to features
