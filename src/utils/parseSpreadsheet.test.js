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
    it('normalizes structured CSV rows without AI so file values stay intact', async () => {
      const csv = [
        'Account number;Account currency;Symbol;Description;Quantity;Average unit cost;Book value;Market price;Day Change $;Day Change %;Market Value;Day Change;Unrealized gain/loss;Unrealized gain/loss %',
        '"68BB39W";CAD;AVGO;"BROADCOM INC CDR C$HDG";"655";"13.50971";"8848.86";"15.30000";"-0.05000";"-0.33%";"10021.50";"-32.75";"1172.64";"13.25%"',
      ].join('\n')
      const { headers, rows } = await parseSpreadsheet(makeFile(csv, 'portfolio.csv'))

      expect(fetch).not.toHaveBeenCalled()
      expect(headers).toContain('MARKET VALUE')
      expect(rows[0]).toMatchObject({
        'ACCOUNT NUMBER': '68BB39W',
        'ACCOUNT CURRENCY': 'CAD',
        SYMBOL: 'AVGO',
        DESCRIPTION: 'BROADCOM INC CDR C$HDG',
        QUANTITY: '655',
        'MARKET PRICE': '15.30000',
        'MARKET VALUE': '10021.50',
        'DAY CHANGE': '-32.75',
        'UNREALIZED GAIN/LOSS': '1172.64',
      })
    })

    it('falls back to AI when CSV has no recognizable holdings rows', async () => {
      fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ rows: AI_ROWS }) })
      const csv = 'Notes\nAAPL 10 shares at 150'
      const { headers, rows } = await parseSpreadsheet(makeFile(csv, 'notes.csv'))

      expect(fetch).toHaveBeenCalledWith('/api/extract-pdf', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ text: csv }),
      }))
      expect(rows).toEqual(AI_ROWS)
      expect(headers).toEqual(Object.keys(AI_ROWS[0]))
    })

    it('returns empty headers and rows when AI fallback returns empty array', async () => {
      fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ rows: [] }) })
      const csv = 'Notes\n'
      const { headers, rows } = await parseSpreadsheet(makeFile(csv, 'empty.csv'))

      expect(rows).toHaveLength(0)
      expect(headers).toHaveLength(0)
    })

    it('extracts explicit cash rows separately from position rows', async () => {
      const csv = [
        'Account number;Account currency;Symbol;Description;Quantity;Book value;Market Value',
        '"68BB39W";CAD;AVGO;"BROADCOM INC CDR C$HDG";"655";"8848.86";"10021.50"',
        '"68BB39W";CAD;;"Cash balance";;"0";"6420.25"',
      ].join('\n')

      const { rows, cashEntries } = await parseSpreadsheet(makeFile(csv, 'portfolio.csv'))

      expect(rows).toHaveLength(1)
      expect(rows[0].SYMBOL).toBe('AVGO')
      expect(cashEntries).toEqual([
        expect.objectContaining({
          accountNumber: '68BB39W',
          currency: 'CAD',
          amount: '6420.25',
        }),
      ])
    })
  })

  describe('Excel', () => {
    it('normalizes structured Excel rows without AI', async () => {
      const ws = XLSX.utils.aoa_to_sheet([
        ['Account number', 'Account currency', 'Symbol', 'Description', 'Quantity', 'Market price', 'Market Value'],
        ['68BB39Q', 'CAD', 'AMZN', 'AMAZON.COM INC CDR C$HDG', 49, 29.17, 1429.33],
      ])
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, 'Sheet1')
      const buffer = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
      const file = new File(
        [buffer],
        'portfolio.xlsx',
        { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
      )

      const { headers, rows } = await parseSpreadsheet(file)

      expect(fetch).not.toHaveBeenCalled()
      expect(headers).toContain('SYMBOL')
      expect(rows[0]).toMatchObject({
        'ACCOUNT NUMBER': '68BB39Q',
        'ACCOUNT CURRENCY': 'CAD',
        SYMBOL: 'AMZN',
        'MARKET PRICE': '29.17',
        'MARKET VALUE': '1429.33',
      })
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
