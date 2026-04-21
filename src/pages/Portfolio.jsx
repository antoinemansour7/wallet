import { useState, useRef } from 'react'
import { parseSpreadsheet } from '../utils/parseSpreadsheet'

const STAT_CARDS = [
  { label: 'Total Value', key: 'value', hint: 'Sum of all positions' },
  { label: 'All-time P&L', key: 'alltime', hint: 'Since inception' },
  { label: '1-Year Return', key: 'oney', hint: 'Last 12 months' },
  { label: "30-Day Change", key: 'thirty', hint: 'Last 30 days' },
]

export default function Portfolio() {
  const [headers, setHeaders] = useState([])
  const [rows, setRows] = useState([])
  const [fileName, setFileName] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const inputRef = useRef(null)

  const handleFile = async (file) => {
    if (!file) return
    setError('')
    setLoading(true)
    try {
      const { headers, rows } = await parseSpreadsheet(file)
      setHeaders(headers)
      setRows(rows)
      setFileName(file.name)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const onDrop = (e) => {
    e.preventDefault()
    setIsDragging(false)
    handleFile(e.dataTransfer.files[0])
  }

  return (
    <div className="min-h-screen bg-wall-bg">
      <div className="max-w-6xl mx-auto px-6 py-8">

        {/* Header */}
        <div className="mb-8">
          <h1 className="text-xl font-semibold text-slate-100 mb-1">Portfolio</h1>
          <p className="text-slate-500 text-sm">Upload your spreadsheet to analyse positions and P&L.</p>
        </div>

        {/* Stat cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-8">
          {STAT_CARDS.map(({ label, hint }) => (
            <div key={label} className="bg-wall-surface border border-white/[0.06] rounded-xl p-4 group">
              <p className="text-slate-500 text-[11px] font-medium uppercase tracking-wider mb-2">{label}</p>
              <p className="text-2xl font-semibold text-slate-600 font-mono tabular">—</p>
              {/* TODO: calculate from rows + stock API */}
              <p className="text-slate-700 text-[11px] mt-1.5">{hint}</p>
            </div>
          ))}
        </div>

        {/* Upload zone */}
        <div
          className={`relative border-2 border-dashed rounded-2xl p-10 text-center cursor-pointer transition-all duration-200 mb-6 ${
            isDragging
              ? 'border-blue-500/60 bg-blue-500/[0.04]'
              : fileName
              ? 'border-emerald-500/30 bg-emerald-500/[0.02] hover:border-emerald-500/50'
              : 'border-white/[0.08] bg-wall-surface hover:border-white/[0.16] hover:bg-wall-elevated'
          }`}
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={onDrop}
        >
          <input
            ref={inputRef}
            type="file"
            accept=".csv,.xlsx,.xls"
            className="hidden"
            onChange={(e) => handleFile(e.target.files[0])}
          />

          {loading ? (
            <div className="flex flex-col items-center gap-3">
              <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
              <p className="text-slate-400 text-sm">Parsing file…</p>
            </div>
          ) : fileName ? (
            <div className="flex flex-col items-center gap-2">
              <div className="w-10 h-10 bg-emerald-500/10 border border-emerald-500/20 rounded-xl flex items-center justify-center mb-1">
                <CheckIcon />
              </div>
              <p className="text-emerald-400 font-medium text-sm">{fileName}</p>
              <p className="text-slate-600 text-xs">{rows.length} rows loaded · click to replace</p>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2">
              <div className="w-10 h-10 bg-white/[0.04] border border-white/[0.08] rounded-xl flex items-center justify-center mb-1">
                <UploadIcon />
              </div>
              <p className="text-slate-300 font-medium text-sm">Drop your portfolio here</p>
              <p className="text-slate-600 text-xs">CSV · XLSX · XLS · drag & drop or click to browse</p>
            </div>
          )}
        </div>

        {error && (
          <div className="flex items-center gap-2 bg-rose-500/10 border border-rose-500/20 rounded-xl px-4 py-3 mb-6">
            <span className="text-rose-400 text-sm">{error}</span>
          </div>
        )}

        {/* Data table */}
        {rows.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-slate-300 text-sm font-medium">Raw Data</h2>
              <span className="text-slate-600 text-xs bg-wall-surface border border-white/[0.06] px-2.5 py-1 rounded-full">
                {rows.length} row{rows.length !== 1 ? 's' : ''}
              </span>
            </div>
            <div className="overflow-x-auto rounded-xl border border-white/[0.06] bg-wall-surface">
              <table className="min-w-full">
                <thead>
                  <tr className="border-b border-white/[0.06]">
                    {headers.map((h) => (
                      <th
                        key={h}
                        className="px-4 py-3 text-left text-[11px] font-medium text-slate-500 uppercase tracking-wider whitespace-nowrap"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, i) => (
                    <tr
                      key={i}
                      className="border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors last:border-0"
                    >
                      {headers.map((h) => (
                        <td
                          key={h}
                          className="px-4 py-2.5 text-sm text-slate-300 whitespace-nowrap font-mono tabular"
                        >
                          {row[h] ?? '—'}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {/* TODO: compute P&L per row using stock API price data */}
              <div className="px-4 py-2.5 border-t border-white/[0.04]">
                <p className="text-slate-700 text-xs">
                  P&L calculations will appear here once a stock price API is connected.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function UploadIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-slate-400">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-400">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}
