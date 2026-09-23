// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ generate: vi.fn() }))
vi.mock('./openaiModel.js', () => ({
  usesOpenAIResearch: () => true,
  generateStructuredArray: (...args) => mocks.generate(...args),
}))

import { primaryReviewer } from './review.js'

describe('primaryReviewer request options', () => {
  it('forwards the caller\'s abort signal and timeout to the OpenAI call', async () => {
    mocks.generate.mockResolvedValue([])
    const requestOptions = { signal: new AbortController().signal, timeout: 12_345 }

    await primaryReviewer({
      horizon: 20,
      candidates: [{ securityId: 'figi:ABC', ticker: 'ABC', horizon: 20, evidence: [], documents: [], omittedDocuments: 0, measurements: {} }],
      requestOptions,
    })

    expect(mocks.generate).toHaveBeenCalledTimes(1)
    expect(mocks.generate.mock.calls[0][0].requestOptions).toBe(requestOptions)
  })
})
