// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ generate: vi.fn() }))
vi.mock('./openaiModel.js', () => ({
  usesOpenAIResearch: () => true,
  generateStructuredArray: (...args) => mocks.generate(...args),
}))

import { neutralReviewer } from './evaluation.js'

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
})
