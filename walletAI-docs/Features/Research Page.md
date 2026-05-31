# Research Page

The main stock picks display.

---

## What Users See

1. **Market Snapshot** — 6 mini-cards showing key market data
2. **Pick Cards** — only tickers with conviction >= 6
   - Avatar badge with ticker initial
   - Ticker name + score pill (color-coded: green >=8, amber >=6)
   - Reason line (from Claude)
   - Conviction bar (full-width progress)
3. **Research Report** — if OpenAI credits available, full markdown report with:
   - Business model, moat, catalyst, asymmetry check, peer comparison
   - Citations as domain-name pills
   - Highlights section
4. **News Grid** — 2-column card layout, max 12 articles

## Key Design Decisions

- **Conviction >= 6 filter**: lower conviction picks are noise to the user
- **No report fallback**: shows "No report available" gracefully when OpenAI is down
- **Dark theme**: charcoal surfaces, teal accents, gain/loss colors
- **Signal count badge**: shows total signals analyzed that day

## Components

- `RenderMarkdown` — parses headings, bullets, tables, bold, links
- `MarkdownTable` — proper styled HTML table rendering
- `InlineMarkdown` — processes **bold** and [links](url) inline
