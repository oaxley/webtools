/**
 * Shared shell for every tool page: compact ink header (breadcrumb, tile,
 * title, lede, "how else can I use this" chips), the page body, and the
 * blog guides that mention the tool.
 */
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { GridCard } from '../blog/cards'
import { posts } from '../blog/posts'
import { CATEGORIES, findTool, type Tool } from '../tools'
import { usePageMeta } from '../usePageMeta'
import './ToolPage.css'

const MAX_GUIDES = 3

function ToolHeader({ tool, lede }: { tool: Tool; lede: ReactNode }) {
  const category = CATEGORIES.find((c) => c.id === tool.category)
  return (
    <header className="ink-hero tool-hero">
      <div className="ink-hero-inner tool-hero-inner">
        <nav className="tool-breadcrumb" aria-label="Breadcrumb">
          <ol>
            <li>
              <Link to="/">Tools</Link>
            </li>
            {category && <li>{category.label}</li>}
            <li aria-current="page">{tool.name}</li>
          </ol>
        </nav>
        <div className="tool-hero-title">
          <span
            className="tool-tile tool-hero-tile"
            aria-hidden="true"
            style={{ '--tile-accent': tool.accent } as React.CSSProperties}
          >
            {tool.monogram}
          </span>
          <div>
            <h1>{tool.name}</h1>
            <p className="tool-hero-lede">{lede}</p>
          </div>
        </div>
        <ul className="tool-hero-chips" aria-label="Also available">
          <li>
            <span className="tool-chip-dot" aria-hidden="true" />
            Runs in your browser
          </li>
          {tool.api && (
            <li>
              <span className="tool-chip-label">API</span>
              <code>
                {tool.api.method} {tool.api.path}
              </code>
            </li>
          )}
          {tool.mcp && (
            <li>
              <span className="tool-chip-label">MCP</span>
              <code>{tool.mcp}</code>
            </li>
          )}
        </ul>
      </div>
    </header>
  )
}

function RelatedGuides({ tool }: { tool: Tool }) {
  // Posts dedicated to this tool first (fewest related tools), then newest.
  const guides = posts
    .map((post, index) => ({ post, index }))
    .filter(({ post }) => post.tools.includes(tool.id))
    .sort((a, b) => a.post.tools.length - b.post.tools.length || a.index - b.index)
    .slice(0, MAX_GUIDES)
    .map(({ post }) => post)
  if (guides.length === 0) return null
  return (
    <section className="tool-guides" aria-labelledby="tool-guides-title">
      <div className="tool-guides-head">
        <h2 id="tool-guides-title">Guides for this tool</h2>
        <Link to="/blog">
          All guides <span aria-hidden="true">→</span>
        </Link>
      </div>
      <div className="post-grid">
        {guides.map((post) => (
          <GridCard key={post.slug} post={post} headingLevel={3} />
        ))}
      </div>
    </section>
  )
}

interface ToolPageProps {
  /** Id from `TOOLS` (src/tools.ts). */
  toolId: string
  /** One or two sentences under the title. */
  lede: ReactNode
  /** Wider body for two-column tools (decoders). */
  wide?: boolean
  /** Extra class on the body, for page-specific tweaks. */
  className?: string
  children: ReactNode
}

export function ToolPage({ toolId, lede, wide, className, children }: ToolPageProps) {
  const tool = findTool(toolId)
  usePageMeta({
    title: `${tool.name} — WebTools`,
    description: tool.description,
  })
  const bodyClass = ['tool-page', wide && 'tool-page-wide', className].filter(Boolean).join(' ')
  return (
    <main className="tool-main">
      <ToolHeader tool={tool} lede={lede} />
      <div className={bodyClass}>
        {children}
        <RelatedGuides tool={tool} />
      </div>
    </main>
  )
}

/** "Try: a · b · c" row of sample inputs. */
export function Examples({
  items,
}: {
  items: { label: string; onClick: () => void; title?: string }[]
}) {
  return (
    <div className="examples">
      <span className="examples-label">Try</span>
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          className="example-chip"
          title={item.title}
          onClick={item.onClick}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}

export interface SegmentOption<T extends string | number> {
  value: T
  label: ReactNode
}

/** Radio group drawn as a segmented control (arrow keys move the choice). */
export function SegmentedControl<T extends string | number>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: T
  options: SegmentOption<T>[]
  onChange: (value: T) => void
  ariaLabel: string
}) {
  return (
    <div className="segmented" role="radiogroup" aria-label={ariaLabel}>
      {options.map((opt, i) => {
        const checked = opt.value === value
        return (
          <button
            key={String(opt.value)}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            className="segmented-option"
            onClick={() => onChange(opt.value)}
            onKeyDown={(e) => {
              const step =
                e.key === 'ArrowRight' || e.key === 'ArrowDown'
                  ? 1
                  : e.key === 'ArrowLeft' || e.key === 'ArrowUp'
                    ? -1
                    : 0
              if (!step) return
              e.preventDefault()
              const next = options[(i + step + options.length) % options.length]
              onChange(next.value)
              const group = e.currentTarget.parentElement
              const buttons = group?.querySelectorAll<HTMLButtonElement>('[role="radio"]')
              buttons?.[(i + step + options.length) % options.length]?.focus()
            }}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}
