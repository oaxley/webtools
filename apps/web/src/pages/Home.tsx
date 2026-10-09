import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { TOOLS, type Tool } from '../tools'

const RECENT_KEY = 'webtools:recent-ids'
const MAX_RECENT = 6

function loadRecentIds(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    if (!Array.isArray(parsed)) return []
    return parsed.filter((id): id is string => typeof id === 'string')
  } catch {
    return []
  }
}

function ToolCard({ tool, onOpen }: { tool: Tool; onOpen: (tool: Tool) => void }) {
  const inner = (
    <>
      <span
        className="tool-tile"
        aria-hidden="true"
        style={{ '--tile-accent': tool.accent } as React.CSSProperties}
      >
        {tool.monogram}
      </span>
      <span className="tool-body">
        <span className="tool-name">
          {tool.name}
          {!tool.available && <span className="soon-badge">Soon</span>}
        </span>
        <span className="tool-desc">{tool.description}</span>
      </span>
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
    <span
      className="tool-card"
      aria-disabled="true"
      role="link"
      onClick={() => onOpen(tool)}
    >
      {inner}
    </span>
  )
}

function Home() {
  const [query, setQuery] = useState('')
  const [recentIds, setRecentIds] = useState<string[]>(loadRecentIds)

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    return TOOLS.filter((t) =>
      [t.name, t.description, ...t.tags].join(' ').toLowerCase().includes(q),
    )
  }, [query])

  const recent = useMemo(() => {
    const byId = new Map(TOOLS.map((t) => [t.id, t]))
    const ordered = recentIds
      .map((id) => byId.get(id))
      .filter((t): t is Tool => t !== undefined)
    for (const t of TOOLS) {
      if (ordered.length >= MAX_RECENT) break
      if (!ordered.includes(t)) ordered.push(t)
    }
    return ordered.slice(0, MAX_RECENT)
  }, [recentIds])

  const handleOpen = (tool: Tool) => {
    setRecentIds((prev) => {
      const next = [tool.id, ...prev.filter((id) => id !== tool.id)].slice(
        0,
        MAX_RECENT,
      )
      try {
        localStorage.setItem(RECENT_KEY, JSON.stringify(next))
      } catch {
        // Storage unavailable (private mode, etc.): recents just won't persist.
      }
      return next
    })
  }

  const searching = query.trim().length > 0

  return (
    <main className="landing">
      <section className="hero-search">
        <h1>WebTools</h1>
        <p className="tagline">
          Free online tools for developers and network engineers.
        </p>
        <form
          className="search-bar"
          role="search"
          onSubmit={(e) => e.preventDefault()}
        >
          <svg
            className="search-icon"
            viewBox="0 0 24 24"
            aria-hidden="true"
            focusable="false"
          >
            <circle
              cx="11"
              cy="11"
              r="7"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            />
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
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search tools… (e.g. “subnet”, “json”, “dns”)"
            aria-label="Search tools"
            autoComplete="off"
          />
          {query && (
            <button
              type="button"
              className="search-clear"
              onClick={() => setQuery('')}
              aria-label="Clear search"
            >
              ×
            </button>
          )}
        </form>
      </section>

      <section className="tools-section" aria-live="polite">
        {searching ? (
          <>
            <h2>
              {results.length > 0
                ? `${results.length} result${results.length > 1 ? 's' : ''} for “${query.trim()}”`
                : `No tools found for “${query.trim()}”`}
            </h2>
            {results.length > 0 && (
              <div className="tools-grid">
                {results.map((tool) => (
                  <ToolCard key={tool.id} tool={tool} onOpen={handleOpen} />
                ))}
              </div>
            )}
          </>
        ) : (
          <>
            <h2>Recently used</h2>
            <div className="tools-grid">
              {recent.map((tool) => (
                <ToolCard key={tool.id} tool={tool} onOpen={handleOpen} />
              ))}
            </div>
          </>
        )}
      </section>
    </main>
  )
}

export default Home
