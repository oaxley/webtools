/**
 * `/tools`: the full catalogue, grouped by category, with a search field
 * that filters it in place. The home page only shows the featured tools
 * and links here.
 */
import { useSearchParams } from 'react-router-dom'
import { RecentTools, ToolGrid, ToolSearch } from '../components/ToolCard'
import { TOOLS_PAGE } from '../content/toolsMeta'
import { searchTools, useRecentTools } from '../recentTools'
import { CATEGORIES, TOOLS } from '../tools'
import { usePageMeta } from '../usePageMeta'
import './Home.css'
import './ToolsIndex.css'

function ToolsIndex() {
  usePageMeta({ title: `${TOOLS_PAGE.title} — WebTools`, description: TOOLS_PAGE.description })

  // The query lives in the URL (`/tools?q=jwt`) so a filtered list can be shared.
  const [searchParams, setSearchParams] = useSearchParams()
  const query = searchParams.get('q') ?? ''
  const setQuery = (q: string) => setSearchParams(q ? { q } : {}, { replace: true })

  const { recent, recordOpen } = useRecentTools()
  const matches = searchTools(query)
  const availableCount = TOOLS.filter((t) => t.available).length
  const searching = query.trim().length > 0

  return (
    <main className="home tools-index">
      <section className="ink-hero">
        <div className="ink-hero-inner tools-hero-inner">
          <p className="eyebrow">The toolbox</p>
          <h1>{TOOLS_PAGE.title}</h1>
          <p className="tools-hero-lede">
            {availableCount} tools for networks, tokens, certificates, identifiers and payloads.
            All run in your browser; most are also on the REST API and the MCP server.
          </p>
          <ToolSearch query={query} onChange={setQuery} />
        </div>
      </section>

      <div className="home-content">
        {!searching && <RecentTools recent={recent} onOpen={recordOpen} />}

        <section className="home-section" aria-live="polite" aria-label="Tools">
          {searching && (
            <h2 className="home-results-title">
              {matches.length > 0
                ? `${matches.length} result${matches.length > 1 ? 's' : ''} for “${query.trim()}”`
                : `No tools found for “${query.trim()}”`}
            </h2>
          )}
          <div className="category-list">
            {CATEGORIES.map((cat) => {
              const tools = matches
                .filter((t) => t.category === cat.id)
                .sort((a, b) => Number(b.available) - Number(a.available))
              if (tools.length === 0) return null
              return (
                <div className="category" key={cat.id} id={cat.id}>
                  <div className="category-head">
                    <h2>{cat.label}</h2>
                    <p>{cat.blurb}</p>
                  </div>
                  <ToolGrid tools={tools} onOpen={recordOpen} />
                </div>
              )
            })}
          </div>
        </section>
      </div>
    </main>
  )
}

export default ToolsIndex
