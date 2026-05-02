import { TABS } from './constants'

export default function TabNav({ activeView, hasData, onChange }) {
  return (
    <div className="mb-7 flex gap-1 rounded-full border border-white/[0.06] bg-white/[0.04] p-1">
      {TABS.map((tab) => {
        const disabled = !hasData && tab.id !== 'upload'
        const isActive = activeView === tab.id
        return (
          <button
            key={tab.id}
            type="button"
            disabled={disabled}
            onClick={() => onChange(tab.id)}
            className={`flex-1 rounded-full px-3 py-2 text-sm font-medium transition-all duration-150 ${
              isActive
                ? 'bg-white/10 text-white'
                : 'text-white/50 hover:bg-white/[0.06] hover:text-white'
            } ${disabled ? 'cursor-not-allowed opacity-30 hover:bg-transparent hover:text-white/50' : ''}`}
          >
            {tab.label}
          </button>
        )
      })}
    </div>
  )
}
