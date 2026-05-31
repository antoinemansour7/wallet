import PlaidLinkButton from '../../components/PlaidLinkButton'
import UploadIcon from './UploadIcon'

export default function UploadView({ error, fileName, hasData, inputRef, isDragging, loading, loadingMsg, rows, userId, onDragLeave, onDragOver, onDrop, onFile, onPlaidSuccess, onPlaidConnecting }) {
  return (
    <div className="mx-auto max-w-xl">
      {/* Loading state */}
      {loading && (
        <div className="flex flex-col items-center py-20">
          <div className="relative h-10 w-10">
            <div className="absolute inset-0 rounded-full border border-white/[0.08]" />
            <div className="absolute inset-0 rounded-full border border-white/60 border-t-transparent animate-spin" />
          </div>
          <p className="mt-5 text-[13px] text-white/50">{loadingMsg}</p>
        </div>
      )}

      {/* Main upload area */}
      {!loading && (
        <>
          <div
            className={`group relative cursor-pointer rounded-2xl px-6 py-16 text-center transition-all duration-200 ${
              isDragging
                ? 'bg-white/[0.04] ring-1 ring-white/20'
                : 'hover:bg-white/[0.02]'
            }`}
            onClick={() => inputRef.current?.click()}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
          >
            <input ref={inputRef} type="file" accept=".csv,.xlsx,.xls,.pdf" className="hidden" onChange={(e) => onFile(e.target.files[0])} />

            <div className={`mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-full transition-colors ${isDragging ? 'bg-white/[0.08]' : 'bg-white/[0.04] group-hover:bg-white/[0.06]'}`}>
              <UploadIcon active={isDragging} />
            </div>
            <p className="text-[15px] font-medium text-white/70">{isDragging ? 'Drop to import' : 'Import portfolio'}</p>
            <p className="mt-2 text-[13px] text-white/30">
              Drag a file here or <span className="text-white/50 underline underline-offset-2">browse</span>
            </p>
            <p className="mt-1 text-[11px] text-white/20">CSV, XLSX, XLS, or PDF from any broker</p>
          </div>

          {/* Divider */}
          <div className="flex items-center gap-3 px-6 py-4">
            <div className="h-px flex-1 bg-white/[0.06]" />
            <span className="text-[11px] text-white/25">or</span>
            <div className="h-px flex-1 bg-white/[0.06]" />
          </div>

          {/* Plaid connect */}
          <div className="px-6 pb-2">
            <PlaidLinkButton userId={userId} onSuccess={onPlaidSuccess} onConnecting={onPlaidConnecting} />
            <p className="mt-3 text-[11px] text-white/20">
              TFSA, FHSA, RRSP, and non-registered accounts supported.
            </p>
          </div>
        </>
      )}

      {/* Error */}
      {error && (
        <div className="mx-6 mt-4 rounded-lg bg-loss/[0.08] px-4 py-3">
          <p className="text-[13px] text-loss/90">{error}</p>
        </div>
      )}

      {/* Current file status */}
      {hasData && !loading && (
        <div className="mt-8 border-t border-white/[0.06] px-6 pt-5">
          <p className="text-[11px] text-white/25">Currently loaded</p>
          <p className="mt-1 truncate text-[13px] text-white/50">{fileName}</p>
          <p className="text-[11px] text-white/20">{rows.length} positions</p>
        </div>
      )}
    </div>
  )
}
