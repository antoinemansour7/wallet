import { TABS } from './constants'

export default function TabNav({ activeView, hasData, onChange }) {
  return (
    <div className="mb-7 flex gap-1 rounded-xl border border-border bg-brand-light p-1 shadow-sm">
      {TABS.map((tab) => {
        const disabled = !hasData && tab.id !== 'upload'
        const isActive = activeView === tab.id
        return (
          <button
            key={tab.id}
            type="button"
            disabled={disabled}
            onClick={() => onChange(tab.id)}
            className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-150 ${
              isActive
                ? 'bg-brand text-white shadow-sm'
                : 'text-text-muted hover:bg-black/[0.04] hover:text-text-primary'
            } ${disabled ? 'cursor-not-allowed opacity-30 hover:bg-transparent hover:text-text-muted' : ''}`}
          >
            {tab.label}
          </button>
        )
      })}
    </div>
  )
}
