// @vitest-environment node
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ generate: vi.fn(), anthropic: vi.fn(), exa: vi.fn() }))
vi.mock('../openaiModel.js', () => ({ usesOpenAIResearch: () => true, generateStructuredArray: (...args) => mocks.generate(...args) }))
vi.mock('@anthropic-ai/sdk', () => ({ default: class { constructor() { this.messages = { create: mocks.anthropic } } } }))
vi.mock('exa-js', () => ({ default: class { searchAndContents(...args) { return mocks.exa(...args) } } }))

import { extractTickers, rankHighUpsideBoard } from './engine.js'
import { runContrarianAgent } from './contrarianAgent.js'
import { runCatalystAgent } from './catalystAgent.js'
import { ARMS } from '../evaluationPolicy.js'

const board = rankHighUpsideBoard([{ ticker: 'ABC', signalCount: 3, sources: ['a', 'b'], convictionMentions: 2, mediaMentions: 2, breakoutSignals: 2, maxScore: 10 }],
  new Map([['ABC', { price: 100, changePercent: 1 }]]))

beforeEach(() => {
  vi.stubEnv('OPENAI_API_KEY', 'openai-key'); vi.stubEnv('ANTHROPIC_API_KEY', 'anthropic-key-without-credit')
  mocks.generate.mockReset(); mocks.anthropic.mockReset(); mocks.exa.mockReset()
})
afterEach(() => { vi.unstubAllEnvs() })

describe('frozen engine on the live provider (frozen-existing-v2)', () => {
  it('ranks with the unchanged frozen prompt through OpenAI, never Anthropic', async () => {
    mocks.generate.mockResolvedValue([{ ticker: 'ABC', conviction: 8, reason: 'Three independent sources and a confirmed breakout.' }])
    let review
    const picks = await extractTickers([], [], { inputs: { board, sectorTrends: new Map(), technicals: new Map() }, onReview: (value) => { review = value } })
    expect(picks.map((pick) => pick.ticker)).toEqual(['ABC'])
    expect(mocks.anthropic).not.toHaveBeenCalled()
    const [request] = mocks.generate.mock.calls[0]
    expect(request.instructions).toMatch(/NEXT 3 TO 5 TRADING DAYS/)
    expect(request.itemSchema.required).toEqual(['ticker', 'conviction', 'reason'])
    expect(review.parsed).toEqual([{ ticker: 'ABC', conviction: 8, reason: 'Three independent sources and a confirmed breakout.' }])
  })

  it('runs the frozen contrarian and catalyst checks through OpenAI and merges their results as before', async () => {
    vi.stubEnv('EXA_API_KEY', 'exa-key')
    mocks.exa.mockResolvedValue({ results: [{ title: 'ABC wins contract', url: 'https://example.com/abc', text: 'Award on 2026-09-25.', publishedDate: '2026-09-22' }] })
    mocks.generate
      .mockResolvedValueOnce([{ ticker: 'ABC', bearCase: 'Already up 30% this month.', riskScore: 6 }])
      .mockResolvedValueOnce([{ ticker: 'ABC', catalystVerified: true, catalyst: 'Contract award', timeline: 'this week', eventDate: '2026-09-25',
        pricedIn: false, confidence: 7, sources: ['https://example.com/abc', 'https://invented.example.com'] }])
    const [reviewed] = await runContrarianAgent([{ ticker: 'ABC', reason: 'Bull thesis', conviction: 8 }])
    expect(reviewed).toMatchObject({ bearCase: 'Already up 30% this month.', riskScore: 6 })
    const [verified] = await runCatalystAgent([reviewed])
    expect(verified).toMatchObject({ catalystVerified: true, catalystDate: '2026-09-25', catalystSources: ['https://example.com/abc'], catalystConfidence: 7 })
    expect(mocks.generate.mock.calls.map(([request]) => request.name)).toEqual(['contrarian_reviews', 'catalyst_verifications'])
    expect(mocks.anthropic).not.toHaveBeenCalled()
  })

  it('records the frozen snapshot under the same version the evaluation arm reports', () => {
    const manifest = JSON.parse(readFileSync(new URL('./manifest.json', import.meta.url), 'utf8'))
    expect(manifest.version).toBe(ARMS.find((arm) => arm.id === 'frozen-existing').version)
    expect(manifest.previous.version).toBe('frozen-existing-v1')
  })
})
