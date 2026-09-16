import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

let mockCreate
let mockSearch

vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: class MockAnthropic {
      constructor() {
        this.messages = { create: (...args) => mockCreate(...args) }
      }
    },
  }
})

vi.mock('openai', () => ({
  default: class MockOpenAI {
    constructor() { this.responses = { create: (...args) => mockCreate(...args) } }
  },
}))

vi.mock('exa-js', () => {
  return {
    default: class MockExa {
      constructor() {
        this.searchAndContents = (...args) => mockSearch(...args)
      }
    },
  }
})

import { runContrarianAgent } from './contrarianAgent'

describe('runContrarianAgent', () => {
  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = 'test-key'
    process.env.EXA_API_KEY = 'test-exa-key'
    mockCreate = vi.fn()
    mockSearch = vi.fn().mockResolvedValue({
      results: [{ title: 'Risk article', text: 'Stock faces headwinds', publishedDate: '2026-05-01' }],
    })
  })

  afterEach(() => {
    delete process.env.ANTHROPIC_API_KEY
    delete process.env.EXA_API_KEY
    delete process.env.OPENAI_API_KEY
    delete process.env.RESEARCH_MODEL_PROVIDER
    vi.clearAllMocks()
  })

  it('returns picks with bear cases from Claude response', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: JSON.stringify([
        { ticker: 'MU', bearCase: 'Memory cycle risk with oversupply building.', riskScore: 6 },
        { ticker: 'ASTS', bearCase: 'Speculative space name with no revenue.', riskScore: 8 },
      ])}],
    })

    const picks = [
      { ticker: 'MU', reason: 'AI memory demand', conviction: 7, setupType: 'squeeze' },
      { ticker: 'ASTS', reason: 'Satellite breakout', conviction: 6, setupType: 'breakout' },
    ]

    const result = await runContrarianAgent(picks)

    expect(result).toHaveLength(2)
    expect(result[0].bearCase).toBe('Memory cycle risk with oversupply building.')
    expect(result[0].riskScore).toBe(6)
    expect(result[1].bearCase).toBe('Speculative space name with no revenue.')
    expect(result[1].riskScore).toBe(8)
  })

  it('preserves original pick data alongside bear case', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: JSON.stringify([
        { ticker: 'MU', bearCase: 'Risk', riskScore: 5 },
      ])}],
    })

    const picks = [{ ticker: 'MU', reason: 'Bull thesis', conviction: 7, setupType: 'squeeze' }]
    const result = await runContrarianAgent(picks)

    expect(result[0].reason).toBe('Bull thesis')
    expect(result[0].conviction).toBe(7)
    expect(result[0].bearCase).toBe('Risk')
  })

  it('returns picks unchanged when Claude response is not valid JSON', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'Sorry, I cannot parse this input.' }],
    })

    const picks = [{ ticker: 'MU', reason: 'Test', conviction: 7 }]
    const result = await runContrarianAgent(picks)

    expect(result[0].ticker).toBe('MU')
    expect(result[0].bearCase).toBeUndefined()
  })

  it('returns empty array for empty picks input', async () => {
    const result = await runContrarianAgent([])
    expect(result).toEqual([])
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('throws when ANTHROPIC_API_KEY is not set', async () => {
    delete process.env.ANTHROPIC_API_KEY
    await expect(runContrarianAgent([{ ticker: 'X' }])).rejects.toThrow('ANTHROPIC_API_KEY')
  })

  it('includes Exa search context in Claude prompt', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: JSON.stringify([{ ticker: 'MU', bearCase: 'Risk', riskScore: 5 }]) }],
    })

    await runContrarianAgent([{ ticker: 'MU', reason: 'Thesis', conviction: 7 }])

    const callArgs = mockCreate.mock.calls[0][0]
    expect(callArgs.messages[0].content).toContain('RECENT NEGATIVE NEWS')
  })

  it('works without EXA_API_KEY (graceful skip)', async () => {
    delete process.env.EXA_API_KEY
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: JSON.stringify([{ ticker: 'MU', bearCase: 'Basic risk', riskScore: 4 }]) }],
    })

    const result = await runContrarianAgent([{ ticker: 'MU', reason: 'Test', conviction: 7 }])
    expect(result[0].bearCase).toBe('Basic risk')
  })

  it('uses OpenAI structured output in production mode', async () => {
    process.env.RESEARCH_MODEL_PROVIDER = 'openai'
    process.env.OPENAI_API_KEY = 'openai-test-key'
    mockCreate.mockResolvedValue({
      status: 'completed', output_text: JSON.stringify({ items: [{ ticker: 'MU', bearCase: 'OpenAI risk review.', riskScore: 6 }] }), usage: {},
    })
    const [result] = await runContrarianAgent([{ ticker: 'MU', reason: 'Test', conviction: 7 }])
    expect(result).toMatchObject({ ticker: 'MU', bearCase: 'OpenAI risk review.', riskScore: 6 })
    expect(mockCreate.mock.calls[0][0].text.format).toMatchObject({ type: 'json_schema', name: 'contrarian_reviews' })
  })
})
