#!/usr/bin/env node
import { parseCatalystSmokeArgs, runLiveCatalystSmoke } from '../src/server/research/catalystSmoke.js'

const usage = `Usage:
  npm run research:e2e:live -- --ticker ABC --event "earnings on October 22 after close" [--date 2026-10-22]

This opt-in diagnostic uses the configured market-data, Anthropic, and Exa services.
It writes only to an in-memory projection and never replaces published research.`

let options
try {
  options = parseCatalystSmokeArgs(process.argv.slice(2))
} catch (error) {
  console.error(error.message)
  console.error(usage)
  process.exitCode = 2
}

if (options?.help) console.log(usage)
else if (options) {
  console.log(`Research catalyst smoke: ${options.ticker}`)
  const result = await runLiveCatalystSmoke(options)
  if (!result.ok) process.exitCode = 1
}
