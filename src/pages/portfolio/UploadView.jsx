import UploadIcon from './UploadIcon'

function InfoPanel({ title, icon, children }) {
  return (
    <section className="rounded-card border border-border bg-card p-4">
      <h2 className="mb-3 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-text-muted">
        <span>{icon}</span>{title}
      </h2>
      {children}
    </section>
  )
}

export default function UploadView({ error, fileName, hasData, inputRef, isDragging, loading, loadingMsg, rows, onDragLeave, onDragOver, onDrop, onFile }) {
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div>
        <div
          className={`relative cursor-pointer rounded-2xl border-2 border-dashed p-14 text-center transition-all duration-200 ${
            isDragging
              ? 'scale-[1.005] border-brand/40 bg-brand-light'
              : loading
              ? 'border-border bg-card'
              : 'border-border bg-surface hover:border-brand/30 hover:bg-brand-light/60'
          }`}
          onClick={() => inputRef.current?.click()}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
        >
          <input ref={inputRef} type="file" accept=".csv,.xlsx,.xls,.pdf" className="hidden" onChange={(e) => onFile(e.target.files[0])} />

          {loading ? (
            <div className="flex flex-col items-center gap-4">
              <div className="relative h-12 w-12">
                <div className="absolute inset-0 rounded-full border-2 border-border" />
                <div className="absolute inset-0 rounded-full border-2 border-brand border-t-transparent animate-spin" />
              </div>
              <div>
                <p className="text-sm font-semibold text-text-secondary">{loadingMsg}</p>
                <p className="mt-1 text-xs text-text-muted">This may take a few seconds</p>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-4">
              <div className={`flex h-14 w-14 items-center justify-center rounded-2xl border-2 transition-all duration-200 ${isDragging ? 'border-brand bg-brand-light' : 'border-border bg-card'}`}>
                <UploadIcon active={isDragging} />
              </div>
              <div>
                <p className="text-base font-semibold text-text-secondary">{isDragging ? 'Drop to import' : 'Drop your portfolio here'}</p>
                <p className="mt-1.5 text-xs text-text-muted">CSV · XLSX · XLS · PDF</p>
                <p className="mt-3 text-xs text-text-muted">
                  or <span className="cursor-pointer text-brand underline underline-offset-2 hover:opacity-75">browse files</span>
                </p>
              </div>
            </div>
          )}
        </div>

        {error && (
          <div className="mt-4 flex items-start gap-3 rounded-xl border border-loss/20 bg-loss-bg px-4 py-3">
            <svg className="mt-0.5 h-4 w-4 shrink-0 text-loss" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><circle cx="12" cy="16" r="0.5" fill="currentColor" />
            </svg>
            <p className="text-sm text-loss">{error}</p>
          </div>
        )}
      </div>

      <aside className="space-y-3">
        <InfoPanel title="Current File" icon="📄">
          {hasData ? (
            <>
              <p className="truncate text-sm font-semibold text-text-secondary" title={fileName}>{fileName}</p>
              <p className="mt-0.5 text-xs text-text-muted">{rows.length} positions</p>
            </>
          ) : (
            <p className="text-sm text-text-muted">No file loaded</p>
          )}
        </InfoPanel>
        <InfoPanel title="AI Parsing" icon="✦">
          <p className="text-xs leading-relaxed text-text-muted">
            Works with any broker — Questrade, TD, CIBC, Wealthsimple, and more. The AI maps your headers automatically.
          </p>
        </InfoPanel>
        <InfoPanel title="Live Prices" icon="⚡">
          <p className="text-xs leading-relaxed text-text-muted">
            US stocks refresh from Polygon/Massive when configured; Canadian CDRs and fallback quotes use Yahoo Finance.
          </p>
        </InfoPanel>
      </aside>
    </div>
  )
}
