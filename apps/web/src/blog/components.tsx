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
  cloneElement,
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

const LANGUAGE_LABELS: Record<string, string> = {
  bash: 'Shell',
  sh: 'Shell',
  shell: 'Shell',
  json: 'JSON',
  jsonc: 'JSON',
  js: 'JavaScript',
  javascript: 'JavaScript',
  ts: 'TypeScript',
  typescript: 'TypeScript',
  py: 'Python',
  python: 'Python',
  sql: 'SQL',
  http: 'HTTP',
  text: 'Text',
  plaintext: 'Text',
}

type PreProps = ComponentProps<'pre'> & {
  'data-language'?: string
  /** File name from a ```lang title="…" fence, passed down by `Figure`. */
  codeTitle?: string
}

/**
 * Code block (`pre` emitted by rehype-pretty-code): a header bar with the
 * file name (or language) and a copy button, then the highlighted code.
 */
export function Pre({ codeTitle, ...props }: PreProps) {
  // Shiki wraps every line in its own <span>, separated by "\n" text
  // nodes, so the flattened text is exactly the source of the block.
  const text = textOf(props.children).replace(/\n$/, '')
  const lang = props['data-language']
  const label = codeTitle ?? (lang ? (LANGUAGE_LABELS[lang] ?? lang) : 'Code')
  return (
    <div className="code-block">
      <div className="code-block-header">
        <span className={codeTitle ? 'code-block-title' : 'code-block-lang'}>{label}</span>
        <CopyJsonButton
          text={text}
          label="Copy"
          size="sm"
          ariaLabel={codeTitle ? `Copy ${codeTitle}` : 'Copy code'}
          className="code-copy"
        />
      </div>
      <pre {...props} />
    </div>
  )
}

/**
 * rehype-pretty-code wraps each block in a <figure>, with the fence title
 * as a <figcaption>. Fold the caption into the code block's header bar.
 */
export function Figure({ children, ...props }: ComponentProps<'figure'>) {
  if (!('data-rehype-pretty-code-figure' in props)) return <figure {...props}>{children}</figure>
  let title: string | undefined
  const rest: ReactNode[] = []
  for (const child of Children.toArray(children)) {
    if (
      isValidElement<{ children?: ReactNode } & Record<string, unknown>>(child) &&
      'data-rehype-pretty-code-title' in child.props
    ) {
      title = textOf(child.props.children)
    } else {
      rest.push(child)
    }
  }
  return (
    <figure {...props}>
      {rest.map((child) =>
        title !== undefined && isValidElement<PreProps>(child)
          ? cloneElement(child, { codeTitle: title })
          : child,
      )}
    </figure>
  )
}

/** `#` link appended to headings: jumps to the section and copies its URL. */
function HeadingAnchor({ href, children, ...rest }: ComponentProps<'a'> & { href: string }) {
  return (
    <a
      href={href}
      {...rest}
      title="Copy link to this section"
      onClick={(e) => {
        const link = e.currentTarget
        const url = new URL(href, window.location.href).toString()
        navigator.clipboard?.writeText(url).then(
          () => {
            link.dataset.copied = ''
            window.setTimeout(() => delete link.dataset.copied, 1500)
          },
          () => {},
        )
      }}
    >
      {children}
    </a>
  )
}

/** Internal links use the router; external ones open in a new tab. */
export function Anchor({ href = '', children, ...rest }: ComponentProps<'a'>) {
  if (href.startsWith('#') && rest.className?.includes('heading-anchor')) {
    return (
      <HeadingAnchor href={href} {...rest}>
        {children}
      </HeadingAnchor>
    )
  }
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

const CALLOUT_ICONS: Record<CalloutType, ReactNode> = {
  note: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8h.01" />
    </>
  ),
  tip: <path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.6 10.8c.6.5 1 1.2 1.1 2.2h5c.1-1 .5-1.7 1.1-2.2A6 6 0 0 0 12 3z" />,
  warning: (
    <>
      <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
      <path d="M12 9v4M12 17h.01" />
    </>
  ),
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
      <svg
        className="callout-icon"
        viewBox="0 0 24 24"
        width="20"
        height="20"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
      >
        {CALLOUT_ICONS[type]}
      </svg>
      <div className="callout-content">
        <p className="callout-title">{title ?? CALLOUT_LABELS[type]}</p>
        <div className="callout-body">{children}</div>
      </div>
    </aside>
  )
}

/** Card linking to a tool page, optionally with pre-filled settings and input. */
export function TryIt({
  tool: id,
  query,
  fragment,
  children,
}: {
  tool: string
  /** Appended to the tool URL, e.g. "cidr=10.0.0.0/22". */
  query?: string
  /**
   * Values for the URL fragment, e.g. `{ input: "abc" }`. Used for inputs
   * that never go in the query string; the tool reads and clears them.
   */
  fragment?: Record<string, string>
  children?: ReactNode
}) {
  const tool = TOOLS.find((t) => t.id === id)
  if (!tool) throw new Error(`<TryIt>: unknown tool id '${id}'.`)
  let to = query ? `${tool.path}?${query}` : tool.path
  if (fragment) to += `#${new URLSearchParams(fragment).toString()}`
  return (
    <Link
      className="try-it"
      to={to}
      style={{ '--try-accent': tool.accent } as React.CSSProperties}
    >
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
      <span className="try-it-cta">
        Open tool <span aria-hidden="true">→</span>
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
