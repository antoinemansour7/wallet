import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { extractPositionsFromText } from './extractPdfPositions'

// extractTextFromPdf needs pdfjs-dist + a real Worker — skip in unit tests.
// It is an integration concern tested manually with a real PDF.

const MOCK_ROWS = [
  {
    'ACCOUNT NUMBER': 'ACC001',
    'SYMBOL': 'AAPL',
    'DESCRIPTION': 'Apple Inc.',
    'QUANTITY': '10',
    'MARKET VALUE': '1500.00',
    'UNREALIZED GAIN/LOSS': '300.00',
  },
]

describe('extractPositionsFromText', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns rows on successful API response', async () => {
    fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ rows: MOCK_ROWS }),
    })

    const rows = await extractPositionsFromText('some brokerage text')
    expect(rows).toEqual(MOCK_ROWS)
    expect(fetch).toHaveBeenCalledWith('/api/extract-pdf', expect.objectContaining({
      method: 'POST',
    }))
  })

  it('sends the text in the request body', async () => {
    fetch.mockResolvedValue({ ok: true, json: async () => ({ rows: [] }) })

    await extractPositionsFromText('my portfolio text')

    const [, options] = fetch.mock.calls[0]
    const body = JSON.parse(options.body)
    expect(body.text).toBe('my portfolio text')
  })

  it('throws when server returns an error', async () => {
    fetch.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: 'ANTHROPIC_API_KEY is not set' }),
    })

    await expect(extractPositionsFromText('text')).rejects.toThrow('ANTHROPIC_API_KEY is not set')
  })

  it('throws when response rows is not an array', async () => {
    fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ rows: 'oops' }),
    })

    await expect(extractPositionsFromText('text')).rejects.toThrow('unexpected response format')
  })

  it('returns an empty array when AI finds no positions', async () => {
    fetch.mockResolvedValue({ ok: true, json: async () => ({ rows: [] }) })

    const rows = await extractPositionsFromText('This PDF contains no stock data.')
    expect(rows).toEqual([])
  })
})

describe('parseSpreadsheet with PDF extension', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('routes .pdf files through the AI endpoint', async () => {
    // Mock the AI API to return structured rows
    fetch.mockResolvedValue({ ok: true, json: async () => ({ rows: MOCK_ROWS }) })

    // We can't easily run pdfjs-dist in jsdom, so mock extractTextFromPdf
    vi.doMock('./extractPdfPositions', () => ({
      extractTextFromPdf: vi.fn().mockResolvedValue('raw pdf text'),
      extractPositionsFromText: vi.fn().mockResolvedValue(MOCK_ROWS),
    }))

    // Re-import after mock to get mocked version
    const { parseSpreadsheet } = await import('./parseSpreadsheet')
    const file = new File(['%PDF'], 'statement.pdf', { type: 'application/pdf' })
    const { rows, headers } = await parseSpreadsheet(file)

    expect(rows).toEqual(MOCK_ROWS)
    expect(headers).toContain('SYMBOL')

    vi.doUnmock('./extractPdfPositions')
  })
})
