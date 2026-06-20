import { useState, type ReactNode } from 'react'

export interface TabbedCardTab {
  /** Stable key + visible label for the tab button. */
  id: string
  label: string
  /** Rendered when this tab is active. Lazily evaluated so heavy panels only
   *  mount when their tab is shown — but every tab is still a real, fully
   *  functional panel (no logic stripped, just gated by active tab). */
  content: ReactNode
}

/**
 * A single framed rail card with a Settings-style tab strip
 * (`.settings-tabbar` / `.settings-tab`) along the top. Used to fold several
 * sub-panels (Content: Look | Starting Soon; Broadcast: Stream | Package |
 * Recording | Notes) into one scannable card instead of a stack of collapsed
 * bars. Tab strip CSS is shared with Settings for visual consistency.
 */
export function TabbedCard({ title, tabs }: { title: string; tabs: TabbedCardTab[] }) {
  const [active, setActive] = useState(tabs[0]?.id ?? '')
  const current = tabs.find((t) => t.id === active) ?? tabs[0]
  return (
    <div className="panel-section tabbed-card">
      <div className="panel-section-title tabbed-card-title">{title}</div>
      <div className="settings-tabbar tabbed-card-tabbar">
        {tabs.map((t) => (
          <button
            key={t.id}
            className={`settings-tab${t.id === active ? ' active' : ''}`}
            onClick={() => setActive(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="tabbed-card-body">{current?.content}</div>
    </div>
  )
}
