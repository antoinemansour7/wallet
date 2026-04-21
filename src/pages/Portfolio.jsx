import { useState, useRef } from 'react'
import { parseSpreadsheet } from '../utils/parseSpreadsheet'
import {
  parseNum, fmtCurrency, fmtPct, fmtNumber, pnlColor,
  computeStats, groupByAccount,
} from '../utils/portfolioStats'

// ─── Column definitions ────────────────────────────────────────────────────
const COLS = [
  { key: 'SYMBOL',                 label: 'Symbol',     align: 'left',  type: 'symbol'   },
  { key: 'DESCRIPTION',            label: 'Description',align: 'left',  type: 'desc'     },
  { key: 'QUANTITY',               label: 'Qty',        align: 'right', type: 'number'   },
  { key: 'MARKET PRICE',           label: 'Price',      align: 'right', type: 'currency' },
  { key: 'MARKET VALUE',           label: 'Mkt Value',  align: 'right', type: 'currency' },
  { key: 'BOOK VALUE',             label: 'Book Value', align: 'right', type: 'currency' },
  { key: 'DAY CHANGE',             label: 'Day Chg',    align: 'right', type: 'pnl'      },
  { key: 'DAY CHANGE %',           label: 'Day %',      align: 'right', type: 'pct'      },
  { key: 'UNREALIZED GAIN/LOSS',   label: 'P&L',        align: 'right', type: 'pnl'      },
  { key: 'UNREALIZED GAIN/LOSS %', label: 'P&L %',      align: 'right', type: 'pct'      },
]

function renderCell(type, val) {
  switch (type) {
    case 'currency': return { text: fmtCurrency(val), cls: 'text-slate-300' }
    case 'pnl':      return { text: fmtCurrency(val), cls: pnlColor(val) }
    case 'pct':      return { text: fmtPct(val),      cls: pnlColor(val) }
    case 'number':   return { text: fmtNumber(val),   cls: 'text-slate-300' }
    case 'symbol':   return { text: val ?? '—',        cls: 'text-slate-100 font-semibold' }
    case 'desc':     return { text: val ?? '—',        cls: 'text-slate-400' }
    default:         return { text: val ?? '—',        cls: 'text-slate-300' }
  }
}

