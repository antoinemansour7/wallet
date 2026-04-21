import { describe, it, expect } from 'vitest'
import { parseSpreadsheet } from './parseSpreadsheet'

function makeFile(content, filename, type = 'text/csv') {
  return new File([content], filename, { type })
}

describe('parseSpreadsheet', () => {
  describe('CSV', () => {
    it('parses headers and rows from a valid CSV', async () => {
      const csv = 'Symbol,Shares,Price\nAAPL,10,150.00\nMSFT,5,300.00'
      const { headers, rows } = await parseSpreadsheet(makeFile(csv, 'portfolio.csv'))

      expect(headers).toEqual(['Symbol', 'Shares', 'Price'])
      expect(rows).toHaveLength(2)
      expect(rows[0]).toMatchObject({ Symbol: 'AAPL', Shares: '10', Price: '150.00' })
      expect(rows[1]).toMatchObject({ Symbol: 'MSFT', Shares: '5', Price: '300.00' })
    })

    it('returns empty arrays for a header-only CSV', async () => {
      const csv = 'Symbol,Shares,Price\n'
      const { headers, rows } = await parseSpreadsheet(makeFile(csv, 'empty.csv'))

      expect(headers).toEqual(['Symbol', 'Shares', 'Price'])
      expect(rows).toHaveLength(0)
    })

    it('skips blank lines', async () => {
      const csv = 'Symbol,Shares\nAAPL,10\n\nMSFT,5\n'
      const { rows } = await parseSpreadsheet(makeFile(csv, 'gaps.csv'))

      expect(rows).toHaveLength(2)
    })

    it('handles a single-column CSV', async () => {
      const csv = 'Ticker\nAAPL\nNVDA\nTSLA'
      const { headers, rows } = await parseSpreadsheet(makeFile(csv, 'tickers.csv'))

      expect(headers).toEqual(['Ticker'])
      expect(rows).toHaveLength(3)
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
