import Papa from 'papaparse'
import * as XLSX from 'xlsx'

/**
 * Parse a CSV or Excel file and return rows as an array of objects.
 * @param {File} file
 * @returns {Promise<{ headers: string[], rows: Record<string, string>[] }>}
 */
export function parseSpreadsheet(file) {
  return new Promise((resolve, reject) => {
    const ext = file.name.split('.').pop().toLowerCase()

    if (ext === 'csv') {
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: (result) => {
          resolve({
            headers: result.meta.fields ?? [],
            rows: result.data,
          })
        },
        error: reject,
      })
    } else if (ext === 'xlsx' || ext === 'xls') {
      const reader = new FileReader()
      reader.onload = (e) => {
        try {
          const workbook = XLSX.read(e.target.result, { type: 'array' })
          const sheetName = workbook.SheetNames[0]
          const sheet = workbook.Sheets[sheetName]
          const raw = XLSX.utils.sheet_to_json(sheet, { defval: '' })
          const headers = raw.length > 0 ? Object.keys(raw[0]) : []
          resolve({ headers, rows: raw })
        } catch (err) {
          reject(err)
        }
      }
      reader.onerror = reject
      reader.readAsArrayBuffer(file)
    } else {
      reject(new Error(`Unsupported file type: .${ext}`))
    }
  })
}
