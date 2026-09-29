// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'

const mocks = vi.hoisted(() => ({ generate: vi.fn() }))
vi.mock('./openaiModel.js', () => ({
  OPENAI_RESEARCH_MODEL: 'test-openai-model',
  usesOpenAIResearch: () => true,
  generateStructuredArray: (...args) => mocks.generate(...args),
}))

import { neutralReviewer } from './evaluation.js'
import { reviewBaseline } from './evaluationBaseline.js'
import { rankHighUpsideBoard } from './frozen/engine.js'

beforeEach(() => vi.clearAllMocks())

describe('OpenAI neutral reviewer batching', () => {
  it('bounds large issue-107 packets and preserves every decision', async () => {
    const candidates = Array.from({ length: 33 }, (_, index) => ({ key: `candidate-${index}` }))
    mocks.generate.mockImplementation(async ({ input }) => JSON.parse(input).map(({ key }) => ({
      key, status: 'rejected', score: 0, reason: 'Insufficient evidence', evidenceIds: [],
    })))

    const decisions = await neutralReviewer(candidates)

    expect(mocks.generate).toHaveBeenCalledTimes(3)
    expect(mocks.generate.mock.calls.map(([request]) => JSON.parse(request.input).length)).toEqual([16, 16, 1])
    expect(decisions.map((decision) => decision.key)).toEqual(candidates.map((candidate) => candidate.key))
  })

  it('asks again for only the candidates a response skipped, repeated or mislabeled', async () => {
    const decision = (key) => ({ key, status: 'rejected', score: 0, reason: 'Insufficient evidence', evidenceIds: [] })
    const batch = Array.from({ length: 16 }, (_, index) => ({ key: `candidate-${index}` }))
    mocks.generate
      // Skips candidate-3, answers candidate-5 twice and invents a key.
      .mockResolvedValueOnce([...batch.filter(({ key }) => key !== 'candidate-3').map(({ key }) => decision(key)), decision('candidate-5'), decision('made-up')])
      .mockImplementationOnce(async ({ input }) => JSON.parse(input).map(({ key }) => decision(key)))

    const decisions = await neutralReviewer(batch)

    expect(JSON.parse(mocks.generate.mock.calls[1][0].input).map(({ key }) => key)).toEqual(['candidate-3', 'candidate-5'])
    expect(decisions.map(({ key }) => key)).toEqual(batch.map(({ key }) => key))
  })

  it('fails the job, naming what is missing, when repeated requests still leave a candidate undecided', async () => {
    mocks.generate.mockResolvedValue([{ key: 'a' }, { key: 'a' }])
    await expect(neutralReviewer([{ key: 'a' }, { key: 'b' }])).rejects.toThrow('Neutral review did not cover every candidate exactly once after 3 requests: a, b')
    expect(mocks.generate).toHaveBeenCalledTimes(3)
  })

  it('uses OpenAI with the original baseline prompt and caller deadline', async () => {
    mocks.generate.mockResolvedValue([])
    const requestOptions = { signal: new AbortController().signal, timeout: 1234 }
    const onReview = vi.fn()
    const board = rankHighUpsideBoard([{ ticker: 'ABC', signalCount: 3, sources: ['a', 'b'], convictionMentions: 2,
      mediaMentions: 2, breakoutSignals: 2, maxScore: 10 }], new Map([['ABC', { price: 100, changePercent: 1 }]]))
    await reviewBaseline([], [], { inputs: { board,
      sectorTrends: new Map(), technicals: new Map() }, requestOptions, onReview })
    const [request] = mocks.generate.mock.calls[0]
    const source = readFileSync(new URL('./frozen/engine.js', import.meta.url), 'utf8')
    const prompt = source.slice(source.indexOf('const TICKER_SYSTEM_PROMPT = `') + 'const TICKER_SYSTEM_PROMPT = `'.length, source.indexOf('`\n\n// Housekeeping'))
    expect(request.instructions).toBe(prompt)
    expect(request.requestOptions).toBe(requestOptions)
    expect(onReview).toHaveBeenCalledWith(expect.objectContaining({ model: 'test-openai-model', parsed: [] }))
  })
})
