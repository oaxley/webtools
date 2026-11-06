/**
 * Tool cards and the bits around them, shared by the home page (featured
 * tools, search results) and `/tools` (the full catalogue).
 */
import { Link } from 'react-router-dom'
import type { Tool } from '../tools'
import './ToolCard.css'

export function ToolTile({ tool, size = 'md' }: { tool: Tool; size?: 'sm' | 'md' }) {
  return (
    <span
      className={`tool-tile tool-tile-${size}`}
      aria-hidden="true"
      style={{ '--tile-accent': tool.accent } as React.CSSProperties}
    >
      {tool.monogram}
    </span>
  )
}

export function ToolCard({ tool, onOpen }: { tool: Tool; onOpen: (tool: Tool) => void }) {
  const inner = (
    <>
      <ToolTile tool={tool} />
      <span className="tool-body">
        <span className="tool-name">
          {tool.name}
          {!tool.available && <span className="badge badge-neutral">Soon</span>}
        </span>
        <span className="tool-desc">{tool.description}</span>
      </span>
      {tool.available && (
        <span className="tool-arrow" aria-hidden="true">
          →
        </span>
      )}
    </>
  )

  if (tool.available) {
    return (
      <Link className="tool-card" to={tool.path} onClick={() => onOpen(tool)}>
        {inner}
      </Link>
    )
  }
  return (
    <div className="tool-card tool-card-soon" aria-label={`${tool.name} (coming soon)`}>
      {inner}
    </div>
  )
}

export function ToolGrid({ tools, onOpen }: { tools: Tool[]; onOpen: (tool: Tool) => void }) {
  return (
    <div className="tools-grid">
      {tools.map((tool) => (
        <ToolCard key={tool.id} tool={tool} onOpen={onOpen} />
      ))}
    </div>
  )
}

/** "Recently used" chips; renders nothing until the visitor opened a tool. */
export function RecentTools({ recent, onOpen }: { recent: Tool[]; onOpen: (tool: Tool) => void }) {
  if (recent.length === 0) return null
  return (
    <section className="recent-tools" aria-labelledby="recent-title">
      <h2 id="recent-title">Recently used</h2>
      <ul>
        {recent.map((tool) => (
          <li key={tool.id}>
            <Link to={tool.path} onClick={() => onOpen(tool)}>
              <ToolTile tool={tool} size="sm" />
              {tool.name}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}

export function SearchIcon() {
  return (
    <svg className="search-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" strokeWidth="2" />
      <line
        x1="16.5"
        y1="16.5"
        x2="21"
        y2="21"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  )
}

/** Rounded search field used by the home page and `/tools`. */
export function ToolSearch({ query, onChange }: { query: string; onChange: (q: string) => void }) {
  return (
    <form className="search-bar" role="search" onSubmit={(e) => e.preventDefault()}>
      <SearchIcon />
      <input
        type="search"
        value={query}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search tools… (e.g. “subnet”, “jwt”, “uuid”)"
        aria-label="Search tools"
        autoComplete="off"
      />
      {query && (
        <button
          type="button"
          className="search-clear"
          onClick={() => onChange('')}
          aria-label="Clear search"
        >
          ×
        </button>
      )}
    </form>
  )
}
