// Scan a rendered page in one theme for colours that read as green chrome.
// Run: node scripts/scan-theme-colors.mjs <route> <theme> [port]
// Semantic gain/loss are data, not chrome, so they are reported separately.
import { chromium } from 'playwright'

const route = process.argv[2] || 'research'
const theme = process.argv[3] || 'dark'
const port = process.argv[4] || '5199'

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 950 } })
await page.goto(`http://localhost:${port}/${route}`, { waitUntil: 'domcontentloaded' })
await page.evaluate((t) => localStorage.setItem('wallai-theme', t), theme)
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForTimeout(3000)

const findings = await page.evaluate(() => {
  const GAIN = '52,211,153'   // --color-gain, intentional in both themes
  const parse = (v) => (String(v).match(/-?\d+(\.\d+)?/g) || []).slice(0, 3).map(Number)

  // Green chrome: g clearly dominant over r and b, and not transparent.
  const isGreen = (value) => {
    if (!value || value.includes('gradient')) return false
    if (/rgba?\([^)]*?,\s*0\s*\)$/.test(value)) return false
    const [r, g, b] = parse(value)
    if (![r, g, b].every(Number.isFinite)) return false
    if (r === g && g === b) return false
    return g > r + 8 && g > b + 8
  }

  const out = []
  for (const el of document.querySelectorAll('.research-workspace, .research-workspace *')) {
    const cs = getComputedStyle(el)
    for (const prop of ['color', 'backgroundColor', 'borderTopColor', 'borderBottomColor', 'borderLeftColor', 'outlineColor']) {
      const value = cs[prop]
      if (!isGreen(value)) continue
      const semantic = parse(value).join(',') === GAIN
      out.push({
        prop,
        value,
        semantic,
        el: el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? `.${el.className.trim().split(/\s+/).join('.')}` : ''),
        text: (el.textContent || '').trim().slice(0, 40),
      })
    }
  }
  return out
})

const chrome = findings.filter((f) => !f.semantic)
const semantic = findings.filter((f) => f.semantic)
console.log(`${route} / ${theme}: ${chrome.length} green chrome, ${semantic.length} semantic gain`)
for (const f of chrome.slice(0, 25)) console.log(`  ${f.prop} ${f.value} on ${f.el.slice(0, 70)} "${f.text}"`)

await browser.close()
process.exit(chrome.length > 0 ? 1 : 0)
