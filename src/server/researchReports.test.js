import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

// Report generation is the longest leg of the nightly run and the one that
// overran the 300s function limit while it was sequential. These tests pin the
// two properties that fix depends on: the calls overlap, and one failure never
// costs the reports that did succeed.

const createMessage = vi.fn()
const createResponse = vi.fn()

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    constructor() {
      this.messages = { create: createMessage }
    }
  },
}))

vi.mock('openai', () => ({
  default: class {
    constructor() { this.responses = { create: createResponse } }
  },
}))

const { generateResearchReports } = await import('./researchEngine.js')

const textBlock = (text) => ({ type: 'text', text })
const tickerList = (...symbols) => symbols.map((ticker) => ({ ticker, conviction: 7 }))

describe('generateResearchReports', () => {
  beforeEach(() => {
    createMessage.mockReset()
    createResponse.mockReset()
    process.env.ANTHROPIC_API_KEY = 'test-key'
    delete process.env.RESEARCH_REPORT_CONCURRENCY
    delete process.env.OPENAI_API_KEY
    delete process.env.RESEARCH_MODEL_PROVIDER
  })

  afterEach(() => {
    delete process.env.ANTHROPIC_API_KEY
    delete process.env.RESEARCH_REPORT_CONCURRENCY
  })

  it('returns picks without reports when no API key is configured', async () => {
    delete process.env.ANTHROPIC_API_KEY
    const results = await generateResearchReports(tickerList('AAA', 'BBB'))
    expect(results.map((r) => r.ticker)).toEqual(['AAA', 'BBB'])
    expect(results.every((r) => r.report === null)).toBe(true)
    expect(createMessage).not.toHaveBeenCalled()
  })

  it('keeps disclosure reports tied to their declared horizon and zero-mention evidence', async () => {
    createMessage.mockResolvedValue({ content: [textBlock('Disclosure report')] })
    const [result] = await generateResearchReports([{ ticker: 'QUIET', candidateId: 'quiet20', horizon: 20, strategyFamily: 'fundamentals', signalCount: 0, sources: ['https://www.sec.gov/filing'], finalScore: 74 }])
    const prompt = createMessage.mock.calls[0][0].messages[0].content
    expect(prompt).toContain('20-trading-session horizon (fundamentals)')
    expect(prompt).toContain('Attention mentions: 0')
    expect(prompt).toContain('https://www.sec.gov/filing')
    expect(result).toMatchObject({ candidateId: 'quiet20', finalScore: 74, horizon: 20, report: 'Disclosure report' })
  })

  it('runs every report concurrently rather than one after another', async () => {
    let inFlight = 0
    let peak = 0
    const release = []
    createMessage.mockImplementation(() => {
      inFlight += 1
      peak = Math.max(peak, inFlight)
      return new Promise((resolve) => {
        release.push(() => {
          inFlight -= 1
          resolve({ content: [textBlock('report body')] })
        })
      })
    })

    const pending = generateResearchReports(tickerList('AAA', 'BBB', 'CCC', 'DDD', 'EEE'))
    // Let all five workers reach their await before any of them resolves.
    await vi.waitFor(() => expect(release).toHaveLength(5))
    release.forEach((fn) => fn())
    await pending

    expect(peak).toBe(5)
  })

  it('honours a configured concurrency cap', async () => {
    process.env.RESEARCH_REPORT_CONCURRENCY = '2'
    let inFlight = 0
    let peak = 0
    createMessage.mockImplementation(async () => {
      inFlight += 1
      peak = Math.max(peak, inFlight)
      await Promise.resolve()
      inFlight -= 1
      return { content: [textBlock('report body')] }
    })

    await generateResearchReports(tickerList('AAA', 'BBB', 'CCC', 'DDD'))
    expect(peak).toBe(2)
  })

  it('preserves the input order regardless of completion order', async () => {
    const delays = { AAA: 30, BBB: 0, CCC: 15 }
    createMessage.mockImplementation(({ messages }) => {
      const ticker = ['AAA', 'BBB', 'CCC'].find((t) => messages[0].content.includes(t))
      return new Promise((resolve) => {
        setTimeout(() => resolve({ content: [textBlock(`${ticker} report`)] }), delays[ticker])
      })
    })

    const results = await generateResearchReports(tickerList('AAA', 'BBB', 'CCC'))
    expect(results.map((r) => r.ticker)).toEqual(['AAA', 'BBB', 'CCC'])
    expect(results.map((r) => r.report)).toEqual(['AAA report', 'BBB report', 'CCC report'])
  })

  it('keeps the successful reports when one ticker fails', async () => {
    createMessage.mockImplementation(({ messages }) => {
      if (messages[0].content.includes('BBB')) return Promise.reject(new Error('upstream exploded'))
      return Promise.resolve({ content: [textBlock('good report')] })
    })

    const results = await generateResearchReports(tickerList('AAA', 'BBB', 'CCC'))
    expect(results.map((r) => r.ticker)).toEqual(['AAA', 'BBB', 'CCC'])
    expect(results[0].report).toBe('good report')
    expect(results[2].report).toBe('good report')
    expect(results[1].report).toBeNull()
    expect(results[1].reportError).toBe('upstream exploded')
  })

  it('stops calling the API once the key is out of credit', async () => {
    process.env.RESEARCH_REPORT_CONCURRENCY = '1'
    createMessage.mockImplementation(() => {
      const err = new Error('insufficient credit balance')
      err.status = 402
      return Promise.reject(err)
    })

    const results = await generateResearchReports(tickerList('AAA', 'BBB', 'CCC'))
    // First call fails and trips the flag; the two later starters skip theirs.
    expect(createMessage).toHaveBeenCalledTimes(1)
    expect(results[0].reportError).toBe('insufficient credit balance')
    expect(results.slice(1).every((r) => r.report === null && !r.reportError)).toBe(true)
  })

  it('collects citations from search results and from cited text', async () => {
    createMessage.mockResolvedValue({
      content: [
        {
          type: 'web_search_tool_result',
          content: [{ url: 'https://example.com/a' }, { url: 'https://example.com/b' }],
        },
        {
          type: 'text',
          text: 'Body text.',
          citations: [{ url: 'https://example.com/b' }, { url: 'https://example.com/c' }],
        },
      ],
    })

    const [result] = await generateResearchReports(tickerList('AAA'))
    expect(result.report).toBe('Body text.')
    // Deduped across both block shapes.
    expect(result.citations).toEqual([
      'https://example.com/a',
      'https://example.com/b',
      'https://example.com/c',
    ])
  })

  // Three concurrent web-search reports exceeded the 200k tokens-per-minute
  // limit in production (2026-09-24), so OpenAI reports run one at a time.
  it('uses OpenAI web search, one report at a time, in production mode', async () => {
    process.env.RESEARCH_MODEL_PROVIDER = 'openai'
    process.env.OPENAI_API_KEY = 'openai-test-key'
    let inFlight = 0
    let peak = 0
    createResponse.mockImplementation(async ({ input }) => {
      inFlight += 1
      peak = Math.max(peak, inFlight)
      await new Promise((resolve) => setTimeout(resolve, 1))
      inFlight -= 1
      return {
        status: 'completed', output_text: input.includes('AAA') ? 'AAA report' : 'report',
        output: [{ content: [{ annotations: [{ url: 'https://example.com/source' }] }] }], usage: {},
      }
    })
    const results = await generateResearchReports(tickerList('AAA', 'BBB', 'CCC'))
    expect(peak).toBe(1)
    expect(results[0]).toMatchObject({ ticker: 'AAA', report: 'AAA report', citations: ['https://example.com/source'] })
    expect(createResponse.mock.calls[0][0].tools).toEqual([{ type: 'web_search', search_context_size: 'low' }])
    expect(createMessage).not.toHaveBeenCalled()
  })
})
