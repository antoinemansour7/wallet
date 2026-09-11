// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseCatalystSmokeArgs, runLiveCatalystSmoke } from './catalystSmoke.js'

afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks() })

describe('live catalyst smoke command', () => {
  it('accepts an explicit ticker, event, and optional expected date', () => {
    expect(parseCatalystSmokeArgs(['--ticker', 'abc', '--event', 'Q3 earnings after close', '--date', '2026-10-22'])).toEqual({
      ticker: 'ABC', event: 'Q3 earnings after close', eventDate: '2026-10-22', help: false,
    })
  })

  it.each([
    [[], 'valid ticker'],
    [['--ticker', 'ABC'], 'known upcoming event'],
    [['--ticker', 'ABC', '--event', '--date', '2026-10-22'], 'known upcoming event'],
    [['--ticker', 'ABC', '--event', 'earnings', '--date', 'October 22'], 'real YYYY-MM-DD'],
    [['--ticker', 'ABC', '--event', 'earnings', '--date', '2026-99-99'], 'real YYYY-MM-DD'],
  ])('rejects incomplete input without starting the pipeline', (args, message) => {
    expect(() => parseCatalystSmokeArgs(args)).toThrow(message)
  })

  it('reports missing live credentials without exposing any credential value', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', '')
    vi.stubEnv('EXA_API_KEY', '')
    const lines = []
    const result = await runLiveCatalystSmoke({ ticker: 'ABC', event: 'earnings' , log: (line) => lines.push(line) })
    expect(result.ok).toBe(false)
    expect(result.stages[0]).toEqual({ name: 'Configuration', status: 'FAIL', detail: 'missing ANTHROPIC_API_KEY and EXA_API_KEY' })
    expect(result.stages.slice(1)).toHaveLength(9)
    expect(result.stages.slice(1)).toEqual(expect.arrayContaining([
      { name: 'Discovery', status: 'SKIP', detail: 'blocked by Configuration' },
      { name: 'API payload', status: 'SKIP', detail: 'blocked by Configuration' },
    ]))
    expect(lines[0]).toMatch(/^Configuration\s+FAIL\s+missing ANTHROPIC_API_KEY and EXA_API_KEY$/)
    expect(lines.at(-1)).toMatch(/^API payload\s+SKIP\s+blocked by Configuration$/)
  })
})
