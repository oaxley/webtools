/**
 * Components available inside blog MDX files.
 *
 * Posts can use `<Callout>`, `<TryIt>`, `<Tabs>`/`<Tab>` and
 * `<ToolLink>` without importing them (they are passed through
 * `MDXProvider`). Plain Markdown elements are also mapped here: code
 * blocks get a copy button, internal links go through the router.
 */
import {
  Children,
  isValidElement,
  useId,
  useState,
  type ComponentProps,
  type ReactNode,
} from 'react'
import { Link } from 'react-router-dom'
import CopyJsonButton from '../components/CopyJsonButton'
import { TOOLS } from '../tools'

/** Concatenated text content of a React element tree. */
function textOf(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children)
  return ''
}

/** Code block (`pre` emitted by rehype-pretty-code) with a copy button. */
export function Pre(props: ComponentProps<'pre'>) {
  // Shiki wraps every line in its own <span>, separated by "\n" text
  // nodes, so the flattened text is exactly the source of the block.
  const text = textOf(props.children).replace(/\n$/, '')
  return (
    <div className="code-block">
      <pre {...props} />
      <CopyJsonButton
        text={text}
        label="Copy"
        size="sm"
        ariaLabel="Copy code"
        className="code-copy"
      />
    </div>
  )
}

/** Internal links use the router; external ones open in a new tab. */
export function Anchor({ href = '', children, ...rest }: ComponentProps<'a'>) {
  if (href.startsWith('/')) {
    return (
      <Link to={href} {...rest}>
        {children}
      </Link>
    )
  }
  if (/^https?:\/\//.test(href)) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" {...rest}>
        {children}
      </a>
    )
  }
  return (
    <a href={href} {...rest}>
      {children}
    </a>
  )
}

/** Wide tables scroll horizontally instead of breaking the layout. */
export function Table(props: ComponentProps<'table'>) {
  return (
    <div className="table-scroll">
      <table {...props} />
    </div>
  )
}

type CalloutType = 'note' | 'tip' | 'warning'

const CALLOUT_LABELS: Record<CalloutType, string> = {
  note: 'Note',
  tip: 'Tip',
  warning: 'Warning',
}

export function Callout({
  type = 'note',
  title,
  children,
}: {
  type?: CalloutType
  title?: string
  children: ReactNode
}) {
  return (
    <aside className={`callout callout-${type}`}>
      <p className="callout-title">{title ?? CALLOUT_LABELS[type]}</p>
      <div className="callout-body">{children}</div>
    </aside>
  )
}

/** Card linking to a tool page, optionally with a pre-filled query. */
export function TryIt({
  tool: id,
  query,
  children,
}: {
  tool: string
  /** Appended to the tool URL, e.g. "cidr=10.0.0.0/22". */
  query?: string
  children?: ReactNode
}) {
  const tool = TOOLS.find((t) => t.id === id)
  if (!tool) throw new Error(`<TryIt>: unknown tool id '${id}'.`)
  const to = query ? `${tool.path}?${query}` : tool.path
  return (
    <Link className="try-it" to={to}>
      <span
        className="tool-tile"
        aria-hidden="true"
        style={{ '--tile-accent': tool.accent } as React.CSSProperties}
      >
        {tool.monogram}
      </span>
      <span className="try-it-body">
        <span className="try-it-label">Try it</span>
        <span className="try-it-name">{tool.name}</span>
        <span className="try-it-desc">{children ?? tool.description}</span>
      </span>
      <span className="try-it-arrow" aria-hidden="true">
        →
      </span>
    </Link>
  )
}

/** Inline link to a tool page by id, labelled with the tool name. */
export function ToolLink({ tool: id, children }: { tool: string; children?: ReactNode }) {
  const tool = TOOLS.find((t) => t.id === id)
  if (!tool) throw new Error(`<ToolLink>: unknown tool id '${id}'.`)
  return <Link to={tool.path}>{children ?? tool.name}</Link>
}

/** One panel of a `<Tabs>` group. Rendered by `Tabs`, never on its own. */
export function Tab({ children }: { label: string; children: ReactNode }) {
  return <>{children}</>
}

/**
 * Tabbed panels, typically the same request shown several ways:
 *
 *   <Tabs>
 *     <Tab label="curl"> ```bash … ``` </Tab>
 *     <Tab label="MCP"> ```json … ``` </Tab>
 *   </Tabs>
 */
export function Tabs({ children }: { children: ReactNode }) {
  const id = useId()
  const tabs = Children.toArray(children).filter(
    (c): c is React.ReactElement<{ label: string; children: ReactNode }> =>
      isValidElement(c) && c.type === Tab,
  )
  const [active, setActive] = useState(0)

  return (
    <div className="tabs">
      <div className="tabs-list" role="tablist">
        {tabs.map((tab, i) => (
          <button
            key={tab.props.label}
            type="button"
            role="tab"
            id={`${id}-tab-${i}`}
            aria-selected={active === i}
            aria-controls={`${id}-panel-${i}`}
            tabIndex={active === i ? 0 : -1}
            className="tabs-tab"
            onClick={() => setActive(i)}
            onKeyDown={(e) => {
              if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
              const next =
                (active + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length
              setActive(next)
              document.getElementById(`${id}-tab-${next}`)?.focus()
            }}
          >
            {tab.props.label}
          </button>
        ))}
      </div>
      {tabs.map((tab, i) => (
        <div
          key={tab.props.label}
          role="tabpanel"
          id={`${id}-panel-${i}`}
          aria-labelledby={`${id}-tab-${i}`}
          hidden={active !== i}
          className="tabs-panel"
        >
          {tab.props.children}
        </div>
      ))}
    </div>
  )
}
