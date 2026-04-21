import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as XLSX from 'xlsx'
import { parseSpreadsheet } from './parseSpreadsheet'

function makeFile(content, filename, type = 'text/csv') {
  return new File([content], filename, { type })
}

const AI_ROWS = [
  { SYMBOL: 'AAPL', DESCRIPTION: 'Apple Inc.', QUANTITY: '10', 'MARKET VALUE': '1500.00' },
  { SYMBOL: 'MSFT', DESCRIPTION: 'Microsoft Corp.', QUANTITY: '5', 'MARKET VALUE': '1500.00' },
]

describe('parseSpreadsheet', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ rows: AI_ROWS }),
    }))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('CSV', () => {
    it('sends CSV text to the AI endpoint and returns normalized rows', async () => {
      const csv = 'Symbol,Shares,Price\nAAPL,10,150.00\nMSFT,5,300.00'
      const { headers, rows } = await parseSpreadsheet(makeFile(csv, 'portfolio.csv'))

      expect(fetch).toHaveBeenCalledWith('/api/extract-pdf', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ text: csv }),
      }))
      expect(rows).toEqual(AI_ROWS)
      expect(headers).toEqual(Object.keys(AI_ROWS[0]))
    })

    it('returns empty headers and rows when AI returns empty array', async () => {
      fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ rows: [] }) })
      const csv = 'Symbol,Shares\n'
      const { headers, rows } = await parseSpreadsheet(makeFile(csv, 'empty.csv'))

      expect(rows).toHaveLength(0)
      expect(headers).toHaveLength(0)
    })
  })

  describe('Excel', () => {
    it('converts Excel to CSV, sends to AI endpoint, and returns normalized rows', async () => {
      const ws = XLSX.utils.aoa_to_sheet([['Symbol', 'Shares'], ['AAPL', 10]])
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, 'Sheet1')
      const buffer = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
      const file = new File(
        [buffer],
        'portfolio.xlsx',
        { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
      )

      const { headers, rows } = await parseSpreadsheet(file)

      expect(fetch).toHaveBeenCalledWith('/api/extract-pdf', expect.objectContaining({
        method: 'POST',
      }))
      expect(rows).toEqual(AI_ROWS)
      expect(headers).toEqual(Object.keys(AI_ROWS[0]))
    })
  })

  describe('unsupported file types', () => {
    it('rejects .docx files', async () => {
      const file = makeFile('data', 'report.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
      await expect(parseSpreadsheet(file)).rejects.toThrow('Unsupported file type: .docx')
    })

    it('rejects .txt files', async () => {
      const file = makeFile('hello', 'notes.txt', 'text/plain')
      await expect(parseSpreadsheet(file)).rejects.toThrow('Unsupported file type: .txt')
    })
  })
})
