import { useId, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { calculateCIDR, isRoutable } from '@webtools/core'
import { GridCard } from '../blog/cards'
import { posts } from '../blog/posts'
import { API_BASE_URL, MCP_URL } from '../blog/site'
import CopyJsonButton from '../components/CopyJsonButton'
import { CATEGORIES, TOOLS, type Tool } from '../tools'
import { usePageMeta } from '../usePageMeta'
import './Home.css'

const RECENT_KEY = 'webtools:recent-ids'
const MAX_RECENT = 6
const LATEST_POSTS = 3

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

function ToolTile({ tool, size = 'md' }: { tool: Tool; size?: 'sm' | 'md' }) {
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

function ToolCard({ tool, onOpen }: { tool: Tool; onOpen: (tool: Tool) => void }) {
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

function SearchIcon() {
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

// ---- "Use it anywhere" -------------------------------------------------------

const EXAMPLE_CIDR = '10.20.0.0/22'

type Channel = 'browser' | 'api' | 'mcp'

interface ChannelInfo {
  id: Channel
  label: string
  title: string
  blurb: string
  /** Snippet shown in the "request" panel (null: link to the tool). */
  request: string | null
  requestLabel: string
  cta: { label: string; to: string }
}

function useChannels(): ChannelInfo[] {
  return useMemo(
    () => [
      {
        id: 'browser',
        label: 'Browser',
        title: 'Paste, read, done.',
        blurb:
          'Every tool runs client-side. Inputs never leave your machine, and results are one click from your clipboard.',
        request: null,
        requestLabel: 'Open in the browser',
        cta: { label: 'Open the subnet calculator', to: `/ip?cidr=${EXAMPLE_CIDR}` },
      },
      {
        id: 'api',
        label: 'REST API',
        title: 'The same answers, as JSON.',
        blurb:
          'Plain HTTPS endpoints, no API key, no sign-up. Script your checks, wire them into CI, or call them from any language.',
        request: `curl "${API_BASE_URL}/api/v1/ip?cidr=${EXAMPLE_CIDR}"`,
        requestLabel: 'Shell',
        cta: { label: 'Read the API guide', to: '/blog/mcp-server-for-ai-agents' },
      },
      {
        id: 'mcp',
        label: 'MCP server',
        title: 'Tools your AI agent can call.',
        blurb:
          'Point Claude, Cursor, VS Code or OpenCode at one URL. The agent gets exact results instead of guessing subnet maths.',
        request: JSON.stringify(
          { mcpServers: { webtools: { url: MCP_URL } } },
          null,
          2,
        ),
        requestLabel: 'mcp.json',
        cta: { label: 'Connect your agent', to: '/blog/mcp-server-for-ai-agents' },
      },
    ],
    [],
  )
}

function UseItAnywhere() {
  const channels = useChannels()
  const [active, setActive] = useState<Channel>('api')
  const id = useId()
  const current = channels.find((c) => c.id === active) ?? channels[0]

  // Computed by the same core library the API and MCP server use, so the
  // sample output is always exactly what they return.
  const output = useMemo(
    () =>
      JSON.stringify(
        { ...calculateCIDR(EXAMPLE_CIDR), routable: isRoutable(EXAMPLE_CIDR) },
        null,
        2,
      ),
    [],
  )
  const outputLabel = active === 'mcp' ? 'calculate_cidr → result' : 'Response'

  return (
    <section className="home-section anywhere" aria-labelledby="anywhere-title">
      <div className="home-section-head">
        <p className="eyebrow">One engine, three doors</p>
        <h2 id="anywhere-title">Use it anywhere</h2>
        <p className="home-section-lede">
          The website, the REST API and the MCP server all run the same code. Here is one
          subnet, <code>{EXAMPLE_CIDR}</code>, three ways.
        </p>
      </div>

      <div className="anywhere-panel">
        <div className="anywhere-tabs" role="tablist" aria-label="Ways to use WebTools">
          {channels.map((c, i) => (
            <button
              key={c.id}
              type="button"
              role="tab"
              id={`${id}-tab-${c.id}`}
              aria-selected={active === c.id}
              aria-controls={`${id}-panel`}
              tabIndex={active === c.id ? 0 : -1}
              className="anywhere-tab"
              onClick={() => setActive(c.id)}
              onKeyDown={(e) => {
                if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
                const next =
                  channels[(i + (e.key === 'ArrowRight' ? 1 : channels.length - 1)) % channels.length]
                setActive(next.id)
                document.getElementById(`${id}-tab-${next.id}`)?.focus()
              }}
            >
              {c.label}
            </button>
          ))}
        </div>

        <div
          className="anywhere-body"
          role="tabpanel"
          id={`${id}-panel`}
          aria-labelledby={`${id}-tab-${current.id}`}
        >
          <div className="anywhere-copy">
            <h3>{current.title}</h3>
            <p>{current.blurb}</p>
            <Link className="button button-primary" to={current.cta.to}>
              {current.cta.label} <span aria-hidden="true">→</span>
            </Link>
          </div>

          <div className="anywhere-code">
            {current.request === null ? (
              <Link className="anywhere-browser" to={current.cta.to}>
                <span className="anywhere-browser-bar" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </span>
                <span className="anywhere-browser-url">/ip?cidr={EXAMPLE_CIDR}</span>
              </Link>
            ) : (
              <figure className="code-panel">
                <figcaption className="code-panel-header">
                  <span>{current.requestLabel}</span>
                  <CopyJsonButton
                    text={current.request}
                    label="Copy"
                    size="sm"
                    ariaLabel={`Copy ${current.requestLabel} snippet`}
                  />
                </figcaption>
                <pre>
                  <code>{current.request}</code>
                </pre>
              </figure>
            )}
            <figure className="code-panel">
              <figcaption className="code-panel-header">
                <span>{outputLabel}</span>
              </figcaption>
              <pre>
                <code>{output}</code>
              </pre>
            </figure>
          </div>
        </div>
      </div>
    </section>
  )
}

// ---- Page --------------------------------------------------------------------

function Home() {
  usePageMeta({
    title: 'WebTools — Free online tools for developers',
    description:
      'Subnet calculator, JWT and X.509 decoders, UUID and NanoID generators. In your browser, over a REST API, or inside your AI agent via MCP.',
  })

  const [query, setQuery] = useState('')
  const [recentIds, setRecentIds] = useState<string[]>(loadRecentIds)

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    return TOOLS.filter((t) =>
      [t.name, t.description, ...t.tags].join(' ').toLowerCase().includes(q),
    )
  }, [query])

  // Only tools the visitor actually opened, newest first.
  const recent = useMemo(() => {
    const byId = new Map(TOOLS.map((t) => [t.id, t]))
    return recentIds
      .map((id) => byId.get(id))
      .filter((t): t is Tool => t !== undefined && t.available)
      .slice(0, MAX_RECENT)
  }, [recentIds])

  const handleOpen = (tool: Tool) => {
    if (!tool.available) return
    setRecentIds((prev) => {
      const next = [tool.id, ...prev.filter((id) => id !== tool.id)].slice(0, MAX_RECENT)
      try {
        localStorage.setItem(RECENT_KEY, JSON.stringify(next))
      } catch {
        // Storage unavailable (private mode, etc.): recents just won't persist.
      }
      return next
    })
  }

  const searching = query.trim().length > 0
  const availableCount = TOOLS.filter((t) => t.available).length
  const latest = posts.slice(0, LATEST_POSTS)

  return (
    <main className="home">
      <section className="ink-hero home-hero">
        <div className="ink-hero-inner home-hero-inner">
          <p className="eyebrow">Free developer tools</p>
          <h1>
            Precise tools for engineers.
            <br />
            <span className="home-hero-accent">In your browser, your scripts, your agent.</span>
          </h1>
          <p className="home-hero-lede">
            Calculate subnets, decode JWTs and certificates, generate UUIDs and NanoIDs. No
            sign-up, nothing logged.
          </p>

          <form className="search-bar" role="search" onSubmit={(e) => e.preventDefault()}>
            <SearchIcon />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search tools… (e.g. “subnet”, “jwt”, “uuid”)"
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

          <ul className="home-facts" aria-label="Highlights">
            <li>
              <strong>{availableCount}</strong> tools
            </li>
            <li>REST API</li>
            <li>MCP server</li>
            <li>No sign-up</li>
          </ul>
        </div>
      </section>

      <div className="home-content">
        {searching ? (
          <section className="home-section" aria-live="polite" aria-labelledby="results-title">
            <h2 id="results-title" className="home-results-title">
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
          </section>
        ) : (
          <>
            {recent.length > 0 && (
              <section className="home-recent" aria-labelledby="recent-title">
                <h2 id="recent-title">Recently used</h2>
                <ul>
                  {recent.map((tool) => (
                    <li key={tool.id}>
                      <Link to={tool.path} onClick={() => handleOpen(tool)}>
                        <ToolTile tool={tool} size="sm" />
                        {tool.name}
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <section className="home-section" aria-labelledby="tools-title">
              <div className="home-section-head">
                <p className="eyebrow">The toolbox</p>
                <h2 id="tools-title">All tools</h2>
              </div>
              <div className="category-list">
                {CATEGORIES.map((cat) => {
                  const tools = TOOLS.filter((t) => t.category === cat.id).sort(
                    (a, b) => Number(b.available) - Number(a.available),
                  )
                  if (tools.length === 0) return null
                  return (
                    <div className="category" key={cat.id}>
                      <div className="category-head">
                        <h3>{cat.label}</h3>
                        <p>{cat.blurb}</p>
                      </div>
                      <div className="tools-grid">
                        {tools.map((tool) => (
                          <ToolCard key={tool.id} tool={tool} onOpen={handleOpen} />
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            </section>
          </>
        )}
      </div>

      {!searching && (
        <>
          <div className="home-band">
            <div className="home-content">
              <UseItAnywhere />
            </div>
          </div>

          {latest.length > 0 && (
            <div className="home-content">
              <section className="home-section" aria-labelledby="latest-title">
                <div className="home-section-head home-section-head-row">
                  <div>
                    <p className="eyebrow">From the blog</p>
                    <h2 id="latest-title">Latest guides</h2>
                  </div>
                  <Link className="button button-secondary" to="/blog">
                    All posts <span aria-hidden="true">→</span>
                  </Link>
                </div>
                <div className="post-grid">
                  {latest.map((post) => (
                    <GridCard key={post.slug} post={post} headingLevel={3} />
                  ))}
                </div>
              </section>
            </div>
          )}
        </>
      )}
    </main>
  )
}

export default Home
