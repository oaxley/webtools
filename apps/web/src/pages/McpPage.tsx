/**
 * `/mcp`: how to connect an AI agent to the WebTools MCP server.
 *
 * The body is MDX (`src/content/mcp.mdx`) so it gets the same code
 * highlighting, tabs and callouts as blog posts, and the page reuses the
 * post layout and styles. It is not a blog post: it has no date, tags or
 * listing entry.
 */
import { lazy, Suspense, useRef } from 'react'
import { MDXProvider } from '@mdx-js/react'
import { Link } from 'react-router-dom'
import { mdxComponents } from '../blog/mdxComponents'
import { ReadingProgress, TableOfContents } from '../blog/PostAside'
import type { PostHeading } from '../blog/types'
import { MCP_URL } from '../blog/site'
import { TOOLS } from '../tools'
import { usePageMeta } from '../usePageMeta'
import './Blog.css'

const Body = lazy(() => import('../content/mcp.mdx'))

/** The h2s of `content/mcp.mdx`, with the ids rehype-slug gives them. */
const HEADINGS: PostHeading[] = [
  { depth: 2, text: 'What the server exposes', id: 'what-the-server-exposes' },
  { depth: 2, text: 'Connect your client', id: 'connect-your-client' },
  { depth: 2, text: 'Try a few prompts', id: 'try-a-few-prompts' },
  { depth: 2, text: 'What happens on the wire', id: 'what-happens-on-the-wire' },
  { depth: 2, text: 'Before you paste secrets', id: 'before-you-paste-secrets' },
  { depth: 2, text: 'Next steps', id: 'next-steps' },
]

const TITLE = 'MCP server'
const DESCRIPTION =
  'Connect Claude, Cursor, OpenCode or your own agent to WebTools over MCP, so it decodes JWTs and certificates, does subnet math and generates IDs with real code instead of guesses.'

function McpPage() {
  const articleRef = useRef<HTMLElement>(null)
  usePageMeta({ title: `${TITLE} — WebTools`, description: DESCRIPTION })
  const tools = TOOLS.filter((t) => t.available && t.mcp)

  return (
    <main className="post-page">
      <ReadingProgress targetRef={articleRef} />
      <header className="ink-hero post-hero">
        <div className="ink-hero-inner post-hero-inner">
          <div className="post-hero-grid">
            <div className="post-hero-text">
              <h1>{TITLE}</h1>
              <p className="post-lede">{DESCRIPTION}</p>
              <p className="post-byline">
                <code>{MCP_URL}</code>
              </p>
            </div>
            <div
              className="post-hero-tile"
              style={{ '--cover-accent': '#4f46e5' } as React.CSSProperties}
              aria-hidden="true"
            >
              <span>MCP</span>
            </div>
          </div>
        </div>
      </header>

      <div className="post-layout">
        <article className="post" ref={articleRef} aria-label={TITLE}>
          <details className="post-toc-mobile">
            <summary>On this page</summary>
            <TableOfContents headings={HEADINGS} />
          </details>

          <div className="prose">
            <MDXProvider components={mdxComponents}>
              <Suspense fallback={<p className="post-loading">Loading…</p>}>
                <Body />
              </Suspense>
            </MDXProvider>
          </div>
        </article>

        <aside className="post-aside" aria-label="On this page">
          <div className="post-aside-sticky">
            <section>
              <h2 className="post-aside-title">On this page</h2>
              <TableOfContents headings={HEADINGS} />
            </section>
            <section>
              <h2 className="post-aside-title">Tools over MCP</h2>
              <ul className="post-aside-tools">
                {tools.map((tool) => (
                  <li key={tool.id}>
                    <Link to={tool.path}>
                      <span
                        className="tool-tile"
                        aria-hidden="true"
                        style={{ '--tile-accent': tool.accent } as React.CSSProperties}
                      >
                        {tool.monogram}
                      </span>
                      {tool.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        </aside>
      </div>
    </main>
  )
}

export default McpPage
