// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ create: vi.fn() }))

vi.mock('openai', () => ({
  default: class OpenAI {
    constructor() { this.responses = { create: mocks.create } }
  },
}))

import { generateStructuredArray, generateWebReport, usesOpenAIResearch } from './openaiModel.js'

describe('OpenAI research model', () => {
  const originalKey = process.env.OPENAI_API_KEY

  beforeEach(() => {
    process.env.OPENAI_API_KEY = 'test-key'
    mocks.create.mockReset()
  })

  afterEach(() => {
    if (originalKey === undefined) delete process.env.OPENAI_API_KEY
    else process.env.OPENAI_API_KEY = originalKey
  })

  it('defaults production to OpenAI while tests retain the legacy mocked path', () => {
    expect(usesOpenAIResearch({ NODE_ENV: 'production' })).toBe(true)
    expect(usesOpenAIResearch({ NODE_ENV: 'test' })).toBe(false)
    expect(usesOpenAIResearch({ NODE_ENV: 'test', RESEARCH_MODEL_PROVIDER: 'openai' })).toBe(true)
  })

  it('uses strict Responses API structured output and returns its items', async () => {
    mocks.create.mockResolvedValue({
      status: 'completed',
      model: 'gpt-5.4-mini-2026-03-17',
      output_text: '{"items":[{"ticker":"ABC"}]}',
      usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 },
    })
    const items = await generateStructuredArray({
      name: 'test_ranking',
      instructions: 'Rank candidates.',
      input: 'ABC',
      itemSchema: {
        type: 'object',
        properties: { ticker: { type: 'string' } },
        required: ['ticker'],
        additionalProperties: false,
      },
    })

    expect(items).toEqual([{ ticker: 'ABC' }])
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({
      store: false,
      text: { verbosity: 'low', format: expect.objectContaining({ type: 'json_schema', strict: true }) },
    }), undefined)
  })

  it('retries max-output exhaustion once without reasoning', async () => {
    mocks.create
      .mockResolvedValueOnce({
        status: 'incomplete',
        model: 'gpt-5.4-mini-2026-03-17',
        incomplete_details: { reason: 'max_output_tokens' },
        usage: { input_tokens: 100, output_tokens: 4000, total_tokens: 4100 },
      })
      .mockResolvedValueOnce({
        status: 'completed',
        model: 'gpt-5.4-mini-2026-03-17',
        output_text: '{"items":[{"ticker":"ABC"}]}',
        usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 },
      })

    await expect(generateStructuredArray({
      name: 'test_ranking', instructions: 'Rank.', input: 'ABC', itemSchema: { type: 'string' },
    })).resolves.toEqual([{ ticker: 'ABC' }])
    expect(mocks.create).toHaveBeenCalledTimes(2)
    expect(mocks.create.mock.calls[0][0].reasoning).toEqual({ effort: 'medium' })
    expect(mocks.create.mock.calls[1][0].reasoning).toEqual({ effort: 'none' })
  })

  it('fails closed when the no-reasoning fallback is also incomplete', async () => {
    mocks.create.mockResolvedValue({ status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } })
    await expect(generateStructuredArray({
      name: 'test_ranking', instructions: 'Rank.', input: 'ABC', itemSchema: { type: 'string' },
    })).rejects.toThrow('OpenAI response incomplete after no-reasoning retry: max_output_tokens')
    expect(mocks.create).toHaveBeenCalledTimes(2)
  })

  it('does not retry unrelated incomplete responses', async () => {
    mocks.create.mockResolvedValue({ status: 'incomplete', incomplete_details: { reason: 'content_filter' } })
    await expect(generateStructuredArray({
      name: 'test_ranking', instructions: 'Rank.', input: 'ABC', itemSchema: { type: 'string' },
    })).rejects.toThrow('content_filter')
    expect(mocks.create).toHaveBeenCalledTimes(1)
  })

  it('uses Responses web search and collects cited URLs', async () => {
    mocks.create.mockResolvedValue({
      status: 'completed',
      model: 'gpt-5.4-mini-2026-03-17',
      output_text: 'Grounded report',
      output: [{ content: [{ annotations: [{ type: 'url_citation', url: 'https://example.com/filing' }] }] }],
      usage: { input_tokens: 200, output_tokens: 80, total_tokens: 280 },
    })
    await expect(generateWebReport({ input: 'Research ABC' })).resolves.toEqual({
      report: 'Grounded report', citations: ['https://example.com/filing'],
    })
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({
      tools: [{ type: 'web_search' }],
      store: false,
    }), undefined)
  })
})
