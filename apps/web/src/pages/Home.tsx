import { useId, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { calculateCIDR, isRoutable } from '@webtools/core'
import { GridCard } from '../blog/cards'
import { posts } from '../blog/posts'
import { API_BASE_URL, MCP_URL } from '../blog/site'
import CopyJsonButton from '../components/CopyJsonButton'
import { RecentTools, ToolGrid, ToolSearch } from '../components/ToolCard'
import { searchTools, useRecentTools } from '../recentTools'
import { TOOLS } from '../tools'
import { usePageMeta } from '../usePageMeta'
import './Home.css'

const LATEST_POSTS = 3

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
        cta: { label: 'Read the API guide', to: '/api' },
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
        cta: { label: 'Connect your agent', to: '/mcp' },
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
      'Subnet calculator, JWT and X.509 decoders, UUID, NanoID and ULID generators, Base64/32/58 encoders, hash generator. In your browser, over a REST API, or inside your AI agent via MCP.',
  })

  const [query, setQuery] = useState('')
  const { recent, recordOpen } = useRecentTools()
  const results = useMemo(() => (query.trim() ? searchTools(query) : []), [query])
  const featured = TOOLS.filter((t) => t.featured && t.available)

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
            Calculate subnets, decode JWTs and certificates, generate UUIDs, NanoIDs and ULIDs, encode Base64, hash with SHA-256. No
            sign-up, nothing logged.
          </p>

          <ToolSearch query={query} onChange={setQuery} />

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
              <ToolGrid tools={results} onOpen={recordOpen} />
            )}
          </section>
        ) : (
          <>
            <RecentTools recent={recent} onOpen={recordOpen} />

            <section className="home-section" aria-labelledby="tools-title">
              <div className="home-section-head home-section-head-row">
                <div>
                  <p className="eyebrow">The toolbox</p>
                  <h2 id="tools-title">Popular tools</h2>
                </div>
                <Link className="button button-secondary" to="/tools">
                  All {availableCount} tools <span aria-hidden="true">→</span>
                </Link>
              </div>
              <ToolGrid tools={featured} onOpen={recordOpen} />
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
