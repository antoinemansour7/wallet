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

vi.mock('exa-js', () => {
  return {
    default: class MockExa {
      constructor() {
        this.searchAndContents = (...args) => mockSearch(...args)
      }
    },
  }
})

import { runCatalystAgent } from './catalystAgent'

describe('runCatalystAgent', () => {
  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = 'test-key'
    process.env.EXA_API_KEY = 'test-exa-key'

    mockCreate = vi.fn()
    mockSearch = vi.fn().mockResolvedValue({
      results: [
        { title: 'MU Earnings Q3 2026', url: 'https://example.com', text: 'Micron reports June 25', publishedDate: '2026-05-15' },
      ],
    })
  })

  afterEach(() => {
    delete process.env.ANTHROPIC_API_KEY
    delete process.env.EXA_API_KEY
    vi.clearAllMocks()
  })

  it('enriches picks with catalyst verification data', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: JSON.stringify([
        {
          ticker: 'MU',
          catalystVerified: true,
          catalyst: 'Q3 earnings June 25, 2026',
          timeline: '35 days',
          pricedIn: false,
          confidence: 8,
          sources: ['https://example.com'],
          eventDate: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
        },
      ])}],
    })

    const picks = [{ ticker: 'MU', reason: 'AI memory', conviction: 7 }]
    const result = await runCatalystAgent(picks)

    expect(result[0].catalystVerified).toBe(true)
    expect(result[0].catalystDetail).toBe('Q3 earnings June 25, 2026')
    expect(result[0].catalystTimeline).toBe('35 days')
    expect(result[0].catalystPricedIn).toBe(false)
    expect(result[0].catalystConfidence).toBe(8)
    expect(result[0].catalystInWindow).toBe(true)
    expect(result[0].catalystSources).toEqual(['https://example.com'])
  })

  it('sets catalystVerified=false when no catalyst found', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: JSON.stringify([
        {
          ticker: 'XYZ',
          catalystVerified: false,
          catalyst: 'No specific upcoming catalyst identified',
          timeline: null,
          pricedIn: false,
          confidence: 2,
          sources: [],
        },
      ])}],
    })

    const picks = [{ ticker: 'XYZ', reason: 'Technical setup', conviction: 5 }]
    const result = await runCatalystAgent(picks)

    expect(result[0].catalystVerified).toBe(false)
    expect(result[0].catalystDetail).toBe('No specific upcoming catalyst identified')
  })

  it('skips when EXA_API_KEY is not set', async () => {
    delete process.env.EXA_API_KEY

    const picks = [{ ticker: 'MU', reason: 'Test', conviction: 7 }]
    const result = await runCatalystAgent(picks)

    expect(result).toEqual(picks)
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('returns empty array for empty picks', async () => {
    const result = await runCatalystAgent([])
    expect(result).toEqual([])
  })

  it('searches Exa for each ticker', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: '[]' }],
    })

    await runCatalystAgent([
      { ticker: 'MU', reason: 'A' },
      { ticker: 'ASTS', reason: 'B' },
    ])

    expect(mockSearch).toHaveBeenCalledTimes(2)
    expect(mockSearch.mock.calls[0][0]).toContain('MU')
    expect(mockSearch.mock.calls[1][0]).toContain('ASTS')
  })

  it('handles Exa search failures gracefully', async () => {
    mockSearch.mockRejectedValue(new Error('Exa timeout'))
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: JSON.stringify([
        { ticker: 'MU', catalystVerified: false, catalyst: 'No data', timeline: null, pricedIn: false, confidence: 1 },
      ])}],
    })

    const picks = [{ ticker: 'MU', reason: 'Test', conviction: 7 }]
    const result = await runCatalystAgent(picks)

    expect(result[0].catalystVerified).toBe(false)
  })

  it('returns picks unchanged when Claude JSON parsing fails', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'Invalid response here' }],
    })

    const picks = [{ ticker: 'MU', reason: 'Test', conviction: 7 }]
    const result = await runCatalystAgent(picks)

    expect(result[0].ticker).toBe('MU')
    expect(result[0].catalystVerified).toBeUndefined()
  })

  it('handles ticker case mismatch between Claude response and picks', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: JSON.stringify([
        { ticker: 'mu', catalystVerified: true, catalyst: 'Earnings', timeline: '10 days', pricedIn: false, confidence: 7, eventDate: '2026-12-01', sources: ['https://example.com'] },
      ])}],
    })

    const picks = [{ ticker: 'MU', reason: 'Test', conviction: 7 }]
    const result = await runCatalystAgent(picks)

    expect(result[0].catalystVerified).toBe(true)
  })
  it('does not accept invented citations or truthy string verification', async () => {
    mockCreate.mockResolvedValue({ content: [{ type: 'text', text: JSON.stringify([
      { ticker: 'MU', catalystVerified: true, eventDate: '2026-12-01', sources: ['https://invented.example'] },
      { ticker: 'ASTS', catalystVerified: 'true', eventDate: '2026-12-01', sources: ['https://example.com'] },
    ]) }] })
    const result = await runCatalystAgent([{ ticker: 'MU' }, { ticker: 'ASTS' }])
    expect(result.every((pick) => pick.catalystVerified === false)).toBe(true)
  })

})
