import Papa from 'papaparse'
import * as XLSX from 'xlsx'
import { extractTextFromPdf, extractPositionsFromText } from './extractPdfPositions'

const OUTPUT_HEADERS = [
  'ACCOUNT NUMBER',
  'ACCOUNT CURRENCY',
  'SYMBOL',
  'DESCRIPTION',
  'QUANTITY',
  'AVERAGE UNIT COST',
  'BOOK VALUE',
  'MARKET PRICE',
  'MARKET VALUE',
  'DAY CHANGE',
  'DAY CHANGE %',
  'UNREALIZED GAIN/LOSS',
  'UNREALIZED GAIN/LOSS %',
]

const COLUMN_ALIASES = {
  'ACCOUNT NUMBER': ['account number', 'account', 'account no', 'account #'],
  'ACCOUNT CURRENCY': ['account currency', 'currency'],
  SYMBOL: ['symbol', 'ticker'],
  DESCRIPTION: ['description', 'security', 'security description', 'name'],
  QUANTITY: ['quantity', 'shares', 'units'],
  'AVERAGE UNIT COST': ['average unit cost', 'avg cost', 'average cost', 'cost basis per share'],
  'BOOK VALUE': ['book value', 'cost basis', 'total cost'],
  'MARKET PRICE': ['market price', 'price', 'last price'],
  'MARKET VALUE': ['market value', 'mkt value', 'value'],
  'DAY CHANGE': ['day change', 'day change total', 'today change', 'today change total'],
  'DAY CHANGE %': ['day change %', 'today change %', 'change %'],
  'UNREALIZED GAIN/LOSS': ['unrealized gain/loss', 'unrealized gain loss', 'unrealized p&l', 'p&l'],
  'UNREALIZED GAIN/LOSS %': ['unrealized gain/loss %', 'unrealized gain loss %', 'unrealized p&l %', 'p&l %'],
}

function cleanValue(value) {
  if (value === null || value === undefined) return ''
  return String(value).trim().replace(/^"(.*)"$/, '$1')
}

function normalizeHeader(header) {
  return String(header ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

function buildHeaderIndex(row) {
  const index = new Map()
  Object.keys(row).forEach((key) => {
    index.set(normalizeHeader(key), key)
  })
  return index
}

function getValue(row, headerIndex, outputKey) {
  const aliases = COLUMN_ALIASES[outputKey] ?? [outputKey]
  for (const alias of aliases) {
    const originalKey = headerIndex.get(normalizeHeader(alias))
    if (originalKey !== undefined) return cleanValue(row[originalKey])
  }
  return ''
}

function normalizeStructuredRows(rawRows) {
  const rows = rawRows
    .filter((row) => Object.values(row).some((value) => cleanValue(value) !== ''))
    .map((row) => {
      const headerIndex = buildHeaderIndex(row)
      const normalized = {}
      OUTPUT_HEADERS.forEach((key) => {
        normalized[key] = getValue(row, headerIndex, key)
      })
      return normalized
    })
    .filter((row) => row.SYMBOL || row.DESCRIPTION)

  return { headers: OUTPUT_HEADERS, rows }
}

/**
 * Parse a CSV, Excel, or PDF file and return rows as an array of objects.
 * Structured CSV/Excel files are normalized deterministically so uploaded
 * brokerage values remain intact. PDFs still use the AI extraction endpoint.
 *
 * @param {File} file
 * @returns {Promise<{ headers: string[], rows: Record<string, string>[] }>}
 */
export async function parseSpreadsheet(file) {
  const ext = file.name.split('.').pop().toLowerCase()

  if (ext === 'csv') {
    const text = await file.text()
    const parsed = Papa.parse(text, { header: true, skipEmptyLines: true })
    const normalized = normalizeStructuredRows(parsed.data)
    if (normalized.rows.length > 0) return normalized

    const rows = await extractPositionsFromText(text)
    return { headers: rows.length > 0 ? Object.keys(rows[0]) : [], rows }
  }

  if (ext === 'xlsx' || ext === 'xls') {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = async (e) => {
        try {
          const workbook = XLSX.read(e.target.result, { type: 'array' })
          const sheet = workbook.Sheets[workbook.SheetNames[0]]
          const rawRows = XLSX.utils.sheet_to_json(sheet, { defval: '' })
          const normalized = normalizeStructuredRows(rawRows)
          if (normalized.rows.length > 0) {
            resolve(normalized)
            return
          }

          const csvText = XLSX.utils.sheet_to_csv(sheet)
          const rows = await extractPositionsFromText(csvText)
          resolve({ headers: rows.length > 0 ? Object.keys(rows[0]) : [], rows })
        } catch (err) {
          reject(err)
        }
      }
      reader.onerror = reject
      reader.readAsArrayBuffer(file)
    })
  }

  if (ext === 'pdf') {
    const text = await extractTextFromPdf(file)
    const rows = await extractPositionsFromText(text)
    const headers = rows.length > 0 ? Object.keys(rows[0]) : []
    return { headers, rows }
  }

  return Promise.reject(new Error(`Unsupported file type: .${ext}`))
}
