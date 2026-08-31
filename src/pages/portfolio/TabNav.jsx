import { TABS } from './constants'

export default function TabNav({ activeView, hasData, onChange }) {
  return (
    <nav className="mb-8 flex gap-6 overflow-x-auto border-b border-white/[0.06] scrollbar-none">
      {TABS.map((tab) => {
        const disabled = !hasData && tab.id !== 'add'
        const isActive = activeView === tab.id
        return (
          <button
            key={tab.id}
            type="button"
            disabled={disabled}
            onClick={() => onChange(tab.id)}
            className={`relative shrink-0 pb-3 text-[13px] transition-colors duration-150 ${
              isActive
                ? 'text-white'
                : 'text-white/40 hover:text-white/70'
            } ${disabled ? 'cursor-not-allowed opacity-25' : ''}`}
          >
            {tab.label}
            {isActive && (
              <span className="grow-x absolute inset-x-0 -bottom-px h-px bg-accent" />
            )}
          </button>
        )
      })}
    </nav>
  )
}
