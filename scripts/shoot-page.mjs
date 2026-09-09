// Screenshot app pages in both themes, for reviewing a change visually.
// Run: node scripts/shoot-page.mjs <outDir> [port] [route...]   (default: research)
// Preview server must be up: VITE_MOCK_AUTH=true npx vite --port 5199
//
// Scrolls before capturing: Reveal holds children at opacity 0 until
// IntersectionObserver fires and Playwright's fullPage does not scroll, so an
// unscrolled capture renders everything below the fold blank.
import { chromium } from 'playwright'
import { mkdirSync } from 'fs'

const outDir = process.argv[2] || '.'
const port = process.argv[3] || '5199'
const routes = process.argv.slice(4)
const targets = routes.length ? routes : ['research']
mkdirSync(outDir, { recursive: true })

const browser = await chromium.launch()

for (const [route, theme] of targets.flatMap((r) => ['dark', 'light'].map((t) => [r, t]))) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 950 }, deviceScaleFactor: 2 })
  page.on('console', (m) => { if (m.type() === 'error') console.log(`  [console] ${m.text().slice(0, 160)}`) })

  await page.goto(`http://localhost:${port}/${route}`, { waitUntil: 'domcontentloaded' })
  await page.evaluate((t) => localStorage.setItem('wallai-theme', t), theme)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(3000)

  // Reveal holds children at opacity 0 until IntersectionObserver fires, and
  // fullPage does not scroll — everything below the fold would capture blank.
  const height = await page.evaluate(() => document.body.scrollHeight)
  for (let y = 0; y < height; y += Math.round(950 * 0.6)) {
    await page.evaluate((to) => window.scrollTo(0, to), y)
    await page.waitForTimeout(200)
  }
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.waitForTimeout(600)

  const bg = await page.evaluate(() => {
    const el = document.querySelector('.research-workspace') || document.body
    return {
      workspace: getComputedStyle(el).backgroundColor,
      body: getComputedStyle(document.body).backgroundColor,
      accent: getComputedStyle(el).getPropertyValue('--rw-accent').trim(),
      paper: getComputedStyle(el).getPropertyValue('--rw-paper').trim(),
    }
  })
  console.log(`${route} ${theme}:`, JSON.stringify(bg))

  await page.screenshot({ path: `${outDir}/${route.replace(/\W+/g,'-')}-${theme}.png`, fullPage: true })
  await page.close()
}

await browser.close()
console.log('done ->', outDir)
