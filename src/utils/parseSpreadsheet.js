import Papa from 'papaparse'
import * as XLSX from 'xlsx'
import { extractTextFromPdf, extractPositionsFromText } from './extractPdfPositions'

/**
 * Parse a CSV, Excel, or PDF file and return rows as an array of objects.
 * PDF files are processed by extracting text with PDF.js then sending to the
 * server-side AI endpoint (/api/extract-pdf) which uses Claude to identify
 * stock positions and return them in a structured format.
 *
 * @param {File} file
 * @returns {Promise<{ headers: string[], rows: Record<string, string>[] }>}
 */
export function parseSpreadsheet(file) {
  const ext = file.name.split('.').pop().toLowerCase()

  if (ext === 'csv') {
    return new Promise((resolve, reject) => {
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: (result) => resolve({ headers: result.meta.fields ?? [], rows: result.data }),
        error: reject,
      })
    })
  }

  if (ext === 'xlsx' || ext === 'xls') {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = (e) => {
        try {
          const workbook = XLSX.read(e.target.result, { type: 'array' })
          const sheet = workbook.Sheets[workbook.SheetNames[0]]
          const raw = XLSX.utils.sheet_to_json(sheet, { defval: '' })
          resolve({ headers: raw.length > 0 ? Object.keys(raw[0]) : [], rows: raw })
        } catch (err) {
          reject(err)
        }
      }
      reader.onerror = reject
      reader.readAsArrayBuffer(file)
    })
  }

  if (ext === 'pdf') {
    return (async () => {
      const text = await extractTextFromPdf(file)
      const rows = await extractPositionsFromText(text)
      const headers = rows.length > 0 ? Object.keys(rows[0]) : []
      return { headers, rows }
    })()
  }

  return Promise.reject(new Error(`Unsupported file type: .${ext}`))
}
