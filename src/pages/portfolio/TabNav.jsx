import { TABS } from './constants'

export default function TabNav({ activeView, hasData, onChange }) {
  return (
    <nav className="mb-8 flex gap-1 overflow-x-auto border-b border-ink/[0.08] scrollbar-none">
      {TABS.map((tab) => {
        const disabled = !hasData && tab.id !== 'add'
        const isActive = activeView === tab.id
        return (
          <button
            key={tab.id}
            type="button"
            disabled={disabled}
            onClick={() => onChange(tab.id)}
            className={`group relative shrink-0 pb-2.5 focus-visible:outline-none ${
              disabled ? 'cursor-not-allowed opacity-25' : ''
            }`}
          >
            <span
              className={`block rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors duration-motion-short ${
                isActive
                  ? 'bg-accent/[0.12] text-ink dark:bg-ink/[0.08] dark:text-ink'
                  : 'text-ink/50 group-hover:bg-ink/[0.04] group-hover:text-ink/90'
              } ${disabled ? 'group-hover:bg-transparent group-hover:text-ink/50' : ''}`}
            >
              {tab.label}
            </span>
            {isActive && (
              <span className="motion-select absolute inset-x-2 -bottom-px h-px bg-accent" />
            )}
          </button>
        )
      })}
    </nav>
  )
}
