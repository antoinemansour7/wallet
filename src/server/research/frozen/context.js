import { currentSecurityMaster } from '../securityMaster.js'
export function formatRegimeForPrompt(regime) {
  if (!regime) return ''
  const lines = regime.components.map(
    (c) => `  ${c.label}: ${c.score}/10 — ${c.technical ?? c.detail}`,
  )
  return [
    '',
    `=== MARKET REGIME (${regime.score}/10 — ${regime.label}) ===`,
    ...lines,
    `Biggest drag: ${regime.drag?.label} (${regime.drag?.technical ?? regime.drag?.detail}).`,
    'This rates the tape, not any individual pick. Do NOT lower a pick\'s conviction because',
    'the regime is poor — conviction rates the idea on its own merits and position size is',
    'where the tape is expressed. Use this to judge whether a setup has to fight its',
    'environment, and say so in the reason when it does.',
    '',
  ].join('\n')
}

export function extractTickersFromText(text, master = currentSecurityMaster()) {
  return master ? master.text(text).map((security) => security.ticker) : []
}

