import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist'

// Point the PDF.js worker at the bundled asset
GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).href

/**
 * Extract all raw text from every page of a PDF File.
 * @param {File} file
 * @returns {Promise<string>}
 */
export async function extractTextFromPdf(file) {
  const arrayBuffer = await file.arrayBuffer()
  const pdf = await getDocument({ data: new Uint8Array(arrayBuffer) }).promise

  const pages = []
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const content = await page.getTextContent()
    pages.push(content.items.map((item) => item.str).join(' '))
  }

  return pages.join('\n\n')
}

/**
 * Send raw PDF text to the server-side AI endpoint and get back structured rows.
 * @param {string} text
 * @returns {Promise<Record<string,string>[]>}
 */
export async function extractPositionsFromText(text) {
  const res = await fetch('/api/extract-pdf', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  })

  const data = await res.json()

  if (!res.ok) {
    throw new Error(data.error || `Server error ${res.status}`)
  }

  if (!Array.isArray(data.rows)) {
    throw new Error('AI returned unexpected response format')
  }

  return data.rows
}
