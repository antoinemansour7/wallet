// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// The OpenAI evaluation reuses the frozen baseline's prompts. frozen/ is
// checksum-locked and exports none of them, so they are copied; these checks
// fail if a copy ever drifts from the archived original.
const source = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')
const constant = (text, name) => {
  const start = text.indexOf(`const ${name} = \``)
  if (start < 0) throw new Error(`${name} not found`)
  const body = start + `const ${name} = \``.length
  return text.slice(body, text.indexOf('`', body))
}
const functionSource = (text, name) => {
  const start = text.indexOf(`function ${name}(`)
  if (start < 0) throw new Error(`${name} not found`)
  return text.slice(start, text.indexOf('\n}\n', start))
}

describe('OpenAI evaluation keeps the frozen baseline prompts', () => {
  it('uses the frozen ticker-selection prompt and input formatting verbatim', () => {
    const frozen = source('./frozen/engine.js'), copy = source('./evaluationBaseline.js')
    expect(constant(copy, 'TICKER_SYSTEM_PROMPT')).toBe(constant(frozen, 'TICKER_SYSTEM_PROMPT'))
    expect(functionSource(copy, 'buildTickerUserMessage')).toBe(functionSource(frozen, 'buildTickerUserMessage'))
  })

  it('reviews risk and catalysts with the frozen prompts', () => {
    expect(constant(source('../agents/contrarianAgent.js'), 'CONTRARIAN_SYSTEM_PROMPT'))
      .toBe(constant(source('./frozen/contrarianAgent.js'), 'CONTRARIAN_SYSTEM_PROMPT'))
    expect(constant(source('../agents/catalystAgent.js'), 'CATALYST_VERIFICATION_PROMPT'))
      .toBe(constant(source('./frozen/catalystAgent.js'), 'CATALYST_VERIFICATION_PROMPT'))
  })
})