// ─── Component ─────────────────────────────────────────────────────────────
export default function Portfolio() {
  const [rows, setRows]             = useState([])
  const [fileName, setFileName]     = useState('')
  const [error, setError]           = useState('')
  const [loading, setLoading]       = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const inputRef = useRef(null)

  const handleFile = async (file) => {
    if (!file) return
    setError('')
    setLoading(true)
    try {
      const { rows } = await parseSpreadsheet(file)
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

  const hasData = rows.length > 0
  const stats   = hasData ? computeStats(rows) : null
  const groups  = hasData ? groupByAccount(rows) : []

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
          <StatCard
            label="Total Value"
            value={stats ? fmtCurrency(stats.totalMarketValue) : null}
            sub={hasData ? `${rows.length} positions` : 'Sum of all positions'}
          />
          <StatCard
            label="All-time P&L"
            value={stats ? fmtCurrency(stats.totalUnrealized) : null}
            sub={stats ? fmtPct(stats.unrealizedPct) : 'Unrealized gain/loss'}
            pnl={stats?.totalUnrealized}
          />
          <StatCard
            label="Today's Change"
            value={stats ? fmtCurrency(stats.totalDayChange) : null}
            sub={stats ? fmtPct(stats.dayChangePct) : 'vs. yesterday close'}
            pnl={stats?.totalDayChange}
          />
          <StatCard
            label="Positions"
            value={hasData ? String(rows.length) : null}
            sub={hasData ? `${groups.length} account${groups.length !== 1 ? 's' : ''}` : 'Across all accounts'}
          />
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
          <div className="bg-rose-500/10 border border-rose-500/20 rounded-xl px-4 py-3 mb-6">
            <p className="text-rose-400 text-sm">{error}</p>
          </div>
        )}

        {/* Positions table grouped by account */}
        {hasData && (
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-slate-300 text-sm font-medium">Positions</h2>
              <span className="text-slate-600 text-xs bg-wall-surface border border-white/[0.06] px-2.5 py-1 rounded-full">
                {rows.length} row{rows.length !== 1 ? 's' : ''}
              </span>
            </div>

            <div className="rounded-xl border border-white/[0.06] overflow-hidden">
              {groups.map(([acct, acctRows], gi) => {
                const acctStats = computeStats(acctRows)
                return (
                  <div key={acct} className={gi > 0 ? 'border-t border-white/[0.08]' : ''}>
                    {/* Account header */}
                    <div className="flex items-center justify-between px-4 py-2.5 bg-wall-elevated border-b border-white/[0.06]">
                      <div className="flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />
                        <span className="text-slate-400 text-xs font-medium tracking-wide">Account {acct}</span>
                        <span className="text-slate-700 text-xs">· {acctRows.length} positions</span>
                      </div>
                      <span className="text-slate-300 text-xs font-mono tabular font-medium">
                        {fmtCurrency(acctStats.totalMarketValue)}
                      </span>
                    </div>

                    {/* Column headers */}
                    <div className="overflow-x-auto bg-wall-surface">
                      <table className="min-w-full">
                        {gi === 0 && (
                          <thead>
                            <tr className="border-b border-white/[0.06]">
                              {COLS.map((col) => (
                                <th
                                  key={col.key}
                                  className={`px-4 py-3 text-[11px] font-medium text-slate-600 uppercase tracking-wider whitespace-nowrap ${
                                    col.align === 'right' ? 'text-right' : 'text-left'
                                  }`}
                                >
                                  {col.label}
                                </th>
                              ))}
                            </tr>
                          </thead>
                        )}
                        <tbody>
                          {acctRows.map((row, i) => (
                            <tr
                              key={i}
                              className="border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors last:border-0"
                            >
                              {COLS.map((col) => {
                                const { text, cls } = renderCell(col.type, row[col.key])
                                return (
                                  <td
                                    key={col.key}
                                    className={`px-4 py-2.5 text-sm whitespace-nowrap font-mono tabular ${cls} ${
                                      col.align === 'right' ? 'text-right' : 'text-left'
                                    } ${col.type === 'desc' ? 'max-w-[180px] truncate font-sans' : ''}`}
                                    title={col.type === 'desc' ? (row[col.key] ?? '') : undefined}
                                  >
                                    {text}
                                  </td>
                                )
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {/* Account subtotal */}
                    <div className="flex items-center justify-between px-4 py-2.5 bg-wall-elevated border-t border-white/[0.06]">
                      <span className="text-slate-600 text-xs font-medium">Subtotal</span>
                      <div className="flex items-center gap-4 font-mono tabular text-xs">
                        <span className="text-slate-500">
                          Book {fmtCurrency(acctRows.reduce((s, r) => s + parseNum(r['BOOK VALUE']), 0))}
                        </span>
                        <span className={`font-medium ${pnlColor(acctStats.totalUnrealized)}`}>
                          P&L {fmtCurrency(acctStats.totalUnrealized)} ({fmtPct(acctStats.unrealizedPct)})
                        </span>
                        <span className={pnlColor(acctStats.totalDayChange)}>
                          Day {fmtCurrency(acctStats.totalDayChange)}
                        </span>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Sub-components ─────────────────────────────────────────────────────────
function StatCard({ label, value, sub, pnl }) {
  const hasValue = value !== null && value !== undefined
  const pnlCls   = pnl !== undefined && pnl !== null ? pnlColor(pnl) : ''

  return (
    <div className="bg-wall-surface border border-white/[0.06] rounded-xl p-4">
      <p className="text-slate-500 text-[11px] font-medium uppercase tracking-wider mb-2">{label}</p>
      <p className={`text-2xl font-semibold font-mono tabular ${hasValue ? (pnlCls || 'text-slate-100') : 'text-slate-700'}`}>
        {hasValue ? value : '—'}
      </p>
      <p className={`text-[11px] mt-1.5 font-mono tabular ${
        pnl !== undefined && pnl !== null && hasValue ? pnlColor(pnl) + ' opacity-80' : 'text-slate-600'
      }`}>
        {sub}
      </p>
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
