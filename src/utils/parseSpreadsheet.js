import * as XLSX from 'xlsx'
import { extractTextFromPdf, extractPositionsFromText } from './extractPdfPositions'

/**
 * Parse a CSV, Excel, or PDF file and return rows as an array of objects.
 * All file types are processed by the server-side AI endpoint (/api/extract-pdf),
 * which uses a Groq-hosted model to identify stock positions and return them in
 * a structured format.
 *
 * @param {File} file
 * @returns {Promise<{ headers: string[], rows: Record<string, string>[] }>}
 */
export async function parseSpreadsheet(file) {
  const ext = file.name.split('.').pop().toLowerCase()

  if (ext === 'csv') {
    const text = await file.text()
    const rows = await extractPositionsFromText(text)
    const headers = rows.length > 0 ? Object.keys(rows[0]) : []
    return { headers, rows }
  }

  if (ext === 'xlsx' || ext === 'xls') {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = async (e) => {
        try {
          const workbook = XLSX.read(e.target.result, { type: 'array' })
          const sheet = workbook.Sheets[workbook.SheetNames[0]]
          const csvText = XLSX.utils.sheet_to_csv(sheet)
          const rows = await extractPositionsFromText(csvText)
          const headers = rows.length > 0 ? Object.keys(rows[0]) : []
          resolve({ headers, rows })
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
