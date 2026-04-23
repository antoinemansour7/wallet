export default function PortfolioHeader({ fileName, hasData, lastUpdatedAt }) {
  return (
    <header className="mb-8 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
      <div>
        <p className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.2em] text-text-muted">Dashboard</p>
        <h1 className="text-[28px] font-bold tracking-tight text-text-primary">Portfolio</h1>
        <p className="mt-1.5 text-sm text-text-muted">AI-parsed holdings · live market prices</p>
        {hasData && (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 text-text-secondary">
              <span className="h-1.5 w-1.5 rounded-full bg-brand" />
              {fileName}
            </span>
            {lastUpdatedAt && (
              <span className="rounded-full border border-border bg-brand-light px-3 py-1 font-mono text-text-muted">
                Prices at {lastUpdatedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
          </div>
        )}
      </div>
    </header>
  )
}
