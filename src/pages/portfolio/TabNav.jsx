import { useId } from 'react'
import { LayoutGroup } from 'framer-motion'
import { SelectionIndicator } from '../../components/InteractionMotion'
import { TABS } from './constants'

export default function TabNav({ activeView, hasData, onChange }) {
  const groupId = useId()
  return (
    <nav aria-label="Portfolio views" className="mb-8 flex gap-0 overflow-x-auto sm:gap-1 border-b border-ink/[0.08] scrollbar-none">
      <LayoutGroup id={groupId}>{TABS.map((tab) => {
        const disabled = !hasData && !['add', 'tax'].includes(tab.id)
        const isActive = activeView === tab.id
        return (
          <button
            key={tab.id}
            type="button"
            disabled={disabled}
            aria-current={isActive ? 'page' : undefined}
            onClick={() => onChange(tab.id)}
            className={`group relative shrink-0 pb-2.5 focus-visible:outline-none ${
              disabled ? 'cursor-not-allowed opacity-25' : ''
            }`}
          >
            <span
              className={`relative z-10 block rounded-lg px-2 py-2 text-[13px] font-medium transition-colors duration-motion-short group-focus-visible:ring-2 group-focus-visible:ring-brand-accent/50 sm:px-3 ${
                isActive
                  ? 'text-ink'
                  : 'text-ink/50 group-hover:bg-ink/[0.04] group-hover:text-ink/90'
              } ${disabled ? 'group-hover:bg-transparent group-hover:text-ink/50' : ''}`}
            >
              {tab.label}
            </span>
            {isActive && (
              <SelectionIndicator id="active-portfolio-view" className="pointer-events-none absolute inset-x-0 top-0 bottom-2.5 rounded-lg bg-brand-accent/[0.10] dark:bg-brand-accent/[0.16]" />
            )}
          </button>
        )
      })}</LayoutGroup>
    </nav>
  )
}
